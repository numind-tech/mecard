#!/usr/bin/env node
// Build the card into one page, a favicon, and optional PWA files.
//   node build.js [--config config.yaml] [--out dist] [--strict]
// For a live preview that rebuilds on save, use `npm run dev`.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { parseArgs } from "util";
import { join, resolve } from "path";
import { createHash } from "crypto";
import QRCode from "qrcode";
import { Resvg } from "@resvg/resvg-js";
import { BACKGROUNDS, restingWaves, rgb } from "./backgrounds.js";
import { loadConfig, NO_INDEX } from "./config.js";
import { ICONS } from "./icons.js";
import { buildVCard, withPhoto, toVCardDataUri } from "./vcard.js";
import { downloadPhoto } from "./photo.js";
import { contactQrGeometry, contactQrSvg } from "./contact-qr.js";
import { appearanceTheme } from "./appearance-theme.js";
import { linkedinHandle } from "./urls.js";
import { FAVICON_SIZE, photoFavicon } from "./favicon.js";

// ── Arguments ────────────────────────────────────────────────
let args;
try {
  args = parseArgs({
    options: {
      config: { type: "string", short: "c", default: "config.yaml" },
      out: { type: "string", short: "o", default: "dist" },
      strict: { type: "boolean", default: false },
      lang: { type: "string" },
      defaults: { type: "string" },
      url: { type: "string" },
    },
  }).values;
} catch (err) {
  console.error(`${err.message}\nUsage: node build.js [--config config.yaml] [--out dist] [--strict] [--lang en]`);
  process.exit(1);
}
const OUT = args.out;

// ── Read config ──────────────────────────────────────────────
// Warnings flag mistakes the build can work around; --strict makes
// them fail the build instead
const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`! ${msg}`);
};

let config, variants;
try {
  const shared = { defaults: args.defaults, url: args.url };
  config = loadConfig(args.config, warn, args.lang, shared);
  variants = config.languages.map((lang) => lang === config.lang ? config : loadConfig(args.config, (message) => warn(`${lang}: ${message}`), lang, shared));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { theme, options: opts, backgrounds } = config;
const labels = config.labels;
const appearance = appearanceTheme(theme, opts.paper);

// The stylesheet is static; the theme reaches it through these variables
const themeCss = `:root {
  --dark: ${theme.dark};
  --mid: ${theme.mid};
  --light: ${theme.light};
  --accent: ${theme.accent};
  --accent-rgb: ${rgb(theme.accent).join(", ")};
  --pop-rgb: ${rgb(theme.pop).join(", ")};
  --page: ${theme.page};
  --text: ${theme.text};
  --text-rgb: ${rgb(theme.text).join(", ")};
}`;

// card.css and card.js sit beside this script and are inlined into the page
const read = (name) => readFileSync(join(import.meta.dirname, name), "utf-8").trimEnd();
const indent = (text, n) => text.replace(/^(?=.)/gm, " ".repeat(n));

// One line about the person, for search results, link previews and shares
const summary = [config.title, config.organization].filter(Boolean).join(" — ");
const pageTitle = [config.name, config.organization].filter(Boolean).join(" — ");
const ICON_FONT = "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif";
const toPng = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

// ── Photo ────────────────────────────────────────────────────
const IMAGE_TYPES = {
  jpeg: { ext: "jpg" },
  png: { ext: "png" },
  gif: { ext: "gif" },
  webp: { ext: "webp" },
};

// Identify the image by its first bytes rather than its name
function imageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.toString("latin1", 0, 4) === "GIF8") return "gif";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

