// Smoke tests: build real configs into temp folders and read the results
// back, with ical.js as an independent check on the vCard.
//   npm test
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { createServer } from "http";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { runInNewContext } from "node:vm";
import ICAL from "ical.js";
import { loadConfig } from "../config.js";
import { buildVCard, fold, withPhoto } from "../vcard.js";

const ROOT = resolve(import.meta.dirname, "..");
const PHOTO = join(ROOT, "photo.jpg");
const run = promisify(execFile);

const temps = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "mecard-test-"));
  temps.push(dir);
  return dir;
}
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// Build `yaml` (or a file in the repo) and return what came out
async function build(yaml, ...flags) {
  const dir = tempDir();
  const config = yaml.endsWith(".yaml") ? join(ROOT, yaml) : join(dir, "config.yaml");
  if (config.startsWith(dir)) writeFileSync(config, yaml);
  const out = join(dir, "dist");
  let result;
  try {
    result = { code: 0, ...(await run(process.execPath, [join(ROOT, "build.js"), "--config", config, "--out", out, ...flags])) };
  } catch (err) {
    result = { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
  const html = existsSync(join(out, "index.html")) ? readFileSync(join(out, "index.html"), "utf-8") : null;
  return { ...result, dir, out, html };
}

const vcardOf = (html) => {
  const b64 = html.match(/href="data:text\/vcard;charset=utf-8;base64,([^"]+)"/)[1];
  return Buffer.from(b64, "base64").toString("utf-8");
};
const parseVCard = (text) => new ICAL.Component(ICAL.parse(text));
// The vCard as saved: the page adds the photo from its <img> on the way out
const savedVCardOf = (html) => withPhoto(vcardOf(html), html.match(/<img class="photo" src="([^"]+)"/)[1]);
const personOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

const BASIC = `name: Ada Lovelace
url: https://example.org/card
`;

test("the example config builds cleanly under --strict", async () => {
  const { code, stderr, out } = await build("config.example.yaml", "--strict");
  assert.equal(code, 0, stderr);
  for (const file of ["index.html", "icon.jpg", "icon-maskable-192.png", "icon-maskable-512.png", "manifest.webmanifest", "sw.js"]) {
    assert.ok(existsSync(join(out, file)), `${file} missing`);
  }
  // With a photo, the photo is the icon; the SVG is only for initials
  assert.ok(!existsSync(join(out, "icon.svg")));
});

test("Android gets maskable PNG icons at their stated sizes", async () => {
  const { out } = await build("config.example.yaml");
  const { icons } = JSON.parse(readFileSync(join(out, "manifest.webmanifest"), "utf-8"));
  const maskable = icons.filter((icon) => icon.purpose === "maskable");
  assert.deepEqual(maskable.map((icon) => icon.sizes), ["192x192", "512x512"]);
  for (const icon of maskable) {
    const png = readFileSync(join(out, icon.src));
    assert.equal(png.readUInt32BE(0), 0x89504e47, `${icon.src} isn't a PNG`);
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  assert.ok(icons.some((icon) => icon.purpose === "any"), "browsers still want a plain icon too");
});

test("the example's vCard parses, with every field intact", async () => {
  const { html } = await build("config.example.yaml");
  assert.doesNotMatch(vcardOf(html), /PHOTO/, "the page shouldn't carry the photo twice");
  assert.match(html, /function withPhoto\(/, "the page needs withPhoto to add it back");

  const text = savedVCardOf(html);
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `over 75 octets: ${line}`);

  const card = parseVCard(text);
  const value = (name) => card.getFirstPropertyValue(name);
  assert.equal(value("version"), "3.0");
  assert.equal(value("fn"), "Ada Lovelace");
  assert.deepEqual(value("n"), ["Lovelace", "Ada", "", "", ""]);
  assert.deepEqual(value("org"), ["Example University", "Department of Mathematics"]);
  assert.equal(value("title"), "Research Fellow");
  assert.equal(value("note"), "Analytical Engines");
  assert.equal(value("email"), "ada@example.edu");
  assert.ok(value("photo"), "photo missing");

  // Links ride along as grouped URLs with iOS labels
  const labels = Object.fromEntries(
    card.getAllProperties("x-ablabel").map((p) => [p.getParameter("group"), p.getFirstValue()])
  );
  const labelled = card
    .getAllProperties("url")
    .filter((p) => p.getParameter("group"))
    .map((p) => [labels[p.getParameter("group")], p.getFirstValue()]);
  assert.deepEqual(labelled[0], ["Digital card", "https://username.github.io/mecard"]);
  assert.ok(labelled.some(([label, url]) => label === "Google Scholar" && url.includes("scholar.google")));
});

test("vCard text is escaped and folded on character boundaries", () => {
  const config = {
    name: "Johannes Diderik van der Waals",
    nameParts: { given: "Johannes Diderik", middle: "", family: "van der Waals", prefix: "Prof.", suffix: "Jr." },
    title: "Professor, Physics; Thermodynamics",
    tagline: "Line one\nLine two",
    organization: "Universiteit van Amsterdam, Faculteit der Natuurwetenschappen",
    department: "Natuurkunde",
    email: "jdw@example.nl",
    website: null,
    url: "https://example.nl/card",
    links: [{ label: "Ångström, Ørsted & Ærø — ½ × ∞ lines of text that run long enough to fold", url: "https://example.nl" }],
  };
  const text = buildVCard(config, null);
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `over 75 octets: ${line}`);

  const card = parseVCard(text);
  assert.deepEqual(card.getFirstPropertyValue("n"), ["van der Waals", "Johannes Diderik", "", "Prof.", "Jr."]);
  // vCard 3.0 requires "\;" in text, but ical.js follows vCard 4 and leaves it escaped
  assert.equal(card.getFirstPropertyValue("title").replaceAll("\\;", ";"), config.title);
  assert.equal(card.getFirstPropertyValue("note"), config.tagline);
  assert.equal(card.getFirstPropertyValue("org")[0], config.organization);
  assert.equal(card.getFirstPropertyValue("x-ablabel"), "Digital card");
  // ical.js treats X- properties as opaque, so their escapes are still in place
  const label = card.getAllProperties("x-ablabel")[1].getFirstValue().replace(/\\([\\,;])/g, "$1");
  assert.equal(label, config.links[0].label);
});

test("fold never splits a multi-byte character", () => {
  const line = "NOTE:" + "é∞😀".repeat(40);
  const folded = fold(line);
  for (const part of folded.split("\r\n")) {
    assert.ok(Buffer.byteLength(part) <= 75);
    assert.ok(!part.includes("�"));
  }
  assert.equal(folded.replace(/\r\n /g, ""), line);
});

test("config mistakes are warned about, with suggestions", () => {
  const dir = tempDir();
  const file = join(dir, "config.yaml");
  writeFileSync(
    file,
    `name: Ada
url: example.org/card
emial: ada@example.org
lang: not a language
theme:
  dark: #1e1e22
  accent: "#abc"
  pop: teal
links:
  - label: Scholar
    url: https://scholar.google.com
    icon: scholr
  - label: Nowhere
backgrounds: [spectrum, wave]
`
  );
  const warnings = [];
  const config = loadConfig(file, (msg) => warnings.push(msg));
  const has = (text) => assert.ok(warnings.some((w) => w.includes(text)), `no warning mentions "${text}":\n${warnings.join("\n")}`);

  has("did you mean email?");
  has("theme.dark is blank — colours need quotes");
  has("theme.pop: teal isn't a hex colour");
  has("did you mean scholar?");
  has("links[2] (Nowhere) has no url");
  has("did you mean waves?");
  has("lang should be a language tag");
  has("url has no https://");

  assert.equal(config.url, "https://example.org/card");
  assert.equal(config.theme.accent, "#aabbcc");
  assert.equal(config.lang, "en");
  assert.equal(config.links.length, 1);
  assert.deepEqual(config.backgrounds, ["spectrum"]);
});

test("--strict refuses to build with warnings", async () => {
  const { code, stderr, html } = await build(`${BASIC}emial: ada@example.org\n`, "--strict");
  assert.equal(code, 1);
  assert.match(stderr, /did you mean email/);
  assert.equal(html, null);
});

test("a missing required key stops the build", async () => {
  const { code, stderr } = await build("name: Ada\n");
  assert.equal(code, 1);
  assert.match(stderr, /missing required key: url/);
});

test("the now line shows until its date, then drops out", async () => {
  const soon = await build(`${BASIC}now:\n  text: At DAMOP <2099>\n  until: 2099-06-05\n`);
  assert.match(soon.html, /<p class="now" data-until="2099-06-05">/);
  assert.match(soon.html, /At DAMOP &lt;2099&gt;/);

  const past = await build(`${BASIC}now:\n  text: At DAMOP 2001\n  until: 2001-06-05\n`);
  assert.doesNotMatch(past.html, /class="now"/);

  const plain = await build(`${BASIC}now: Back in the lab\n`);
  assert.match(plain.html, /<p class="now">.*Back in the lab/);
});

test("schema.org Person lists profiles, not files", async () => {
  const { html } = await build("config.example.yaml");
  const person = personOf(html);
  assert.equal(person["@type"], "Person");
  assert.equal(person.name, "Ada Lovelace");
  assert.equal(person.jobTitle, "Research Fellow");
  assert.equal(person.worksFor.name, "Example University");
  assert.equal(person.image, "https://username.github.io/mecard/icon.jpg");
  assert.ok(person.sameAs.some((u) => u.includes("orcid.org")));
  assert.ok(!person.sameAs.some((u) => u.endsWith(".pdf")), "the CV is a file, not a profile");
});

test("lang, custom icons and </script> in values come through safely", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "star.svg"), `<?xml version="1.0"?>\n<!-- a star -->\n<svg viewBox="0 0 24 24"><path id="star" d="M12 2l3 7h7l-6 5 2 7-6-4-6 4 2-7-6-5h7z"/></svg>`);
  const yaml = `${BASIC}title: "</script><b>"\nlang: de\nlinks:\n  - label: Star\n    url: https://example.org\n    icon: ${join(dir, "star.svg")}\n`;
  const { html } = await build(yaml);
  assert.match(html, /<html lang="de">/);
  assert.match(html, /<svg viewBox="0 0 24 24"><path id="star"/);
  assert.doesNotMatch(html, /<\?xml|a star/);
  // Only the page's own closing tags appear raw
  assert.equal(html.split("</script>").length - 1, html.split("<script").length - 1);
});

