import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";

const dir = mkdtempSync(join(tmpdir(), "mecard-locales-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
function read(overrides = {}, lang, warn) {
  const file = join(dir, `${n++}.yaml`);
  writeFileSync(file, JSON.stringify({ name: "Test Person", url: "https://example.test/card", ...overrides }));
  return loadConfig(file, warn, lang);
}

test("translations share contact details and settings, but use their own text and labels", () => {
  const raw = {
    lang: "fr", title: "Directrice technique", phone: "+33 1 00 00 00 00",
    options: { pwa: false, paper: true, qrLabel: "Carte en ligne" },
    translations: { en: { title: "CTO", tagline: "Documents to data" } },
  };
  const fr = read(raw), en = read(raw, "en");
  assert.deepEqual(fr.languages, ["fr", "en"]);
  assert.equal(fr.options.saveLabel, "Enregistrer le contact");
  assert.equal(fr.options.qrLabel, "Carte en ligne");
  assert.equal(en.options.qrLabel, "Scan to connect");
  assert.equal(en.options.saveLabel, "Save contact");
  assert.equal(en.options.pwa, false);
  assert.equal(en.options.paper, true);
  assert.equal(en.phone, fr.phone);
  assert.equal(en.title, "CTO");
  assert.equal(en.lang, "en");
  assert.equal(en.defaultLang, "fr");
  assert.throws(() => read(raw, "de"), /unknown language/);
});

test("language tags reject unsafe input and duplicate canonical language names", () => {
  for (const lang of ["../en", "/tmp/escape", "en/../../", "en?x", "en\\x", "en%2f..", "en\n", "__proto__"]) {
    assert.throws(() => read({ translations: { [lang]: {} } }), /invalid translation language/, lang);
  }
  assert.throws(() => read({ lang: "fr", translations: { en: {}, EN: {} } }), /duplicate translation language/);
});

test("any number of languages can define their own text and full interface labels", () => {
  const languages = ["fr", "en", "de", "es", "it", "pt-BR", "nl", "pl", "sv", "fi", "ja", "ko", "zh-Hans", "ar", "he"];
  const translations = Object.fromEntries(languages.map((lang) => [lang, {
    title: `Title ${lang}`, labels: { saveLabel: `Save ${lang}`, showQr: `QR ${lang}`, language: `Language ${lang}`, digitalCard: `Card ${lang}` },
  }]));
  const config = read({ translations });
  assert.equal(config.lang, "fr");
  assert.deepEqual(config.languages, languages);
  for (const lang of languages) {
    const localized = read({ translations }, lang);
    assert.equal(localized.title, `Title ${lang}`);
    assert.equal(localized.options.saveLabel, `Save ${lang}`);
    assert.equal(localized.labels.showQr, `QR ${lang}`);
    assert.equal(localized.labels.language, `Language ${lang}`);
    assert.equal(localized.labels.digitalCard, `Card ${lang}`);
  }
  assert.equal(read({ translations }, "PT-br").lang, "pt-BR");
});

test("explicit defaults, hidden text and RTL direction are independent per language", () => {
  const raw = {
    lang: "en", title: "Shared", tagline: "Shared note",
    translations: { fr: { tagline: "" }, en: { title: "Director" }, ar: { title: "مدير", dir: "rtl" } },
  };
  assert.equal(read(raw).title, "Director");
  assert.equal(read(raw, "fr").title, "Shared");
  assert.equal(read(raw, "fr").tagline, null);
  assert.equal(read(raw, "ar").dir, "rtl");
  assert.equal(read(raw, "en").dir, "ltr");
  assert.throws(() => read({ dir: "rtl\" onload=\"alert(1)" }), /dir must be/);
});

test("translations cannot replace shared URLs, photos, logo or code settings", () => {
  for (const key of ["url", "website", "photo", "logo", "links", "name", "translations"]) {
    assert.throws(() => read({ translations: { fr: { [key]: "javascript:alert(1)" } } }), /cannot be translated/, key);
  }
  assert.throws(() => read({ translations: { fr: { options: { pwa: true } } } }), /cannot be translated/);
  for (const translations of [[], "fr", { fr: [] }, { fr: { options: "labels" } }]) {
    assert.throws(() => read({ translations }), /mapping|map language/);
  }
});

test("invalid base options still warn instead of being silently converted", () => {
  const warnings = [];
  read({ options: "bad" }, undefined, message => warnings.push(message));
  assert.deepEqual(warnings, ["options should be a set of key: value settings — ignored"]);
});

test("logos pass through the static SVG sanitizer", () => {
  const warnings = [];
  const config = read({ logo: '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script></svg>' }, undefined, message => warnings.push(message));
  assert.doesNotMatch(config.logo, /onload|script|alert/);
  assert.match(warnings.join(" "), /unsafe/);
});
