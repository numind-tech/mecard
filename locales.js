// Interface text shared by the page, config defaults and exported contact.
const EN = {
  qrLabel: "Scan to connect", saveLabel: "Save contact", shareLabel: "Share",
  showQr: "Show the QR code full screen", enlargeQr: "Tap to enlarge",
  close: "Close", qrFor: "QR code for", language: "Language",
  background: "Card background", digitalCard: "Digital card",
  email: "Email", phone: "Phone", website: "Website",
};
const FR = {
  qrLabel: "Scanner pour me contacter", saveLabel: "Enregistrer le contact", shareLabel: "Partager",
  showQr: "Afficher le QR code en plein écran", enlargeQr: "Agrandir le QR code",
  close: "Fermer", qrFor: "QR code de", language: "Langue",
  background: "Fond de la carte", digitalCard: "Carte de visite",
  email: "E-mail", phone: "Téléphone", website: "Site web",
};

export const labelsFor = (lang = "en") => /^fr(?:-|$)/i.test(lang) ? FR : EN;
export function isLanguage(lang) {
  if (typeof lang !== "string" || /[\r\n]/.test(lang) || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang)) return false;
  try { Intl.getCanonicalLocales(lang); return true; } catch { return false; }
}

// Only editorial fields can vary: a translation cannot replace an asset,
// change a destination URL or supply a filesystem path.
export function localize(raw, requested, warn = () => {}) {
  const translations = raw.translations ?? {};
  if (!translations || typeof translations !== "object" || Array.isArray(translations)) {
    throw new Error("translations should map language tags to translated fields");
  }
  const allowed = new Set(["title", "tagline", "department", "options", "labels", "dir"]);
  const entries = new Map();
  for (const [lang, values] of Object.entries(translations)) {
    if (!isLanguage(lang)) throw new Error(`invalid translation language: ${lang}`);
    const canonical = Intl.getCanonicalLocales(lang)[0];
    if (entries.has(canonical)) throw new Error(`duplicate translation language: ${lang}`);
    entries.set(canonical, values);
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(`translations.${lang} should be a mapping`);
    for (const key of Object.keys(values)) {
      if (!allowed.has(key)) throw new Error(`translations.${lang}.${key} cannot be translated`);
    }
    if (values.options != null) {
      if (typeof values.options !== "object" || Array.isArray(values.options)) throw new Error(`translations.${lang}.options should be a mapping`);
      for (const key of Object.keys(values.options)) {
        if (!["qrLabel", "saveLabel", "shareLabel"].includes(key)) throw new Error(`translations.${lang}.options.${key} cannot be translated`);
      }
    }
  }
  const base = typeof raw.lang === "string" && isLanguage(raw.lang.trim())
    ? Intl.getCanonicalLocales(raw.lang.trim())[0]
    : raw.lang == null ? entries.keys().next().value ?? "en" : "en";
  const languages = [base, ...entries.keys()].filter((lang, i, all) => all.indexOf(lang) === i);
  const lang = requested == null ? base : isLanguage(requested) ? Intl.getCanonicalLocales(requested)[0] : requested;
  if (!languages.includes(lang)) throw new Error(`unknown language: ${lang}`);
  const translated = entries.get(lang) ?? {};
  // Translate default UI labels too; explicit base labels are not carried
  // into other locales unless that locale supplies its own label.
  let options = raw.options ?? {};
  if (typeof options !== "object" || Array.isArray(options)) {
    warn("options should be a set of key: value settings — ignored");
    options = {};
  }
  options = { ...options };
  if (lang !== base) for (const key of ["qrLabel", "saveLabel", "shareLabel"]) delete options[key];
  return {
    raw: {
      ...raw, ...translated,
      // Preserve an invalid explicit tag so the config loader can report it.
      lang: requested == null && raw.lang != null && !isLanguage(String(raw.lang).trim()) ? raw.lang : lang,
      labels: translated.labels ?? (lang === base ? raw.labels : undefined),
      dir: translated.dir ?? (lang === base ? raw.dir : undefined),
      options: { ...options, ...translated.options },
    },
    defaultLang: base, languages,
  };
}