// Reads intrinsic dimensions straight from the file header so the PWA
// manifest can declare an accurate icon size without an image library.
function imageSize(buf) {
  // PNG: IHDR width/height are big-endian uint32s at a fixed offset
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG: walk the marker segments looking for a Start Of Frame
  if (buf.length > 4 && buf.readUInt16BE(0) === 0xffd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0-SOF15, excluding DHT (c4), JPG (c8) and DAC (cc)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// A web address is downloaded now, so the page, vCard and icons all
// carry the photo without contacting its original host at runtime
async function loadPhoto(spec) {
  if (!spec) return null;
  let data;
  if (/^https?:\/\//i.test(spec)) {
    try {
      data = await downloadPhoto(spec);
    } catch (err) {
      warn(`couldn't download photo ${spec} (${err.message}) — using initials`);
      return null;
    }
  } else {
    try {
      data = readFileSync(resolve(config.baseDir, spec));
    } catch {
      warn(`photo not found: ${spec} — using initials`);
      return null;
    }
  }
  const type = imageType(data);
  if (!type) {
    warn(`photo isn't a JPEG, PNG, GIF or WebP image: ${spec} — using initials`);
    return null;
  }
  const { ext } = IMAGE_TYPES[type];
  return {
    data,
    mime: `image/${type}`,
    name: `icon.${ext}`, // the PWA icon
    size: imageSize(data),
    src: `data:image/${type};base64,${data.toString("base64")}`,
  };
}

const photo = await loadPhoto(config.photo);

// The photo doubles as the app icon. Without one, a square SVG of the
// initials stands in, and scales to whatever size a platform asks for.
const appIcon = photo
  ? { name: photo.name, type: photo.mime, sizes: photo.size && `${photo.size.w}x${photo.size.h}` }
  : { name: "icon.svg", type: "image/svg+xml", sizes: "any" };

const initials = config.name
  .split(/\s+/)
  .map((w) => [...w][0] ?? "")
  .join("")
  .toUpperCase()
  .slice(0, 2);

// The card's address as a directory, for naming files published beside it
const cardBase = (() => {
  const u = new URL(config.url);
  if (!/\.[^/]*$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, "/");
  return u.href;
})();

// ── vCard and QR codes ──────────────────────────────────────
// A contact QR carries the same photo-free contact as the download. Geometry
// varies with language; no duplicate photos or browser QR library are needed.
const vcard = buildVCard(config);
const contactQr = opts.qr && opts.qrContact;
const qrToggle = opts.qr && opts.qrToggle;
const qrByContacts = opts.paper && (contactQr || qrToggle);
const contactQrs = contactQr || qrToggle ? Object.fromEntries(variants.map(variant => [
  variant.lang, contactQrGeometry(buildVCard(variant)),
])) : {};
const linkQr = qrToggle ? contactQrGeometry(config.url) : null;
const qrSvg = contactQr || qrToggle ? contactQrSvg(contactQr ? contactQrs[config.lang] : linkQr) : await QRCode.toString(config.url, {
  type: "svg",
  margin: 0,
  color: { dark: opts.paper ? theme.dark : "#ffffffdd", light: "#00000000" },
  errorCorrectionLevel: "M",
});

// ── vCard ────────────────────────────────────────────────────
// Without the photo: card.js adds it from the <img> when it's saved
const vcardDataUri = toVCardDataUri(vcard);
// Characters that some file systems refuse become underscores
const vcardFilename = config.name.replace(/[\s\\/:*?"<>|]+/g, "_") + ".vcf";

// Only text varies between languages. Images, SVGs, styles and markup appear
// once. Contacts are pre-escaped at build time and never contain a second photo.
const translations = Object.fromEntries(variants.map((variant) => [variant.lang, {
  dir: variant.dir,
  text: {
    ...variant.labels,
    title: variant.title || "",
    tagline: variant.tagline || "",
    org: [variant.department, variant.organization].filter(Boolean).join(" · "),
    qrFor: `${variant.labels.qrFor} ${variant.name}`,
  },
  department: variant.department,
  summary: [variant.title, variant.organization].filter(Boolean).join(" — "),
  vcard: opts.saveContact ? buildVCard(variant) : undefined,
  qr: qrToggle ? undefined : contactQrs[variant.lang],
}]));

const qrModes = qrToggle ? {
  initial: contactQr ? "contact" : "link",
  defaultLang: config.lang,
  link: linkQr,
  variants: Object.fromEntries(variants.map(variant => [variant.lang, {
    contact: contactQrs[variant.lang],
    contactLabel: variant.labels.qrContactLabel,
    linkLabel: variant.labels.qrLinkLabel,
  }])),
} : null;

// ── Structured data ──────────────────────────────────────────
// A schema.org Person, so search engines can connect the card to the
// person's other profiles. Files and calendars aren't profiles.
const NOT_PROFILES = new Set(["file", "calendar", "mail", "phone"]);

function buildPerson() {
  const sameAs = config.links
    .filter((l) => !NOT_PROFILES.has(l.iconName) && !/\.pdf($|[?#])/i.test(l.url))
    .map((l) => l.url);
  if (config.website && config.website !== config.url) sameAs.unshift(config.url);
  const org = config.organization && {
    "@type": "Organization",
    name: config.organization,
    department: config.department ? { "@type": "Organization", name: config.department } : undefined,
  };
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: config.name,
    jobTitle: config.title || undefined,
    description: config.tagline || undefined,
    worksFor: org || undefined,
    email: config.email ? `mailto:${config.email}` : undefined,
    telephone: config.phone || undefined,
    url: config.website || config.url,
    image: opts.pwa && photo ? new URL(photo.name, cardBase).href : undefined,
    sameAs: sameAs.length ? sameAs : undefined,
  };
}

// ── Helpers ──────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// JSON inside <script> must not contain "</script>", so escape every "<"
const scriptJson = (value, indent) => JSON.stringify(value, null, indent).replace(/</g, "\\u003c");

// Invisible text shares the same grid cell as the active label. Its natural
// wrapping reserves space for every language at the current screen width.
// Only text is repeated; it is inert and excluded from accessible names.
function reserveTranslations(content, keys) {
  const sizes = new Map();
  for (const [lang, variant] of Object.entries(translations)) {
    for (const key of keys) {
      const text = variant.text[key] ?? "";
      sizes.set(`${variant.dir}:${text}`, { lang, dir: variant.dir, text });
    }
  }
  if (sizes.size < 2) return content;
  const placeholders = [...sizes.values()].map(({ lang, dir, text }) =>
    `<span class="i18n-size" aria-hidden="true" inert lang="${lang}" dir="${dir}">${escHtml(text)}</span>`).join("");
  return `<span class="i18n-slot">${content}${placeholders}</span>`;
}

function translatedInline(key, hideEmpty = false) {
  const value = translations[config.lang].text[key] ?? "";
  const hide = hideEmpty ? ` data-hide-empty${value ? "" : " hidden"}` : "";
  return reserveTranslations(`<span data-i18n="${key}"${hide}>${escHtml(value)}</span>`, [key]);
}

function translatedText(tag, className, key) {
  if (!Object.values(translations).some((variant) => variant.text[key])) return "";
  return `<${tag} class="${className}">${translatedInline(key, true)}</${tag}>`;
}

function buildPhotoHtml() {
  const inner = photo
    ? `<img class="photo" src="${photo.src}" alt="${escHtml(config.name)}" />`
    : `<div class="photo photo-initials">${escHtml(initials)}</div>`;
  return `      <div class="photo-wrap">
        <div class="photo-glow"></div>
        ${inner}
      </div>`;
}

function buildHeader() {
  const themedLogo = opts.darkMode && config.logo && config.logoDark;
  // Each sanitized SVG has its own document, so matching gradient/clip IDs in
  // the two variants cannot interfere with each other or with the card.
  const logoImage = (svg, mode) => {
    const document = svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
    return `<img class="brand-${mode}" src="data:image/svg+xml;base64,${Buffer.from(document).toString("base64")}" alt="" />`;
  };
  const logo = config.logo
    ? `<a class="brand${themedLogo ? " brand-themed" : ""}" href="${escHtml(config.website || config.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escHtml(config.organization || config.name)}">${themedLogo ? logoImage(config.logo, "light") + logoImage(config.logoDark, "dark") : config.logo}</a>`
    : "<span></span>";
  const languageName = (lang) => new Intl.DisplayNames([lang], { type: "language" }).of(lang);
  let languages = "";
  if (config.languages.length === 2) {
    languages = `<nav class="language-switch" aria-label="${escHtml(labels.language)}" data-i18n-aria="language" dir="ltr" hidden>${config.languages.map((lang) =>
      `<button type="button" data-language="${lang}" lang="${lang}" aria-label="${escHtml(languageName(lang))}" aria-pressed="${lang === config.lang}">${lang.toUpperCase()}</button>`
    ).join("")}</nav>`;
  } else if (config.languages.length > 2) {
    languages = `<label class="language-picker" hidden><span class="sr-only" data-i18n="language">${escHtml(labels.language)}</span><select data-language-select>${config.languages.map((lang) =>
      `<option value="${lang}" lang="${lang}"${lang === config.lang ? " selected" : ""}>${escHtml(languageName(lang))}</option>`
    ).join("")}</select></label>`;
  }
  const toggle = opts.darkMode ? `<button type="button" class="theme-toggle" aria-label="${escHtml(labels.darkMode)}" data-i18n-aria="darkMode" aria-pressed="false" hidden><svg class="theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/></svg><svg class="theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg></button>` : "";
  const layout = `<button type="button" class="layout-toggle" aria-label="${escHtml(labels.layout)}" data-i18n-aria="layout" aria-pressed="false" hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
      <rect class="layout-portrait" x="6" y="3" width="12" height="18" rx="2"/>
      <rect class="layout-landscape" x="3" y="6" width="18" height="12" rx="2"/>
    </svg>
    <span hidden data-layout-label="layoutPortrait" data-i18n="layoutPortrait">${escHtml(labels.layoutPortrait)}</span>
    <span hidden data-layout-label="layoutLandscape" data-i18n="layoutLandscape">${escHtml(labels.layoutLandscape)}</span>
  </button>`;
  return `      <header class="card-header">${logo}<div class="card-controls">${languages}${toggle}${layout}</div></header>`;
}

function buildSubtitle() {
  return [
    translatedText("span", "sub-title", "title"),
    !opts.paper && translatedText("span", "sub-tagline", "tagline"),
    translatedText("span", "sub-org", "org"),
  ].filter(Boolean).join("\n          ");
}

// Left out once its date has passed. The page checks again when it
// loads, so the line still retires on time if nobody rebuilds.
function buildNowHtml() {
  const now = config.now;
  if (!now) return "";
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
  if (now.until && now.until < today) {
    console.log(`  now: ended ${now.until}, so it's left out`);
    return "";
  }
  const text = escHtml(now.text);
  const body = now.url
    ? `<a href="${escHtml(now.url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : `<span>${text}</span>`;
  const until = now.until ? ` data-until="${now.until}"` : "";
  return `      <p class="now"${until}><span class="now-dot" aria-hidden="true"></span>${body}</p>`;
}

function buildContactInfo() {
  const entries = [];
  if (config.email)
    entries.push({
      href: `mailto:${config.email}`,
      icon: ICONS.mail,
      text: config.email,
      label: "email",
    });
  if (config.phone)
    entries.push({
      // tel: URIs take digits and a leading +; strip the display formatting
      href: `tel:${config.phone.replace(/[^\d+]/g, "")}`,
      icon: ICONS.phone,
      text: config.phone,
      label: "phone",
    });
  if (config.website && opts.showWebsite)
    entries.push({
      href: config.website,
      icon: ICONS.globe,
      text: config.website.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      external: true,
      label: "website",
    });

  for (const link of config.links.filter(link => link.placement === "contact")) {
    const handle = link.iconName === "linkedin" ? linkedinHandle(link.url) : null;
    entries.push({ href: link.url, icon: link.icon, text: handle || link.label, caption: handle ? link.label : null, aria: handle ? `${link.label}: ${handle}` : null, external: /^https?:/i.test(link.url) });
  }

  if (!entries.length && !qrByContacts) return "";

  const rows = entries.map((e, i) => {
    const delay = (0.35 + i * 0.07).toFixed(2);
    const rel = e.external
      ? ' target="_blank" rel="noopener noreferrer"'
      : "";
    const caption = e.label ? `<span class="contact-label">${translatedInline(e.label)}</span>` : e.caption ? `<span class="contact-label">${escHtml(e.caption)}</span>` : "";
    const text = opts.paper && caption ? `<span class="contact-text">${caption}<bdi>${escHtml(e.text)}</bdi></span>` : `<bdi>${escHtml(e.text)}</bdi>`;
    return `        <a href="${escHtml(e.href)}"${rel}${e.aria ? ` aria-label="${escHtml(e.aria)}"` : ""} class="contact-row" style="animation-delay:${delay}s">${e.icon}${text}</a>`;
  });

  const info = `      <div class="contact-info">\n${rows.join("\n")}\n      </div>`;
  if (!qrByContacts) return entries.length ? info : "";
  return `      <div class="contact-block${entries.length ? "" : " contact-block-solo"}">
${entries.length ? info : ""}
        <div class="contact-qr">${qrToggle ? buildQrCaption() : ""}
          ${buildQrButton()}
          ${buildQrControls()}
          ${qrToggle ? "" : buildQrCaption()}
        </div>
      </div>`;
}

function buildLinksHtml() {
  const links = config.links.filter(link => link.placement !== "contact");
  if (!links.length) return "";
  const buttons = links.map((link, i) => {
    const delay = (0.55 + i * 0.07).toFixed(2);
    return `        <a href="${escHtml(link.url)}" target="_blank" rel="noopener noreferrer"
           class="link-btn" title="${escHtml(link.label)}" aria-label="${escHtml(link.label)}"
           style="animation-delay:${delay}s">${link.icon}${opts.paper ? `<span>${escHtml(link.label)}</span>` : ""}</a>`;
  });
  return `      <div class="links">\n${buttons.join("\n")}\n      </div>`;
}

function buildQrButton() {
  return `<button type="button" class="qr-container" aria-label="${escHtml(labels.showQr)}" title="${escHtml(labels.enlargeQr)}" data-i18n-aria="showQr" data-i18n-title="enlargeQr">${qrSvg}</button>`;
}

function buildQrControls() {
  if (!qrToggle) return "";
  return `<div class="qr-mode-switch" role="group" aria-label="${escHtml(labels.qrMode)}" data-i18n-aria="qrMode" hidden>${["contact", "link"].map(mode => {
    const key = mode === "contact" ? "qrContactMode" : "qrLinkMode";
    const description = mode === "contact" ? "qrContactLabel" : "qrLinkLabel";
    const icon = ICONS[mode === "contact" ? "contact" : "link"].replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
    return `<button type="button" data-qr-mode="${mode}" aria-pressed="${mode === qrModes.initial}" aria-label="${escHtml(labels[key])}" data-i18n-aria="${key}" title="${escHtml(labels[description])}" data-i18n-title="${description}">${icon}</button>`;
  }).join("")}</div>`;
}

function buildQrCaption(className = "qr-label") {
  if (!qrToggle) return translatedText("p", className, "qrLabel");
  const caption = contactQr ? labels.qrContactLabel : labels.qrLinkLabel;
  const content = `<span data-qr-caption aria-live="polite">${escHtml(caption)}</span>`;
  return `<p class="${className}" data-qr-heading>${reserveTranslations(content, ["qrContactLabel", "qrLinkLabel"])}</p>`;
}

function buildQrSection() {
  if (!opts.qr && !opts.saveContact && !opts.share) return "";
  const parts = [];
  if (opts.qr && !qrByContacts) {
    // Opens the full-screen copy in .qr-full
    if (qrToggle) parts.push(buildQrCaption());
    parts.push(`        ${buildQrButton()}`);
    parts.push(buildQrControls());
    if (!qrToggle) parts.push(buildQrCaption());
  }

  const actions = [];
  if (opts.saveContact) {
    actions.push(`          <a href="${vcardDataUri}" download="${escHtml(vcardFilename)}" class="action-btn save-btn">
            ${ICONS.download} ${translatedInline("saveLabel")}
          </a>`);
  }
  if (opts.share) {
    // Revealed by script only where navigator.share exists
    actions.push(`          <button type="button" class="action-btn share-btn share-icon" aria-label="${escHtml(opts.shareLabel)}" data-i18n-aria="shareLabel" title="${escHtml(opts.shareLabel)}" data-i18n-title="shareLabel" hidden>
            ${ICONS.share.replace("<svg ", '<svg aria-hidden="true" ')}
          </button>`);
  }
  if (actions.length)
    parts.push(`        <div class="actions">\n${actions.join("\n")}\n        </div>`);

  return parts.length ? `      <div class="qr-section">\n${parts.join("\n")}\n      </div>` : "";
}

// The QR code again, dark on white and as large as the screen allows,
// for showing someone across a table: easier for any camera to read
function buildQrDialog() {
  if (!opts.qr) return "";
  return `  <dialog class="qr-full${opts.paper ? " paper-qr" : ""}${qrToggle ? " qr-switchable" : ""}" aria-label="${escHtml(`${labels.qrFor} ${config.name}`)}" data-i18n-aria="qrFor">
    <button type="button" class="qr-full-close" aria-label="${escHtml(labels.close)}" data-i18n-aria="close">&times;</button>
    ${qrToggle ? buildQrCaption("qr-full-caption") : ""}
    <div class="qr-full-code">${qrSvg}</div>
    <p class="qr-full-name">${escHtml(config.name)}</p>
    ${buildQrControls()}
    <p class="qr-full-url">${escHtml(config.url.replace(/^https?:\/\//, ""))}</p>
  </dialog>`;
}

// One absolutely positioned layer per background; the first starts visible.
// data-poster is the frame held for visitors who prefer reduced motion.
const bgLayersHtml = opts.paper ? "" : backgrounds
  .map((name, i) => {
    const { render, poster } = BACKGROUNDS[name];
    const still = poster ? ` data-poster="${poster.toFixed(2)}"` : "";
    return `    <div class="bg${i === 0 ? " on" : ""}" data-bg="${name}"${still}>\n${render(opts)}\n    </div>`;
  })
  .join("\n");

const bgDotsHtml =
  !opts.paper && backgrounds.length > 1
    ? `  <nav class="bg-dots" aria-label="${escHtml(labels.background)}" data-i18n-aria="background">
${backgrounds
  .map((name, i) => `    <button type="button" class="bg-dot" data-bg="${name}" aria-label="${escHtml(BACKGROUNDS[name].label)}" aria-pressed="${i === 0}"></button>`)
  .join("\n")}
  </nav>
  <p class="bg-name" aria-live="polite"></p>`
    : "";

// ── Full HTML ────────────────────────────────────────────────
const favicon = await buildFavicon();
const faviconVersion = createHash("sha256").update(favicon).digest("hex").slice(0, 12);
const faviconHref = `favicon.png?v=${faviconVersion}`;
const html = `<!DOCTYPE html>
<html lang="${escHtml(config.lang)}" dir="${config.dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
${opts.indexable ? "" : `  <meta name="robots" content="${NO_INDEX}">`}
  <title>${escHtml(pageTitle)}</title>
  <link rel="icon" href="${faviconHref}" type="image/png" sizes="${FAVICON_SIZE}x${FAVICON_SIZE}">
  <meta name="description" content="${escHtml(summary)}">
  <meta name="theme-color" content="${theme.page}"${opts.darkMode ? ` data-light="${appearance.light.page}" data-dark="${appearance.dark.page}"` : ""}>
${opts.darkMode ? `  <script>
${indent(read("appearance.js"), 4)}
  </script>` : ""}
  <meta property="og:title" content="${escHtml(pageTitle)}">
  <meta property="og:description" content="${escHtml(summary)}">
  <meta property="og:url" content="${escHtml(config.url)}">
  <meta property="og:type" content="profile">
  <script type="application/ld+json">
${scriptJson(buildPerson(), 2)}
  </script>
${
  opts.pwa
    ? `  <link rel="manifest" href="manifest.webmanifest">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="${escHtml(config.name)}">
  <link rel="apple-touch-icon" href="${appIcon.name}">
`
    : ""
}
  <style>
${indent(themeCss, 4)}

${indent(read("card.css"), 4)}
${opts.paper ? indent(read("paper.css"), 4) : ""}
${opts.darkMode ? indent(appearance.css + "\n" + read("appearance.css"), 4) : ""}
  </style>
  <style id="card-landscape" media="(min-width: 640px) and (max-height: 759px)">
${indent(read("landscape.css"), 4)}
  </style>
  <script>
${indent(read("layout.js"), 4)}
  </script>
</head>
<body${opts.paper ? ' class="paper-page"' : ""}>
  <main class="${["card", opts.paper && "paper", !opts.paper && backgrounds.length > 1 && "swipe", opts.glint && "glint"].filter(Boolean).join(" ")}">
${bgLayersHtml}

    <div class="content">
${buildHeader()}
      <div class="card-layout">
      <div class="card-profile">
      <div class="identity">
${buildPhotoHtml()}
      <div class="identity-text">
      <h1 class="name">${escHtml(config.name)}</h1>
      <div class="subtitle">
        ${buildSubtitle()}
      </div>
      </div>
      </div>
${opts.paper ? translatedText("p", "paper-tagline", "tagline") : ""}

${buildNowHtml()}
      </div>
      <div class="card-details">
${buildContactInfo()}

${opts.paper ? buildQrSection() : buildLinksHtml()}

${opts.paper ? buildLinksHtml() : buildQrSection()}
      </div>
      </div>
    </div>
${opts.paper ? `    <svg class="paper-wave${opts.animateWaves ? " paper-wave-animated" : ""}" viewBox="0 0 480 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="paper-wave-color"><stop stop-color="${theme.accent}"/><stop offset="1" stop-color="${theme.dark}"/></linearGradient></defs><path d="M0 30 C105 5 168 86 310 63 C395 49 437 26 480 0 V100 H0Z" fill="url(#paper-wave-color)"/></svg>` : ""}
  </main>
${bgDotsHtml}
${buildQrDialog()}
${config.languages.length > 1 ? `  <script type="application/json" id="card-locales">${scriptJson(translations)}</script>` : ""}
${qrToggle ? `  <script type="application/json" id="card-qr">${scriptJson(qrModes)}</script>` : ""}
  <script>
${indent(String(withPhoto), 4)}

${indent(String(toVCardDataUri), 4)}

${config.languages.length > 1 ? indent(read("language.js"), 4) : ""}

${qrToggle ? indent(read("qr-switch.js"), 4) : ""}

${indent(read("card.js"), 4)}
  </script>
</body>
</html>`;

// ── Icon and PWA assets ──────────────────────────────────────
async function buildFavicon() {
  if (photo) {
    try {
      return await photoFavicon(photo.data);
    } catch (err) {
      warn(`couldn't create photo favicon (${err.message}) — using initials`);
    }
  }
  return toPng(buildInitialsSvg(), FAVICON_SIZE);
}

function buildInitialsSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${theme.dark}"/>
  <text x="256" y="256" text-anchor="middle" dominant-baseline="central"
    font-family="${ICON_FONT}" font-size="220" font-weight="600" fill="${theme.text}">${escHtml(initials)}</text>
</svg>`;
}

// Android's launcher icon. It's "maskable": the launcher crops it to its
// own shape (circle, squircle, …) instead of shrinking a plain icon onto a
// white disc. The card's bands fill the square, and the photo (or the
// initials) sits in the middle with the card's accent ring, inside the
// central circle, 80% across, that every mask keeps.
const MASKABLE = [192, 512].map((size) => ({ size, name: `icon-maskable-${size}.png` }));

function buildMaskableSvg() {
  const C = 256, R = 176;
  const { mid, dark } = restingWaves();
  const face = photo
    ? `<image href="${photo.src}" x="${C - R}" y="${C - R}" width="${2 * R}" height="${2 * R}" preserveAspectRatio="xMidYMid slice" clip-path="url(#face)"/>`
    : `<text x="${C}" y="${C}" text-anchor="middle" dominant-baseline="central" font-family="${ICON_FONT}" font-size="150" font-weight="600" fill="${theme.text}">${escHtml(initials)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <clipPath id="face"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="${theme.accent}" stop-opacity=".45"/><stop offset=".6" stop-color="${theme.accent}" stop-opacity=".12"/><stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2=".55" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".24"/><stop offset=".3" stop-color="#fff" stop-opacity=".05"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000" flood-opacity=".55"/></filter>
  </defs>
  <rect width="512" height="512" fill="${theme.light}"/>
  <g transform="scale(5.12)"><path d="${mid}" fill="${theme.mid}"/><path d="${dark}" fill="${theme.dark}"/></g>
  <rect width="512" height="512" fill="url(#top)"/>
  <circle cx="${C}" cy="${C}" r="${R + 46}" fill="url(#glow)"/>
  <circle cx="${C}" cy="${C}" r="${R}" fill="${theme.dark}" filter="url(#shadow)"/>
  ${face}
  <circle cx="${C}" cy="${C}" r="${R}" fill="url(#sheen)"/>
  <circle cx="${C}" cy="${C}" r="${R - 3}" fill="none" stroke="${theme.accent}" stroke-opacity=".6" stroke-width="7"/>
  <circle cx="${C}" cy="${C}" r="${R + 1}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2"/>
</svg>`;
}

function buildManifest() {
  const icons = [
    { src: appIcon.name, sizes: appIcon.sizes, type: appIcon.type, purpose: "any" },
    ...MASKABLE.map(({ size, name }) => ({ src: name, sizes: `${size}x${size}`, type: "image/png", purpose: "maskable" })),
  ];
  return JSON.stringify(
    {
      name: config.name,
      short_name: config.name.split(/\s+/)[0],
      description: summary,
      lang: config.lang,
      start_url: ".",
      scope: ".",
      display: "standalone",
      orientation: "any",
      background_color: theme.page,
      theme_color: theme.page,
      icons,
    },
    null,
    2
  );
}

// The card itself always comes from the network when it can, with the
// saved copy as the offline fallback; everything else is served from the
// cache first. The version stamp, derived from the content, retires the
// old cache after a rebuild.
function buildServiceWorker(assets, version) {
  return `const PREFIX = 'mecard-' + encodeURIComponent(self.registration.scope) + ':';
const CACHE = PREFIX + '${version}';
const ASSETS = ${JSON.stringify(assets)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => {
      const cache = await caches.open(CACHE);
      const page = await cache.match('index.html');
      // Hosts may redirect index.html to ./; navigations reject that flag.
      return page?.redirected ? new Response(page.body, {
        status: page.status, statusText: page.statusText, headers: page.headers,
      }) : page;
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((hit) => hit || fetch(req)));
});
`;
}

// ── Write ────────────────────────────────────────────────────
if (args.strict && warnings.length) {
  console.error(`✗ ${warnings.length} warning${warnings.length === 1 ? "" : "s"} with --strict, so nothing was written`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const written = [];
function emit(name, data) {
  writeFileSync(join(OUT, name), data);
  written.push(name);
}

emit("index.html", html);
emit("favicon.png", favicon);

if (opts.pwa) {
  emit(appIcon.name, photo ? photo.data : buildInitialsSvg());
  const maskable = buildMaskableSvg();
  for (const { size, name } of MASKABLE) emit(name, toPng(maskable, size));
  emit("manifest.webmanifest", buildManifest());
  // Version the cache off the page content so a rebuild invalidates it
  const version = createHash("sha256").update(html).digest("hex").slice(0, 12);
  emit("sw.js", buildServiceWorker(["index.html", faviconHref, "manifest.webmanifest", appIcon.name], version));
}

// Remove what an earlier build wrote and this one didn't. Only names a
// build can produce are touched, so --out can point anywhere safely.
const OUTPUTS = [
  "index.html", "favicon.png", "icon.svg", "manifest.webmanifest", "sw.js",
  ...Object.values(IMAGE_TYPES).map((t) => `icon.${t.ext}`),
  ...MASKABLE.map((m) => m.name),
];
for (const name of OUTPUTS) {
  if (!written.includes(name)) rmSync(join(OUT, name), { force: true });
}

console.log(`✓ Built ${OUT}/ for ${config.name}`);
console.log(`  Files: ${written.join(", ")}`);
console.log(`  QR encodes: ${qrToggle ? "vCard contact and card URL (switchable)" : contactQr ? "vCard contact (without photo)" : config.url}`);
console.log(
  `  Backgrounds: ${backgrounds.join(", ")}  Animate waves: ${opts.animateWaves ? "on" : "off"}  Glint: ${opts.glint ? "on" : "off"}` +
    `  Share: ${opts.share ? "on" : "off"}  PWA: ${opts.pwa ? "on" : "off"}`
);
if (opts.pwa && photo && !photo.size)
  console.log("  (couldn't read the photo's dimensions, so the manifest gives its icon no size)");

console.log(`  Languages: ${config.languages.join(", ")} (initial: ${config.lang})`);
