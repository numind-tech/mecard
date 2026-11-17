import { test } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { isIP } from "node:net";
import { downloadPhoto, isPublicAddress, MAX_PHOTO_BYTES } from "../photo.js";

// Replace only DNS and the wire transport: validation, redirects and streamed
// size limits run through the real downloader without contacting the internet.
function network(t, routes, resolve = () => [{ address: "93.184.216.34", family: 4 }]) {
  const connections = [], lookups = [], requests = [], responses = [];
  t.mock.method(dns, "lookup", (host, options, callback) => {
    lookups.push(host);
    queueMicrotask(() => callback(null, resolve(host, lookups.length)));
  });
  function get(url, options, respond) {
    const request = new EventEmitter();
    requests.push({ url: url.href, options });
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const connected = (error, address) => {
      if (error) { request.emit("error", error); return; }
      connections.push({ url: url.href, address });
      const route = routes[url.href];
      if (!route) { request.emit("error", new Error(`unexpected request: ${url.href}`)); return; }
      const response = Readable.from(route.chunks ?? [Buffer.from("photo")]);
      response.statusCode = route.status ?? 200;
      response.headers = route.headers ?? {};
      responses.push(response);
      respond(response);
    };
    queueMicrotask(() => {
      if (options.signal.aborted) request.emit("error", options.signal.reason);
      else if (isIP(host)) connected(null, host);
      else options.lookup(host, { all: options.autoSelectFamily }, (error, addresses) => {
        connected(error, Array.isArray(addresses) ? addresses[0].address : addresses);
      });
    });
    return request;
  }
  t.mock.method(http, "get", get);
  t.mock.method(https, "get", get);
  return { connections, lookups, requests, responses };
}

test("private, reserved and IPv4-embedded IPv6 addresses are not public photos", () => {
  for (const address of [
    "127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "224.0.0.1", "255.255.255.255", "192.0.2.1", "198.18.0.1",
    "::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "not-an-ip",
  ]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("literal private IPs, including alternate IPv4 notation, never open a connection", async (t) => {
  const wire = network(t, {});
  for (const host of ["127.0.0.1", "127.1", "2130706433", "0x7f000001", "[::1]", "[::ffff:127.0.0.1]"]) {
    await assert.rejects(downloadPhoto(`http://${host}/photo.jpg`), /public IP/);
  }
  assert.equal(wire.requests.length, 0);
});

test("private DNS answers and mixed public/private answers are rejected before connection", async (t) => {
  let addresses = [{ address: "127.0.0.1", family: 4 }];
  const wire = network(t, {}, () => addresses);
  await assert.rejects(downloadPhoto("https://photo.example/image"), /public IP/);
  addresses = [{ address: "8.8.8.8", family: 4 }, { address: "fd00::1", family: 6 }];
  await assert.rejects(downloadPhoto("https://photo.example/image"), /public IP/);
  assert.equal(wire.connections.length, 0);
});

test("public downloads use the validated DNS result and preserve photo bytes", async (t) => {
  const bytes = Buffer.from([255, 216, 255, 1, 2, 3]);
  const wire = network(t, { "https://photo.example/image": { chunks: [bytes.subarray(0, 3), bytes.subarray(3)] } });
  assert.deepEqual(await downloadPhoto("https://photo.example/image"), bytes);
  assert.deepEqual(wire.lookups, ["photo.example"]);
  assert.equal(wire.connections[0].address, "93.184.216.34");
  assert.equal(wire.requests[0].options.agent, false);
});

test("every redirect destination is checked before connecting", async (t) => {
  const wire = network(t, {
    "https://photo.example/image": { status: 302, headers: { location: "https://127.0.0.1/private" } },
  });
  await assert.rejects(downloadPhoto("https://photo.example/image"), /public IP/);
  assert.equal(wire.connections.length, 1);
  assert.equal(wire.responses[0].destroyed, true);
});

test("DNS rebinding on a redirect cannot switch the socket to a private address", async (t) => {
  const wire = network(t, {
    "https://photo.example/image": { status: 302, headers: { location: "/next" } },
  }, (_, call) => [{ address: call === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }]);
  await assert.rejects(downloadPhoto("https://photo.example/image"), /public IP/);
  assert.equal(wire.connections.length, 1);
  assert.equal(wire.lookups.length, 2);
});

test("relative public redirects work and share one overall timeout", async (t) => {
  const wire = network(t, {
    "https://photo.example/image": { status: 302, headers: { location: "/next" } },
    "https://photo.example/next": { chunks: [Buffer.from("redirected photo")] },
  });
  assert.equal((await downloadPhoto("https://photo.example/image")).toString(), "redirected photo");
  assert.equal(wire.requests[0].options.signal, wire.requests[1].options.signal);
});

test("redirects cannot downgrade HTTPS, change to unsafe schemes or supply credentials", async (t) => {
  const route = { status: 302, headers: {} };
  const wire = network(t, { "https://photo.example/image": route });
  for (const location of ["http://photo.example/image", "file:///etc/passwd", "https://user:pass@photo.example/image", "/a\r\nb"]) {
    route.headers.location = location;
    await assert.rejects(downloadPhoto("https://photo.example/image"), /downgrade|must use|control characters/);
  }
  assert.equal(wire.connections.length, 4);
});

test("redirect loops stop after three hops", async (t) => {
  const wire = network(t, {
    "https://photo.example/image": { status: 302, headers: { location: "/image" } },
  });
  await assert.rejects(downloadPhoto("https://photo.example/image"), /too many photo redirects/);
  assert.equal(wire.connections.length, 4);
});

test("oversized declared bodies are rejected without consuming them", async (t) => {
  let consumed = false;
  const wire = network(t, {
    "https://photo.example/image": {
      headers: { "content-length": String(MAX_PHOTO_BYTES + 1) },
      chunks: (function* () { consumed = true; yield Buffer.from("unused"); })(),
    },
  });
  await assert.rejects(downloadPhoto("https://photo.example/image"), /exceeds 5 MiB/);
  assert.equal(consumed, false);
  assert.equal(wire.responses[0].destroyed, true);
});

test("the streamed size limit also applies without a Content-Length header", async (t) => {
  const wire = network(t, {
    "https://photo.example/image": { chunks: [Buffer.alloc(MAX_PHOTO_BYTES), Buffer.from([0])] },
  });
  await assert.rejects(downloadPhoto("https://photo.example/image"), /exceeds 5 MiB/);
  assert.equal(wire.responses[0].destroyed, true);
});

test("photos exactly at the size limit are accepted", async (t) => {
  network(t, { "https://photo.example/image": { chunks: [Buffer.alloc(MAX_PHOTO_BYTES)] } });
  assert.equal((await downloadPhoto("https://photo.example/image")).length, MAX_PHOTO_BYTES);
});

test("compressed responses are refused instead of bypassing the byte limit", async (t) => {
  network(t, { "https://photo.example/image": { headers: { "content-encoding": "gzip" } } });
  await assert.rejects(downloadPhoto("https://photo.example/image"), /compressed photo/);
});
