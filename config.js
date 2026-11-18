// ─────────────────────────────────────────────────────────────
//  Config: read the YAML, check it, and fill in defaults
// ─────────────────────────────────────────────────────────────
//  Problems that still leave a usable card are reported through
//  `warn` and repaired or skipped; missing required values, invalid
//  YAML and unsafe URLs throw. Relative paths (photo, custom
//  icons) are resolved against the config file's own directory.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { parse } from "yaml";
import { BACKGROUNDS, mix } from "./backgrounds.js";
import { ICONS } from "./icons.js";
import { cleanSvg } from "./svg.js";
import { validateUrl, WEB_PROTOCOLS, LINK_PROTOCOLS } from "./urls.js";
import { labelsFor, localize, isLanguage } from "./locales.js";

export const THEME = {
  dark: "#1e1e22",
  mid: null, // blend of dark and light
  light: "#1b4742",
  accent: "#5b9eb8",
  pop: "#b34d3a",
  page: "#131315",
  text: "#fbf9f6",
};

export const OPTIONS = {
  indexable: false,
  paper: false,
  darkMode: true,
  glint: false,
  animateWaves: true,
  qr: true,
  qrContact: false,
  saveContact: true,
  share: true,
  pwa: true,
  qrLabel: "Scan to connect",
  saveLabel: "Save contact",
  shareLabel: "Share",
};

export const BG_NAMES = Object.keys(BACKGROUNDS);

export const NO_INDEX = "noindex, nofollow, noarchive, nosnippet, noimageindex";

// Options that were renamed; the old names still work, with a warning
const RENAMED = { waves: "animateWaves" };

const TEXT_KEYS = ["name", "title", "tagline", "organization", "department", "email", "phone", "website", "photo", "url", "lang"];
const KEYS = [...TEXT_KEYS, "links", "theme", "backgrounds", "options", "now", "nameParts", "logo", "logoDark", "translations", "labels", "dir"];
const LINK_KEYS = ["label", "url", "icon"];
const NOW_KEYS = ["text", "until", "url"];
const NAME_KEYS = ["given", "middle", "family", "prefix", "suffix"];

