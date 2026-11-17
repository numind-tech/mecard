import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ICAL from "ical.js";
import { buildVCard, withPhoto, toVCardDataUri } from "../vcard.js";

const languageScript = readFileSync(new URL("../language.js", import.meta.url), "utf8");
const cardScript = readFileSync(new URL("../card.js", import.meta.url), "utf8");

// A small DOM test double for the event-driven code, with real one-shot
// listener semantics. Layout and native controls are checked in the browser.
class Element {
  constructor(attributes = {}, text = "") {
    this.attributes = { ...attributes };
    this.textContent = text;
    this.hidden = false;
    this.listeners = [];
  }
  get dataset() {
    return Object.fromEntries(Object.entries(this.attributes).filter(([key]) => key.startsWith("data-")).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()), value]));
  }
  getAttribute(key) { return this.attributes[key] ?? null; }
  hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  set innerHTML(_) { throw new Error("Translations must never be inserted as HTML"); }
  addEventListener(type, callback, options) { this.listeners.push({ type, callback, once: options?.once }); }
  emit(type) {
    for (const listener of [...this.listeners]) {
      if (listener.type !== type) continue;
      if (listener.once) this.listeners.splice(this.listeners.indexOf(listener), 1);
      listener.callback({ target: this });
    }
  }
}

function variant(lang, title, tagline, dir = "ltr") {
  const department = lang === "ja" ? null : `${lang} team`;
  const labels = { saveLabel: `Save ${lang}`, shareLabel: `Share ${lang}`, language: `Language ${lang}`, showQr: `QR ${lang}`, close: `Close ${lang}`, digitalCard: `Card ${lang}` };
  const config = { name: "Test Person", url: "https://example.test/card", organization: "Test Org", links: [], lang, title, tagline, department, labels };
  return { dir, text: { ...labels, title, tagline, org: `${department ?? ""} Test Org` }, department, summary: `${title} — Test Org`, vcard: buildVCard(config) };
}

const translations = {
  fr: variant("fr", "Direction", "Une note"),
  en: variant("en", "Director", ""),
  ja: variant("ja", "技術責任者", "文書からデータへ"),
  ar: variant("ar", "مدير تقني", "مستندات", "rtl"),
};

function browser({ values = translations, saved, blocked = false, dropdown = false, saveContact = true, preferred = [], browserLang, initial = "fr" } = {}) {
  const data = new Element({}, JSON.stringify(values));
  const texts = Object.fromEntries(["title", "tagline", "org", "saveLabel", "shareLabel"].map(key => [key, new Element({ "data-i18n": key, "data-hide-empty": "" })]));
  const qr = new Element({ "data-i18n-aria": "showQr" });
  const control = new Element({ "data-i18n-aria": "language" });
  control.hidden = true;
  const buttons = dropdown ? [] : Object.keys(values).map(lang => new Element({ "data-language": lang }));
  const select = dropdown ? new Element() : null;
  const save = saveContact ? new Element() : null;
  const img = { src: "data:image/png;base64,AA==" };
  const schema = new Element({}, JSON.stringify({ "@type": "Person", worksFor: { "@type": "Organization", name: "Test Org" } }));
  const metas = [new Element(), new Element()];
  const card = { querySelectorAll: () => [] };
  const state = new Map(saved === undefined ? [] : [["mecard-language:/card", saved]]);
  const document = {
    documentElement: { lang: initial, dir: "ltr" },
    getElementById: id => id === "card-locales" ? data : null,
    querySelector: selector => ({
      "[data-language-select]": select, ".save-btn": save, "img.photo": img,
      'script[type="application/ld+json"]': schema, ".card": card,
    })[selector] ?? null,
    querySelectorAll: selector => ({
      "[data-language]": buttons,
      "[data-i18n]": Object.values(texts),
      "[data-i18n-aria]": [qr, control],
      "[data-i18n-title]": [],
      'meta[name="description"], meta[property="og:description"]': metas,
      ".language-switch, .language-picker": [control],
    })[selector] ?? [],
  };
  const events = [];
  const context = {
    document, location: Object.freeze({ pathname: "/card" }),
    localStorage: {
      getItem: key => { if (blocked) throw new Error("Storage blocked"); return state.get(key); },
      setItem: (key, value) => { if (blocked) throw new Error("Storage blocked"); state.set(key, value); },
    },
    Event, dispatchEvent: event => events.push(event.type),
    navigator: { languages: preferred, language: browserLang }, matchMedia: () => ({ matches: true }),
    TextDecoder, Uint8Array, atob, withPhoto, toVCardDataUri,
  };
  runInNewContext(languageScript, context);
  runInNewContext(cardScript, context);
  return { document, texts, qr, control, buttons, select, save, schema, metas, state, events };
}

const contact = save => new ICAL.Component(ICAL.parse(Buffer.from(save.href.split(",")[1], "base64").toString("utf8")));

