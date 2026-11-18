// Smoke tests: build real configs into temp folders and read the results
// back, with ical.js as an independent check on the vCard.
//   npm test
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "fs";
import { createServer } from "http";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { runInNewContext } from "node:vm";
import ICAL from "ical.js";
import { loadConfig } from "../config.js";
import { buildVCard, fold, withPhoto } from "../vcard.js";

const ROOT = resolve(import.meta.dirname, "..");
const run = promisify(execFile);

const temps = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "mecard-test-"));
  temps.push(dir);
  return dir;
}
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// Generated 2×2 solid-colour JPEG used only by tests.
const PHOTO = join(tempDir(), "photo.jpg");
writeFileSync(PHOTO, Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/" +
  "2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/" +
  "8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIABgA//2Q==",
  "base64"
));
const PROFILE = JSON.stringify({
  name: "Test Person",
  title: "Test Role",
  tagline: "Test Note",
  organization: "Test Organization",
  department: "Test Department",
  email: "contact@example.test",
  website: "https://example.test/",
  url: "https://example.test/card",
  photo: PHOTO,
  links: [
    { label: "Profile", url: "https://profiles.example.test/test", icon: "globe" },
    { label: "Document", url: "https://example.test/document.pdf", icon: "file" },
  ],
});

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

const BASIC = `name: Test Person
url: https://example.org/card
`;