function readLayer(file) {
  if (!existsSync(file)) {
    throw new Error(`${file} not found — create it with your name and card URL (see README.md).`);
  }
  let raw;
  try {
    raw = parse(readFileSync(file, "utf-8")) ?? {};
  } catch (err) {
    throw new Error(`${file} isn't valid YAML: ${err.message}`);
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${file} should be a list of key: value settings`);
  }
  const base = dirname(resolve(file));
  // Resolve assets where they are declared, including in shared defaults.
  if (typeof raw.photo === "string") {
    raw.photo = raw.photo.trim();
    if (raw.photo && !/^[a-z][a-z0-9+.-]*:/i.test(raw.photo)) raw.photo = resolve(base, raw.photo);
  }
  const iconPath = (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return !trimmed.startsWith("<") && /\.svg$/i.test(trimmed) ? resolve(base, trimmed) : value;
  };
  for (const key of ["logo", "logoDark"]) if (raw[key] != null) raw[key] = iconPath(raw[key]);
  if (Array.isArray(raw.links)) raw.links = raw.links.map((link) => link && typeof link === "object" ? { ...link, icon: iconPath(link.icon) } : link);
  return raw;
}

// Mappings merge recursively; lists and explicit nulls replace defaults.
// Object.fromEntries avoids special setters for keys such as __proto__.
function mergeDefaults(base, override, depth = 0) {
  if (depth > 16) throw new Error("config nesting is too deep");
  const mapping = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!mapping(base) || !mapping(override)) return override;
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(override)])].map((key) => [
    key, Object.hasOwn(override, key)
      ? Object.hasOwn(base, key) ? mergeDefaults(base[key], override[key], depth + 1) : override[key]
      : base[key],
  ]));
}

export function loadConfig(file, warn = () => {}, lang, { defaults, url } = {}) {
  let raw = readLayer(file);
  if (defaults) raw = mergeDefaults(readLayer(defaults), raw);
  if (url != null) raw.url = url;
  const base = dirname(resolve(file));
  checkKeys(raw, KEYS, "", warn);
  const localized = localize(raw, lang, warn);
  raw = localized.raw;

  const config = { baseDir: base, defaultLang: localized.defaultLang, languages: localized.languages };
  for (const key of TEXT_KEYS) config[key] = text(raw[key], key, warn);
  for (const key of ["name", "url"]) {
    if (!config[key]) throw new Error(`${file} is missing required key: ${key}`);
  }

  config.url = webUrl(config.url, "url", warn);
  if (!URL.canParse(config.url)) throw new Error(`url isn't a web address: ${config.url}`);
  if (config.website) config.website = webUrl(config.website, "website", warn);
  if (config.email && !/^[^@\s]+@[^@\s]+$/.test(config.email)) {
    warn(`email doesn't look like an address: ${config.email}`);
  }

  config.lang ??= "en";
  if (!isLanguage(config.lang)) {
    warn(`lang should be a language tag like en or pt-BR, not ${config.lang} — using en`);
    config.lang = "en";
  }

  config.theme = loadTheme(mapping(raw.theme, "theme", warn), warn);
  config.labels = loadLabels(raw.labels, config.lang, warn);
  config.options = loadOptions(mapping(raw.options, "options", warn), warn, config.labels);
  for (const key of ["qrLabel", "saveLabel", "shareLabel"]) config.labels[key] = config.options[key];
  config.dir = raw.dir ?? "ltr";
  if (!["ltr", "rtl"].includes(config.dir)) throw new Error("dir must be ltr or rtl");
  config.backgrounds = loadBackgrounds(raw.backgrounds, warn);
  config.links = loadLinks(raw.links, base, warn);
  config.now = loadNow(raw.now, warn);
  config.nameParts = loadNameParts(raw.nameParts, warn);
  config.logo = raw.logo ? loadIcon(raw.logo, base, (msg) => warn(`logo: ${msg}`)).icon : null;
  config.logoDark = raw.logoDark ? loadIcon(raw.logoDark, base, (msg) => warn(`logoDark: ${msg}`)).icon : null;
  return config;
}

// ── Sections ─────────────────────────────────────────────────
function loadTheme(raw, warn) {
  checkKeys(raw, Object.keys(THEME), "theme.", warn);
  const theme = {};
  for (const [key, fallback] of Object.entries(THEME)) {
    const value = raw[key];
    if (value == null) {
      // An unquoted `dark: #1e1e22` is a YAML comment, which parses as blank
      if (key in raw) warn(`theme.${key} is blank — colours need quotes in YAML: ${key}: "#1e1e22"`);
      theme[key] = fallback;
      continue;
    }
    theme[key] = normHex(value);
    if (!theme[key]) {
      warn(`theme.${key}: ${value} isn't a hex colour like "#1e1e22" — using the default`);
      theme[key] = fallback;
    }
  }
  theme.mid ??= mix(theme.dark, theme.light, 0.5);
  return theme;
}

function loadLabels(raw, lang, warn) {
  const values = mapping(raw, "labels", warn);
  const labels = { ...labelsFor(lang) };
  checkKeys(values, Object.keys(labels), "labels.", warn);
  for (const key of Object.keys(labels)) {
    if (values[key] == null) continue;
    if (typeof values[key] !== "string") {
      warn(`labels.${key} should be text — using the default`);
      continue;
    }
    labels[key] = values[key];
  }
  return labels;
}

function loadOptions(raw, warn, labels) {
  raw = { ...raw };
  for (const [old, now] of Object.entries(RENAMED)) {
    if (!(old in raw)) continue;
    warn(`options.${old} is now called options.${now}`);
    raw[now] ??= raw[old];
    delete raw[old];
  }
  checkKeys(raw, Object.keys(OPTIONS), "options.", warn);
  const options = { ...OPTIONS, qrLabel: labels.qrLabel, saveLabel: labels.saveLabel, shareLabel: labels.shareLabel };
  for (const [key, fallback] of Object.entries(OPTIONS)) {
    const value = raw[key];
    if (value == null) continue;
    if (typeof fallback === "boolean" && typeof value !== "boolean") {
      warn(`options.${key} should be true or false, not ${value}`);
      continue;
    }
    options[key] = typeof fallback === "string" ? String(value) : value;
  }
  return options;
}

function loadBackgrounds(raw, warn) {
  const names = [].concat(raw ?? ["waves"]).map((b) => String(b).trim().toLowerCase());
  const known = names.filter((name) => {
    if (BG_NAMES.includes(name)) return true;
    warn(`unknown background ${name}${hint(name, BG_NAMES)} — choose from ${BG_NAMES.join(", ")}`);
    return false;
  });
  const unique = [...new Set(known)];
  return unique.length ? unique : ["waves"];
}

function loadLinks(raw, base, warn) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    warn("links should be a list, each with label, url and icon");
    return [];
  }
  const links = [];
  raw.forEach((link, i) => {
    const where = `links[${i + 1}]`;
    if (!link || typeof link !== "object") {
      warn(`${where} should have label, url and icon — skipped`);
      return;
    }
    checkKeys(link, LINK_KEYS, `${where}.`, warn);
    if (!link.url) {
      warn(`${where} (${link.label ?? "no label"}) has no url — skipped`);
      return;
    }
    const url = webUrl(String(link.url), `${where}.url`, warn, LINK_PROTOCOLS);
    if (!link.label) warn(`${where} has no label, which screen readers announce — using the address`);
    const icon = loadIcon(link.icon, base, (msg) => warn(`${where}.icon: ${msg}`));
    links.push({ label: String(link.label || hostOf(url)), url, ...icon });
  });
  return links;
}