test("a private-network photo is refused before making a request", async (t) => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end(readFileSync(PHOTO));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const { port } = server.address();

  const { code, stderr, html, out } = await build(`${BASIC}photo: http://127.0.0.1:${port}/me.jpg\n`);
  assert.equal(code, 0, stderr);
  assert.match(stderr, /public IP address/);
  assert.doesNotMatch(html, /<img class="photo"/);
  assert.ok(!existsSync(join(out, "icon.jpg")));
  assert.equal(requests, 0);
  const strict = await build(`${BASIC}photo: http://127.0.0.1:${port}/me.jpg\n`, "--strict");
  assert.equal(strict.code, 1);
  assert.equal(strict.html, null);
  assert.equal(requests, 0);
});

test("malicious file and inline SVGs never reach the built page", async () => {
  const dir = tempDir();
  const attack = '<svg viewBox="0 0 24 24" onload="window.__svgAttack=1"><script>window.__svgAttack=1</script></svg>';
  writeFileSync(join(dir, "bad.svg"), attack);
  const yaml = `${BASIC}links:\n  - label: File\n    url: https://example.org\n    icon: ${join(dir, "bad.svg")}\n  - label: Inline\n    url: https://example.org\n    icon: '${attack}'\n`;
  const { code, stderr, html } = await build(yaml);
  assert.equal(code, 0, stderr);
  assert.match(stderr, /unsafe, unsupported or invalid SVG/);
  assert.doesNotMatch(html, /__svgAttack|onload=/);
  const strict = await build(yaml, "--strict");
  assert.equal(strict.code, 1);
  assert.equal(strict.html, null);
});

