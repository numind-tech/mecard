import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../config.js";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const temps = [];
after(() => temps.forEach(dir => rmSync(dir, { recursive: true, force: true })));
const json = (path, value) => writeFileSync(path, JSON.stringify(value));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "mecard-site-test-"));
  temps.push(dir);
  mkdirSync(join(dir, "branding"));
  mkdirSync(join(dir, "people"));
  writeFileSync(join(dir, "branding", "logo.svg"), '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
  json(join(dir, "branding", "shared.yaml"), {
    organization: "Test Organization", logo: "logo.svg", lang: "fr",
    theme: { dark: "#123456" }, options: { pwa: false, paper: true, animateWaves: true },
    translations: { fr: { tagline: "Texte commun" }, en: { tagline: "Shared text" } },
  });
  json(join(dir, "people", "first.yaml"), { name: "First Person", translations: { fr: { title: "Direction" }, en: { title: "Director" } } });
  json(join(dir, "people", "second.yaml"), { name: "Second Person", options: { animateWaves: false }, translations: { fr: { title: "Recherche" }, en: { title: "Researcher" } } });
  const site = { url: "https://cards.example.test", redirect: "https://example.test/about", defaults: "branding/shared.yaml", cards: { first: "people/first.yaml", second: "people/second.yaml" } };
  json(join(dir, "site.yaml"), site);
  return { dir, site, out: join(dir, "output") };
}
async function build(f) {
  try { return { code: 0, ...await run(process.execPath, [join(root, "build-site.js"), "--config", join(f.dir, "site.yaml"), "--out", f.out, "--strict"], { cwd: tmpdir() }) }; }
  catch (error) { return { code: error.code, signal: error.signal, stderr: error.stderr || error.message }; }
}
const locales = html => JSON.parse(html.match(/<script type="application\/json" id="card-locales">([\s\S]*?)<\/script>/)[1]);

test("build a complete bilingual site from a separate data directory and shared branding", async () => {
  const f = fixture();
  const result = await build(f);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(readdirSync(f.out).sort(), ["404.html", "_headers", "_redirects", "first", "second"]);
  assert.match(readFileSync(join(f.out, "_headers"), "utf8"), /^\/\*\n  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex\n$/);
  assert.ok(!existsSync(join(f.out, "robots.txt")), "crawlers must be allowed to read noindex");
  assert.equal(readFileSync(join(f.out, "_redirects"), "utf8"), "/ https://example.test/about 302\n");
  for (const slug of ["first", "second"]) {
    assert.deepEqual(readdirSync(join(f.out, slug)), ["favicon.png", "index.html"]);
    const html = readFileSync(join(f.out, slug, "index.html"), "utf8");
    assert.match(html, new RegExp(`https://cards.example.test/${slug}`));
    assert.match(html, /--dark: #123456/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">/);
    assert.match(html, /<circle cx="5"/);
    const translations = locales(html);
    assert.deepEqual(Object.keys(translations), ["fr", "en"]);
    assert.equal(translations.en.text.tagline, "Shared text");
    assert.equal(translations.en.text.title, slug === "first" ? "Director" : "Researcher");
    assert.equal(/<svg class="paper-wave paper-wave-animated"/.test(html), slug === "first");
  }
  assert.ok(existsSync(`${f.out}.mecard.json`), "ownership metadata stays outside published files");
});

test("indexing can be enabled separately for individual cards", async () => {
  const f = fixture();
  json(join(f.dir, "people", "first.yaml"), { name: "Public Person", options: { indexable: true } });
  const result = await build(f);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(readFileSync(join(f.out, "first", "index.html"), "utf8"), /<meta name="robots"/);
  const headers = readFileSync(join(f.out, "_headers"), "utf8");
  assert.match(headers, /^\/second\n  X-Robots-Tag: noindex/);
  assert.match(headers, /\n\/second\/\*\n  X-Robots-Tag: noindex/);
  assert.doesNotMatch(headers, /\/first|^\/\*\n/);
});

test("failed builds preserve the last complete site and successful rebuilds remove obsolete cards", async () => {
  const f = fixture();
  assert.equal((await build(f)).code, 0);
  const first = readFileSync(join(f.out, "first", "index.html"), "utf8");
  json(join(f.dir, "people", "second.yaml"), { name: "Invalid Person", website: "javascript:alert(1)" });
  assert.equal((await build(f)).code, 1);
  assert.equal(readFileSync(join(f.out, "first", "index.html"), "utf8"), first);
  assert.ok(existsSync(join(f.out, "second", "index.html")));
  delete f.site.cards.second;
  delete f.site.redirect;
  json(join(f.dir, "site.yaml"), f.site);
  assert.equal((await build(f)).code, 0);
  assert.ok(!existsSync(join(f.out, "second")));
  assert.ok(!existsSync(join(f.out, "_redirects")));
});

test("unsafe slugs and redirect injection are rejected before publishing files", async () => {
  for (const mutate of [
    site => { site.cards = { "../escape": "people/first.yaml" }; },
    site => { site.redirect = "https://example.test/\n/* https://evil.test 302"; },
    site => { site.url = "https://user:secret@example.test"; },
  ]) {
    const f = fixture(); mutate(f.site); json(join(f.dir, "site.yaml"), f.site);
    assert.equal((await build(f)).code, 1);
    assert.ok(!existsSync(f.out));
  }
});

test("site builds do not replace unowned directories, source data or symlinks", async () => {
  const f = fixture();
  mkdirSync(f.out); writeFileSync(join(f.out, "keep.txt"), "user data");
  assert.equal((await build(f)).code, 1);
  assert.equal(readFileSync(join(f.out, "keep.txt"), "utf8"), "user data");
  assert.equal((await build({ ...f, out: f.dir })).code, 1);
  assert.ok(existsSync(join(f.dir, "site.yaml")));
  const link = join(f.dir, "link"); symlinkSync(f.out, link);
  assert.equal((await build({ ...f, out: link })).code, 1);
  assert.equal(readFileSync(join(f.out, "keep.txt"), "utf8"), "user data");
});

test("shared defaults resolve assets at their source and card overrides replace lists", () => {
  const f = fixture();
  const defaults = join(f.dir, "branding", "shared.yaml");
  const data = JSON.parse(readFileSync(defaults, "utf8"));
  data.logo = " logo.svg ";
  data.links = [{ label: "Shared", url: "https://example.test" }];
  json(defaults, data);
  const card = join(f.dir, "people", "first.yaml");
  json(card, { name: "First Person", links: [], theme: { accent: "#abcdef" } });
  const config = loadConfig(card, assert.fail, undefined, { defaults, url: "https://cards.example.test/first" });
  assert.equal(config.theme.dark, "#123456");
  assert.equal(config.theme.accent, "#abcdef");
  assert.deepEqual(config.links, []);
  assert.match(config.logo, /<circle/);
  assert.equal(config.options.paper, true);
});