// `now` takes a plain string, or { text, until, url }
function loadNow(raw, warn) {
  if (raw == null || raw === "") return null;
  const now = typeof raw === "object" && !Array.isArray(raw) ? raw : { text: raw };
  checkKeys(now, NOW_KEYS, "now.", warn);
  if (!now.text) {
    warn("now has no text — skipped");
    return null;
  }
  let until = now.until instanceof Date ? now.until.toISOString().slice(0, 10) : now.until;
  if (until != null && !isDate(String(until))) {
    warn(`now.until should be a date like 2026-06-05, not ${until} — ignored`);
    until = null;
  }
  return {
    text: String(now.text).trim(),
    until: until == null ? null : String(until),
    url: now.url ? webUrl(String(now.url), "now.url", warn) : null,
  };
}

function loadNameParts(raw, warn) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warn(`nameParts should have keys ${NAME_KEYS.join(", ")}`);
    return null;
  }
  checkKeys(raw, NAME_KEYS, "nameParts.", warn);
  return Object.fromEntries(NAME_KEYS.map((k) => [k, raw[k] == null ? "" : String(raw[k]).trim()]));
}

// A built-in name, a path to an .svg file, or inline <svg> markup
export function loadIcon(spec, base, warn) {
  const fallback = { iconName: "link", icon: ICONS.link };
  if (spec == null) return fallback;
  const s = String(spec).trim();
  if (s.startsWith("<svg")) return { iconName: "custom", icon: cleanSvg(s, warn) };
  if (/\.svg$/i.test(s)) {
    const file = resolve(base, s);
    if (!existsSync(file)) {
      warn(`file not found: ${s} — using link`);
      return fallback;
    }
    return { iconName: "custom", icon: cleanSvg(readFileSync(file, "utf-8"), warn) };
  }
  const name = s.toLowerCase();
  if (Object.hasOwn(ICONS, name)) return { iconName: name, icon: ICONS[name] };
  warn(`unknown icon ${s}${hint(name, Object.keys(ICONS))} — using link`);
  return fallback;
}

// ── Values ───────────────────────────────────────────────────
function text(value, key, warn) {
  if (value == null) return null;
  if (typeof value === "object") {
    warn(`${key} should be a single value — ignored`);
    return null;
  }
  return String(value).trim() || null;
}

function mapping(value, key, warn) {
  if (value == null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  warn(`${key} should be a set of key: value settings — ignored`);
  return {};
}

// "#abc", "#aabbcc" or "aabbcc" → "#aabbcc"; anything else → null
export function normHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return "#" + h.toLowerCase();
}

function webUrl(value, key, warn, protocols = WEB_PROTOCOLS) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    warn(`${key} has no https:// — assuming https://${value}`);
    value = `https://${value}`;
  }
  return validateUrl(value, key, protocols);
}

function hostOf(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
}

// ── Typos ────────────────────────────────────────────────────
function checkKeys(obj, known, prefix, warn) {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) warn(`unknown key ${prefix}${key}${hint(key, known)}`);
  }
}

function hint(word, options) {
  let best = null, bestD = 3;
  for (const option of options) {
    const d = distance(word.toLowerCase(), option.toLowerCase());
    if (d < bestD) [best, bestD] = [option, d];
  }
  return best ? ` (did you mean ${best}?)` : "";
}

// Levenshtein edit distance
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.length];
}