// Execute the generated worker's event handlers against an in-memory cache
// store shared by several scopes, just like CacheStorage on one origin.
function worker(source, scope, store) {
  const events = {};
  let online = true;
  const key = (request) => new URL(typeof request === "string" ? request : request.url, scope).href;
  runInNewContext(source, {
    self: {
      registration: { scope },
      addEventListener: (name, handler) => { events[name] = handler; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      keys: async () => [...store.keys()],
      delete: async (name) => store.delete(name),
      open: async (name) => {
        if (!store.has(name)) store.set(name, new Map());
        const cache = store.get(name);
        return {
          addAll: async (assets) => assets.forEach((asset) => cache.set(key(asset), `${scope}:${asset}`)),
          match: async (request) => cache.get(key(request)),
        };
      },
      match: () => { throw new Error("must not search other applications' caches"); },
    },
    fetch: async () => {
      if (!online) throw new Error("offline");
      return "network response";
    },
  }, { timeout: 1000 });
  return {
    offline: () => { online = false; },
    dispatch: (name, request) => {
      let promise;
      events[name]({ request, waitUntil: (p) => { promise = p; }, respondWith: (p) => { promise = p; } });
      return promise;
    },
  };
}

test("service workers preserve caches of other applications and other cards", async () => {
  const { code, stderr, out } = await build(BASIC);
  assert.equal(code, 0, stderr);
  const source = readFileSync(join(out, "sw.js"), "utf-8");
  const a = "https://example.org/card-a/", b = `${a}-nested/`;
  const oldA = `mecard-${encodeURIComponent(a)}:old`;
  const oldB = `mecard-${encodeURIComponent(b)}:old`;
  const store = new Map([oldA, oldB, "other-app-cache", "mecard-legacy"].map((name) => [name, new Map()]));
  const first = worker(source, a, store), second = worker(source, b, store);
  await first.dispatch("install");
  await second.dispatch("install");
  const installed = [...store.keys()].filter((name) => ![oldA, oldB, "other-app-cache", "mecard-legacy"].includes(name));
  assert.equal(installed.length, 2, "identical builds at different paths need separate caches");
  await first.dispatch("activate");
  assert.equal(store.has(oldA), false);
  for (const name of [oldB, "other-app-cache", "mecard-legacy", ...installed]) assert.equal(store.has(name), true, name);
  await second.dispatch("activate");
  assert.equal(store.has(oldB), false);
  for (const name of ["other-app-cache", "mecard-legacy", ...installed]) assert.equal(store.has(name), true, name);

  // A foreign cache must not supply assets for this card.
  const url = `${a}unlisted.png`;
  store.get("other-app-cache").set(url, "foreign response");
  assert.equal(await first.dispatch("fetch", { method: "GET", mode: "cors", url }), "network response");
  first.offline();
  assert.equal(await first.dispatch("fetch", { method: "GET", mode: "navigate", url: a }), `${a}:index.html`);
});

test("turning PWA off clears the old PWA files", async () => {
  const first = await build(`${BASIC}photo: ${PHOTO}\n`);
  assert.ok(existsSync(join(first.out, "sw.js")));
  writeFileSync(join(first.dir, "config.yaml"), `${BASIC}photo: ${PHOTO}\noptions:\n  pwa: false\n`);
  await run(process.execPath, [join(ROOT, "build.js"), "--config", join(first.dir, "config.yaml"), "--out", first.out]);
  for (const file of ["sw.js", "manifest.webmanifest", "icon.jpg"]) {
    assert.ok(!existsSync(join(first.out, file)), `${file} left behind`);
  }
});

test("without a photo, the initials become the icon", async () => {
  const { html, out } = await build(BASIC);
  assert.match(html, /<div class="photo photo-initials">AL<\/div>/);
  assert.match(readFileSync(join(out, "icon.svg"), "utf-8"), />AL<\/text>/);
  assert.match(html, /<link rel="icon" href="icon.svg" type="image\/svg\+xml">/);
  assert.match(readFileSync(join(out, "manifest.webmanifest"), "utf-8"), /"src": "icon.svg"/);
  assert.ok(existsSync(join(out, "icon-maskable-512.png")));
});

test("a renamed option still works, with a warning", async () => {
  const { stderr, html } = await build(`${BASIC}backgrounds: [waves]\noptions:\n  waves: false\n`);
  assert.match(stderr, /options.waves is now called options.animateWaves/);
  assert.match(html, /class="wave-layer layer-dark"/);
  assert.doesNotMatch(html, /<animate attributeName="d"/);
});

test("the stylesheet uses only variables the theme defines", async () => {
  const { html } = await build("config.example.yaml");
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const used = new Set([...css.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]));
  const defined = new Set([...css.matchAll(/--([\w-]+):/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((v) => !defined.has(v)), []);
  assert.deepEqual([...defined].filter((v) => !used.has(v)), []);
});
