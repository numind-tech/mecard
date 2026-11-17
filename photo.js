import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { validateUrl } from "./urls.js";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export function isPublicAddress(address) {
  if (!isIP(address)) return false;
  const ip = ipaddr.parse(address);
  // Reject mapped/translated/tunnel IPv6 addresses as well as private,
  // loopback, link-local, multicast and reserved networks.
  if (ip.kind() === "ipv6" && !ip.match(ipaddr.parse("2000::"), 3)) return false;
  return ip.range() === "unicast";
}

function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      return callback(new Error("photo host must resolve only to public IP addresses"));
    }
    // The socket uses these exact, vetted DNS results. A separate preflight
    // lookup followed by ordinary fetch() would allow DNS rebinding.
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

function requestPhoto(url, signal) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) {
    throw new Error("photo host must be a public IP address");
  }
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.get(url, {
      signal,
      lookup: publicLookup,
      agent: false,
      autoSelectFamily: true,
      headers: { "Accept-Encoding": "identity" },
    }, async (res) => {
      try {
        if (REDIRECTS.has(res.statusCode)) {
          const location = res.headers.location;
          res.destroy();
          if (!location) throw new Error("photo redirect has no Location");
          resolve({ location });
          return;
        }
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
        if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") {
          throw new Error("compressed photo responses are not supported");
        }
        if (Number(res.headers["content-length"]) > MAX_PHOTO_BYTES) {
          throw new Error("photo exceeds 5 MiB");
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of res) {
          bytes += chunk.length;
          if (bytes > MAX_PHOTO_BYTES) throw new Error("photo exceeds 5 MiB");
          chunks.push(chunk);
        }
        resolve({ data: Buffer.concat(chunks, bytes) });
      } catch (err) {
        res.destroy();
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export async function downloadPhoto(spec) {
  let url = new URL(validateUrl(spec, "photo"));
  const signal = AbortSignal.timeout(15000);
  for (let redirects = 0; ; redirects++) {
    const result = await requestPhoto(url, signal);
    if (result.data) return result.data;
    if (redirects >= MAX_REDIRECTS) throw new Error("too many photo redirects");
    // Validate each destination, including literal IPs, before opening a socket.
    // Controls must be checked before URL() silently strips them.
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(result.location)) {
      throw new Error("photo redirect must not contain control characters");
    }
    const next = new URL(result.location, url);
    validateUrl(next.href, "photo redirect");
    if (url.protocol === "https:" && next.protocol !== "https:") {
      throw new Error("photo redirect must not downgrade HTTPS");
    }
    url = next;
  }
}
