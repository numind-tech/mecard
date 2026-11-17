import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ICAL from "ical.js";
import { loadConfig, loadIcon } from "../config.js";
import { cleanSvg } from "../svg.js";
import { ICONS } from "../icons.js";
import { buildVCard } from "../vcard.js";

const dir = mkdtempSync(join(tmpdir(), "mecard-security-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const basic = { name: "Ada", url: "https://example.org/card", links: [] };

function config(values) {
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify({ ...basic, ...values }));
  return loadConfig(file);
}

test("all configured URL fields reject executable schemes and embedded controls", () => {
  const attacks = [
    "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd",
    "https://example.org/\r\nEMAIL:injected@example.org", "https://example.org/\nNOTE:injected",
    "https://example.org/\rTEL:+123", "java\tscript:alert(1)", "https://example.org/\u0000",
    "https://user:password@example.org/", "https://[invalid",
  ];
  for (const url of attacks) {
    for (const values of [{ url }, { website: url }, { now: { text: "Now", url } }, { links: [{ label: "Link", url }] }]) {
      assert.throws(() => config(values), /control characters|must use|valid URL/, JSON.stringify(values));
    }
  }
});

test("web links and deliberate mailto/tel links remain usable", () => {
  const links = ["https://example.org/a?x=1&y=2", "http://example.org", "mailto:ada@example.org", "tel:+33123456789"];
  const result = config({ links: links.map((url) => ({ label: "Link", url })) });
  assert.deepEqual(result.links.map((link) => link.url), links);
  assert.throws(() => config({ website: "mailto:ada@example.org" }), /must use/);
});

test("vCard rejects URL injection even when called without the config loader", () => {
  for (const separator of ["\r\n", "\r", "\n", "\t", "\u0000"]) {
    const url = `https://example.org/${separator}EMAIL:injected@example.org`;
    for (const values of [{ url }, { website: url }, { links: [{ label: "Link", url }] }]) {
      assert.throws(() => buildVCard({ ...basic, ...values }), /control characters/);
    }
  }
  assert.throws(() => buildVCard({ ...basic, links: [{ label: "Bad", url: "javascript:alert(1)" }] }), /must use/);
});

test("vCard escapes all newline forms in text without adding properties", () => {
  const text = buildVCard({ ...basic, tagline: "one\rEMAIL:fake\ntwo\r\nthree" });
  const parsed = new ICAL.Component(ICAL.parse(text));
  assert.equal(parsed.getAllProperties("email").length, 0);
  assert.equal(parsed.getFirstPropertyValue("note"), "one\nEMAIL:fake\ntwo\nthree");
});

const unsafeIcons = [
  '<svg viewBox="0 0 24 24" onload="alert(1)"></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(1)"/></foreignObject></svg>',
  '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
  '<svg><use href="https://example.org/icon.svg#x"/></svg>',
  '<svg><image href="file:///etc/passwd"/></svg>',
  '<svg><style>@import "https://example.org/track";</style></svg>',
  '<svg style="background:url(https://example.org/track)"></svg>',
  '<svg><path fill="url(https://example.org/track)"/></svg>',
  '<svg><path fill="&#117;rl(https://example.org/track)"/></svg>',
  '<svg xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></svg>',
  '<svg><g xmlns="http://www.w3.org/1999/xhtml"/></svg>',
  '<svg><path onload="alert(1)" onload="alert(2)"/></svg>',
  '<svg></svg><script>alert(1)</script><svg></svg>',
  '<svg><g></svg>',
  '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
  '<?xml-stylesheet href="https://example.org/track"?><svg/>',
];

test("custom SVGs reject active content, external references and malformed XML", () => {
  for (const source of unsafeIcons) {
    const warnings = [];
    assert.equal(cleanSvg(source, (w) => warnings.push(w)), ICONS.link, source);
    assert.match(warnings.join("\n"), /unsafe, unsupported or invalid SVG/);
  }
});

test("file and inline icons pass through the same SVG filter", () => {
  const source = unsafeIcons[0];
  writeFileSync(join(dir, "bad.svg"), source);
  for (const spec of [source, "bad.svg"]) {
    assert.equal(loadIcon(spec, dir, () => {}).icon, ICONS.link);
  }
  assert.equal(loadIcon("__proto__", dir, () => {}).icon, ICONS.link);
});

test("safe SVG geometry, colours and local gradient references survive", () => {
  const warnings = [];
  const source = `<?xml version="1.0"?><!-- comment -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <defs><linearGradient id="paint"><stop offset="0" stop-color="#123456"/></linearGradient></defs>
  <g transform="translate(1 1)"><path d="M0 0 L10 10" stroke="currentColor" fill="url(#paint)"/></g>
  <title>&lt;/title&gt;&lt;script&gt;harmless text&lt;/script&gt;</title>
</svg>`;
  const output = cleanSvg(source, (w) => warnings.push(w));
  assert.deepEqual(warnings, []);
  assert.match(output, /viewBox="0 0 24 24"/);
  assert.match(output, /stroke="currentColor" fill="url\(#paint\)"/);
  assert.match(output, /&lt;script&gt;harmless text&lt;\/script&gt;/);
  assert.doesNotMatch(output, /<script|<\?xml|<!--/);
});

test("decoded attribute entities cannot escape into HTML attributes", () => {
  const output = cleanSvg('<svg viewBox="0 0 24 24"><path id="x&quot; onload=&quot;alert(1)"/></svg>', () => {});
  assert.match(output, /id="x&quot; onload=&quot;alert\(1\)"/);
  assert.doesNotMatch(output, /id="x" onload="/);
});

test("oversized and excessively nested SVGs fall back before reaching the page", () => {
  for (const source of [
    `<svg><desc>${"x".repeat(1024 * 1024)}</desc></svg>`,
    `<svg>${"<g>".repeat(64)}${"</g>".repeat(64)}</svg>`,
  ]) assert.equal(cleanSvg(source, () => {}), ICONS.link);
});