test("language buttons update existing text, accessible names, metadata and each downloaded contact", () => {
  const page = browser();
  const originalTitle = page.texts.title;
  assert.equal(page.control.hidden, false);
  for (const lang of ["fr", "en", "ja", "fr"]) {
    page.buttons.find(button => button.dataset.language === lang).emit("click");
    assert.equal(page.document.documentElement.lang, lang);
    assert.equal(page.texts.title, originalTitle, "switching must retain the same DOM");
    assert.equal(page.texts.title.textContent, translations[lang].text.title);
    assert.equal(page.qr.getAttribute("aria-label"), `QR ${lang}`);
    assert.equal(page.control.getAttribute("aria-label"), `Language ${lang}`);
    assert.equal(page.buttons.filter(button => button.getAttribute("aria-pressed") === "true").length, 1);
    assert.equal(page.metas[0].content, translations[lang].summary);
    assert.equal(page.metas[1].content, translations[lang].summary);
    const schema = JSON.parse(page.schema.textContent);
    assert.equal(schema.jobTitle, translations[lang].text.title);
    assert.equal(schema.worksFor.department?.name, translations[lang].department ?? undefined);
    for (let i = 0; i < 2; i++) {
      page.save.emit("click");
      const vcard = contact(page.save);
      assert.equal(vcard.getFirstPropertyValue("title"), translations[lang].text.title);
      assert.equal(vcard.getAllProperties("photo").length, 1, "every download keeps exactly one portrait");
      assert.equal(vcard.getFirstPropertyValue("x-ablabel"), `Card ${lang}`);
    }
  }
  assert.equal(page.state.get("mecard-language:/card"), "fr");
  assert.ok(page.events.includes("mecard:languagechange"));
});

test("empty translations hide text and markup remains literal when switching", () => {
  const attack = '</script><img src=x onerror="alert(1)">';
  const page = browser({ values: { ...translations, en: variant("en", attack, "") } });
  page.buttons[1].emit("click");
  assert.equal(page.texts.title.textContent, attack);
  assert.equal(page.texts.tagline.hidden, true);
  assert.ok(!page.schema.textContent.includes("<"));
  page.buttons[0].emit("click");
  assert.equal(page.texts.tagline.hidden, false);
  assert.equal(page.texts.tagline.textContent, "Une note");
});

test("the dropdown supports RTL languages and ignores unknown selections", () => {
  const page = browser({ dropdown: true, saveContact: false });
  page.select.value = "ar";
  page.select.emit("change");
  assert.equal(page.document.documentElement.lang, "ar");
  assert.equal(page.document.documentElement.dir, "rtl");
  assert.equal(page.texts.title.textContent, "مدير تقني");
  page.select.value = "constructor";
  page.select.emit("change");
  assert.equal(page.document.documentElement.lang, "ar");
  page.select.value = "en";
  page.select.emit("change");
  assert.equal(page.document.documentElement.dir, "ltr");
});

test("saved preferences are scoped and validated, and blocked storage does not break switching", () => {
  assert.equal(browser({ saved: "ja", preferred: ["en-US"] }).document.documentElement.lang, "ja");
  for (const saved of ["obsolete", "__proto__", "toString"]) {
    assert.equal(browser({ saved }).document.documentElement.lang, "fr");
  }
  const page = browser({ blocked: true });
  page.buttons[1].emit("click");
  assert.equal(page.document.documentElement.lang, "en");
});

test("the browser's ranked languages determine the initial text and contact", () => {
  const page = browser({ preferred: ["de-DE", "en-US", "fr"] });
  assert.equal(page.document.documentElement.lang, "en");
  assert.equal(page.texts.title.textContent, "Director");
  assert.equal(contact(page.save).getFirstPropertyValue("title"), "Director");
  assert.equal(page.state.has("mecard-language:/card"), false, "automatic choices must not override future browser preferences");
  assert.equal(browser({ preferred: ["FR-ca", "en"] }).document.documentElement.lang, "fr");
  assert.equal(browser({ browserLang: "ja-JP" }).document.documentElement.lang, "ja");
  assert.equal(browser({ preferred: ["it-IT"], initial: "ja" }).document.documentElement.lang, "ja");
  assert.equal(browser({ preferred: ["ar-EG"], blocked: true }).document.documentElement.dir, "rtl");
});

test("language matching prefers specific regions and scripts before broader fallbacks", () => {
  const values = {
    "en-GB": variant("en-GB", "British", ""),
    "en-US": variant("en-US", "American", ""),
    "zh-Hans": variant("zh-Hans", "简体", ""),
    "zh-Hant": variant("zh-Hant", "繁體", ""),
  };
  const choose = preferred => browser({ values, initial: "en-GB", preferred }).document.documentElement.lang;
  assert.equal(choose(["en-US"]), "en-US");
  assert.equal(choose(["en-AU"]), "en-GB");
  assert.equal(choose(["zh-Hant-TW", "en-US"]), "zh-Hant");
  assert.equal(choose(["zh-Hans-CN"]), "zh-Hans");
});