test("all configured languages share one HTML page, one portrait and localized contacts", async () => {
  const injection = '</script><img src=x onerror="alert(1)">';
  const { code, stderr, html, out } = await build(JSON.stringify({
    name: "Test Person", url: "https://example.test/card", lang: "fr",
    photo: PHOTO,
    options: { pwa: false, paper: true },
    logo: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#575086"/></svg>',
    translations: {
      fr: { title: "Directrice technique", tagline: "Des documents aux données", department: "Recherche" },
      en: { title: "CTO", tagline: injection },
      de: { title: "Technische Leitung", labels: { saveLabel: "Kontakt speichern", digitalCard: "Visitenkarte" } },
      ja: { title: "技術責任者", labels: { saveLabel: "連絡先を保存" } },
      ar: { title: "مدير تقني", dir: "rtl", labels: { saveLabel: "حفظ جهة الاتصال" } },
    },
  }), "--strict");
  assert.equal(code, 0, stderr);
  assert.deepEqual(readdirSync(out), ["favicon.png", "index.html"]);
  assert.match(html, /<html lang="fr" dir="ltr">/);
  assert.match(html, /<select data-language-select>/);
  assert.doesNotMatch(html, /href="[^\"]*\/en\/index\.html"/);
  assert.equal((html.match(/<img class="photo"/g) || []).length, 1);
  assert.equal((html.match(/<main /g) || []).length, 1);
  const raw = html.match(/<script type="application\/json" id="card-locales">([\s\S]*?)<\/script>/)[1];
  const translations = JSON.parse(raw);
  assert.deepEqual(Object.keys(translations), ["fr", "en", "de", "ja", "ar"]);
  assert.equal(translations.en.text.tagline, injection);
  assert.ok(!raw.includes("<"), "translated text cannot close the data script");
  assert.ok(!html.includes(injection));
  assert.equal(translations.ar.dir, "rtl");
  assert.equal(translations.ja.text.saveLabel, "連絡先を保存");
  // Alternate translations reserve layout space but are never announced or
  // updated by the language switch; only the active child has data-i18n.
  const title = html.match(/class="sub-title">([\s\S]*?)<\/span>\s*<\/span>/)[1];
  assert.match(title, /data-i18n="title" data-hide-empty>Directrice technique<\/span>/);
  assert.match(html, /class="sub-org"><span class="i18n-slot"><span data-i18n="org" data-hide-empty>Recherche<\/span>/);
  const sizes = [...html.matchAll(/<span class="i18n-size"([^>]*)>([\s\S]*?)<\/span>/g)];
  assert.ok(sizes.length > 0);
  for (const [, attributes] of sizes) {
    assert.match(attributes, /aria-hidden="true" inert lang="[^"]+" dir="(?:ltr|rtl)"/);
    assert.doesNotMatch(attributes, /data-i18n/);
  }
  assert.ok(sizes.some(([, attrs, text]) => attrs.includes('lang="ar" dir="rtl"') && text === 'مدير تقني'));
  assert.ok(sizes.some(([, , text]) => text === '&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  const share = html.match(/<button[^>]+class="action-btn share-btn share-icon"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(share, /aria-label="Partager" data-i18n-aria="shareLabel"/);
  assert.match(share, /title="Partager" data-i18n-title="shareLabel" hidden/);
  assert.match(share, /<svg aria-hidden="true"/);
  assert.equal((share.match(/<circle /g) ?? []).length, 3);
  assert.doesNotMatch(share, /<span/);
  assert.equal(parseVCard(vcardOf(html)).getFirstPropertyValue("title"), "Directrice technique");
  for (const [lang, text] of Object.entries(translations)) {
    assert.doesNotMatch(text.vcard, /PHOTO;/, `${lang} duplicates the portrait`);
    assert.equal(parseVCard(text.vcard).getFirstPropertyValue("title"), text.text.title);
  }
  assert.equal(parseVCard(translations.de.vcard).getFirstPropertyValue("x-ablabel"), "Visitenkarte");
});

test("--lang sets the initial language without discarding the other translations", async () => {
  const { code, stderr, html, out } = await build(JSON.stringify({
    name: "Test Person", url: "https://example.test/card",
    options: { pwa: false },
    translations: { fr: { title: "Direction" }, en: { title: "Director" } },
  }), "--strict", "--lang", "en");
  assert.equal(code, 0, stderr);
  assert.deepEqual(readdirSync(out), ["favicon.png", "index.html"]);
  assert.match(html, /<html lang="en"/);
  assert.match(html, /data-language="fr"[^>]*aria-pressed="false"/);
  assert.match(html, /data-language="en"[^>]*aria-pressed="true"/);
  assert.equal(parseVCard(vcardOf(html)).getFirstPropertyValue("title"), "Director");
});

test("strict builds validate inactive translations before writing the page", async () => {
  const { code, html, stderr } = await build(JSON.stringify({
    name: "Test Person", url: "https://example.test/card", lang: "fr",
    options: { pwa: false },
    translations: { en: { labels: { saveLabel: { invalid: "text" } } } },
  }), "--strict");
  assert.equal(code, 1);
  assert.equal(html, null);
  assert.match(stderr, /en: labels.saveLabel should be text/);
});

test("a complete synthetic profile builds cleanly under --strict", async () => {
  const { code, stderr, out } = await build(PROFILE, "--strict");
  assert.equal(code, 0, stderr);
  for (const file of ["index.html", "icon.jpg", "icon-maskable-192.png", "icon-maskable-512.png", "manifest.webmanifest", "sw.js"]) {
    assert.ok(existsSync(join(out, file)), `${file} missing`);
  }
  // With a photo, the photo is the icon; the SVG is only for initials
  assert.ok(!existsSync(join(out, "icon.svg")));
});

test("Android gets maskable PNG icons at their stated sizes", async () => {
  const { out } = await build(PROFILE);
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

test("a complete synthetic vCard parses, with every field intact", async () => {
  const { html } = await build(PROFILE);
  assert.doesNotMatch(vcardOf(html), /PHOTO/, "the page shouldn't carry the photo twice");
  assert.match(html, /function withPhoto\(/, "the page needs withPhoto to add it back");

  const text = savedVCardOf(html);
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `over 75 octets: ${line}`);

  const card = parseVCard(text);
  const value = (name) => card.getFirstPropertyValue(name);
  assert.equal(value("version"), "3.0");
  assert.equal(value("fn"), "Test Person");
  assert.deepEqual(value("n"), ["Person", "Test", "", "", ""]);
  assert.deepEqual(value("org"), ["Test Organization", "Test Department"]);
  assert.equal(value("title"), "Test Role");
  assert.equal(value("note"), "Test Note");
  assert.equal(value("email"), "contact@example.test");
  assert.ok(value("photo"), "photo missing");

  // Links ride along as grouped URLs with iOS labels
  const labels = Object.fromEntries(
    card.getAllProperties("x-ablabel").map((p) => [p.getParameter("group"), p.getFirstValue()])
  );
  const labelled = card
    .getAllProperties("url")
    .filter((p) => p.getParameter("group"))
    .map((p) => [labels[p.getParameter("group")], p.getFirstValue()]);
  assert.deepEqual(labelled[0], ["Digital card", "https://example.test/card"]);
  assert.ok(labelled.some(([label, url]) => label === "Profile" && url.includes("profiles.example.test")));
});

test("vCard text is escaped and folded on character boundaries", () => {
  const config = {
    name: "First Middle van der Test",
    nameParts: { given: "First Middle", middle: "", family: "van der Test", prefix: "Prof.", suffix: "Jr." },
    title: "Professor, Physics; Thermodynamics",
    tagline: "Line one\nLine two",
    organization: "Test Research Institute, Department of Physics",
    department: "Test Department",
    email: "contact@example.test",
    website: null,
    url: "https://example.nl/card",
    links: [{ label: "Ångström, Ørsted & Ærø — ½ × ∞ lines of text that run long enough to fold", url: "https://example.nl" }],
  };
  const text = buildVCard(config, null);
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `over 75 octets: ${line}`);

  const card = parseVCard(text);
  assert.deepEqual(card.getFirstPropertyValue("n"), ["van der Test", "First Middle", "", "Prof.", "Jr."]);
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
    `name: Test Person
url: example.org/card
emial: contact@example.test
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
  const { code, stderr, html } = await build(`${BASIC}emial: contact@example.test\n`, "--strict");
  assert.equal(code, 1);
  assert.match(stderr, /did you mean email/);
  assert.equal(html, null);
});

test("a missing required key stops the build", async () => {
  const { code, stderr } = await build("name: Test Person\n");
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
  const { html } = await build(PROFILE);
  const person = personOf(html);
  assert.equal(person["@type"], "Person");
  assert.equal(person.name, "Test Person");
  assert.equal(person.jobTitle, "Test Role");
  assert.equal(person.worksFor.name, "Test Organization");
  assert.equal(person.image, "https://example.test/card/icon.jpg");
  assert.ok(person.sameAs.some((u) => u.includes("profiles.example.test")));
  assert.ok(!person.sameAs.some((u) => u.endsWith(".pdf")), "the CV is a file, not a profile");
});

test("lang, custom icons and </script> in values come through safely", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "star.svg"), `<?xml version="1.0"?>\n<!-- a star -->\n<svg viewBox="0 0 24 24"><path id="star" d="M12 2l3 7h7l-6 5 2 7-6-4-6 4 2-7-6-5h7z"/></svg>`);
  const yaml = `${BASIC}title: "</script><b>"\nlang: de\nlinks:\n  - label: Star\n    url: https://example.org\n    icon: ${join(dir, "star.svg")}\n`;
  const { html } = await build(yaml);
  assert.match(html, /<html lang="de"/);
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
  const { code, stderr, out, html } = await build(BASIC);
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
  const faviconHref = html.match(/<link rel="icon" href="([^"]+)"/)[1];
  assert.equal(await first.dispatch("fetch", { method: "GET", mode: "no-cors", url: new URL(faviconHref, a).href }), `${a}:${faviconHref}`);
});

test("turning PWA off clears the old PWA files", async () => {
  const first = await build(`${BASIC}photo: ${PHOTO}\n`);
  assert.ok(existsSync(join(first.out, "sw.js")));
  writeFileSync(join(first.dir, "config.yaml"), `${BASIC}photo: ${PHOTO}\noptions:\n  pwa: false\n`);
  await run(process.execPath, [join(ROOT, "build.js"), "--config", join(first.dir, "config.yaml"), "--out", first.out]);
  for (const file of ["sw.js", "manifest.webmanifest", "icon.jpg"]) {
    assert.ok(!existsSync(join(first.out, file)), `${file} left behind`);
  }
  const png = readFileSync(join(first.out, "favicon.png"));
  assert.equal(png.readUInt32BE(0), 0x89504e47);
  assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, '64x64');
  const html = readFileSync(join(first.out, "index.html"), "utf8");
  assert.match(html, /<link rel="icon" href="favicon.png\?v=[a-f0-9]{12}" type="image\/png" sizes="64x64">/);
});

test("without a photo, the initials become the icon", async () => {
  const { html, out } = await build(BASIC);
  assert.match(html, /<div class="photo photo-initials">TP<\/div>/);
  assert.match(readFileSync(join(out, "icon.svg"), "utf-8"), />TP<\/text>/);
  assert.match(html, /<link rel="icon" href="favicon.png\?v=[a-f0-9]{12}" type="image\/png" sizes="64x64">/);
  assert.ok(existsSync(join(out, "favicon.png")));
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
  const { html } = await build(PROFILE);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const used = new Set([...css.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]));
  const defined = new Set([...css.matchAll(/--([\w-]+):/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((v) => !defined.has(v)), []);
  assert.deepEqual([...defined].filter((v) => !used.has(v)), []);
});
