import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Resvg } from '@resvg/resvg-js';
import ICAL from 'ical.js';
import { buildVCard } from '../vcard.js';
import { loadConfig } from '../config.js';
import { contactQrGeometry, contactQrSvg } from '../contact-qr.js';

const run = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), 'mecard-qr-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = join(dir, 'card.yaml');
const raw = {
  name: 'Élodie Test', url: 'https://example.test/card', email: 'hello@example.test',
  phone: '+33 1 23 45 67 89', website: 'https://example.test', organization: 'Test Company',
  options: { paper: true, pwa: false, qrContact: true, qrToggle: true, saveContact: false, showWebsite: false },
  links: [
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/example-person/?source=card', icon: 'linkedin', placement: 'contact' },
    { label: 'Company', url: 'https://example.test', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#abcdef"/></svg>' },
    { label: 'Product', url: 'https://product.example.test', icon: 'globe' },
  ],
  translations: { fr: { title: 'Direction', tagline: 'Données utiles' }, en: { title: 'Director', tagline: 'Useful data' } },
};
const root = resolve(import.meta.dirname, '..');
const build = async value => {
  writeFileSync(file, JSON.stringify(value));
  await run(process.execPath, [join(root, 'build.js'), '--config', file, '--out', join(dir, 'out'), '--strict']);
  return readFileSync(join(dir, 'out/index.html'), 'utf8');
};

test('contact QR is beside paper coordinates, localized, and independent of the download button', async () => {
  const html = await build(raw);
  assert.match(html, /class="contact-block"/);
  assert.match(html, /data-i18n="email">Mél</);
  assert.equal((html.match(/<button[^>]+class="qr-container"/g) ?? []).length, 1);
  assert.equal((html.match(/<svg[^>]+data-contact-qr=/g) ?? []).length, 2, 'one button and one dialog');
  assert.ok(html.indexOf('class="contact-qr"') < html.indexOf('class="qr-section"'));
  const rows = html.match(/<div class="contact-info">([\s\S]*?)<\/div>/)[1];
  assert.ok(rows.indexOf('tel:+33123456789') < rows.indexOf('https://www.linkedin.com/in/example-person/'));
  assert.match(rows, /<span class="contact-label">LinkedIn<\/span><bdi>example-person<\/bdi>/);
  assert.match(rows, /aria-label="LinkedIn: example-person"/);
  assert.doesNotMatch(rows, /href="https:\/\/example.test"/);
  const buttons = html.match(/<div class="links">([\s\S]*?)<\/div>/)[1];
  assert.match(buttons, /<span>Company<\/span>/);
  assert.match(buttons, /fill="#abcdef"/);
  assert.match(buttons, /<span>Product<\/span>/);
  assert.doesNotMatch(buttons, /LinkedIn/);
  assert.ok(html.indexOf('class="qr-section"') < html.indexOf('class="links"'), 'paper links follow the primary action');
  const translations = JSON.parse(html.match(/id="card-locales">([\s\S]*?)<\/script>/)[1]);
  const modes = JSON.parse(html.match(/id="card-qr">([\s\S]*?)<\/script>/)[1]);
  assert.equal(modes.initial, 'contact');
  assert.equal(modes.variants.fr.contactLabel, 'Ajouter le contact');
  assert.equal(modes.variants.fr.linkLabel, 'Partager la fiche');
  const preview = html.slice(html.indexOf('<div class="contact-qr">'), html.indexOf('class="qr-section"'));
  const dialog = html.match(/<dialog\b[^>]*>([\s\S]*?)<\/dialog>/)[1];
  for (const [section, codeClass] of [[preview, 'qr-container'], [dialog, 'qr-full-code']]) {
    assert.match(section, /data-qr-caption aria-live="polite">Ajouter le contact<\/span>/);
    assert.ok(section.indexOf('data-qr-caption') < section.indexOf(`class="${codeClass}"`));
    assert.match(section, /class="i18n-size" aria-hidden="true" inert lang="en" dir="ltr">Share this card<\/span>/);
  }
  assert.deepEqual(modes.link, contactQrGeometry(raw.url));
  assert.equal((html.match(/role="group" aria-label="Contenu du QR code"/g) ?? []).length, 2);
  for (const lang of ['fr', 'en']) {
    const config = loadConfig(file, assert.fail, lang);
    const card = buildVCard(config);
    assert.deepEqual(modes.variants[lang].contact, contactQrGeometry(card));
    assert.equal(translations[lang].qr, undefined, 'contact geometry must not be duplicated');
    assert.doesNotMatch(card, /PHOTO;/);
    const contact = new ICAL.Component(ICAL.parse(card));
    assert.equal(contact.getFirstPropertyValue('fn'), raw.name);
    assert.equal(contact.getFirstPropertyValue('tel'), raw.phone);
    assert.equal(contact.getFirstPropertyValue('email'), raw.email);
    assert.equal(contact.getFirstPropertyValue('title'), raw.translations[lang].title);
    assert.equal((card.match(/URL:https:\/\/example.test\r\n/g) ?? []).length, 1, 'website is exported once');
    assert.match(card, /URL:https:\/\/www.linkedin.com\/in\/example-person\//);
  }
});

test('QR can be hidden completely and the URL QR remains the default', async () => {
  const html = await build({ ...raw, options: { ...raw.options, qr: false } });
  assert.doesNotMatch(html, /<svg[^>]+data-contact-qr=/);
  assert.doesNotMatch(html, /<button[^>]+class="qr-container"/);
  assert.doesNotMatch(html, /class="contact-block"/);
  assert.doesNotMatch(html, /id="card-qr"/);
  writeFileSync(file, JSON.stringify({ name: 'Test', url: raw.url }));
  assert.equal(loadConfig(file).options.qrContact, false);
});

test('the QR switch works with one language and can start with the card URL', async () => {
  const html = await build({ ...raw, translations: undefined, lang: 'en', options: { ...raw.options, qrContact: false }, links: [
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/%3Cimg%20src=x%3E/', icon: 'linkedin', placement: 'contact' },
  ] });
  assert.doesNotMatch(html, /id="card-locales"/);
  const modes = JSON.parse(html.match(/id="card-qr">([\s\S]*?)<\/script>/)[1]);
  assert.equal(modes.initial, 'link');
  assert.deepEqual(Object.keys(modes.variants), ['en']);
  assert.match(html, /data-qr-caption aria-live="polite">Share this card<\/span>/);
  const controls = [...html.matchAll(/<button\b[^>]+data-qr-mode="(contact|link)"[^>]*>[\s\S]*?<\/button>/g)];
  assert.equal(controls.length, 4, 'two modes in both the preview and dialog');
  for (const [button, mode] of controls) {
    const name = mode === 'contact' ? 'Save' : 'Share';
    const key = mode === 'contact' ? 'qrContactMode' : 'qrLinkMode';
    const description = mode === 'contact' ? 'Save contact' : 'Share this card';
    assert.ok(button.includes(`aria-label="${name}" data-i18n-aria="${key}"`));
    assert.ok(button.includes(`title="${description}"`));
    assert.match(button, /<svg aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(button, /<span| data-i18n=/, 'language changes must preserve the icon');
  }
  assert.match(html, /<bdi>&lt;img src=x&gt;<\/bdi>/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /class="contact-block"/);
});

// zbar is an optional independent scanner, not a build/runtime dependency.
// It verifies rendered pixels, including UTF-8 bytes and the four-module margin.
const hasScanner = spawnSync('zbarimg', ['--version']).status === 0;
test('an independent QR scanner recovers the exact UTF-8 vCard from rendered pixels', { skip: !hasScanner }, async () => {
  writeFileSync(file, JSON.stringify(raw));
  for (const lang of ['fr', 'en', 'link']) {
    const payload = lang === 'link' ? raw.url : buildVCard(loadConfig(file, assert.fail, lang));
    const png = join(dir, `qr-${lang}.png`);
    writeFileSync(png, new Resvg(contactQrSvg(contactQrGeometry(payload)), { fitTo: { mode: 'width', value: 800 } }).render().asPng());
    const { stdout } = await run('zbarimg', ['--quiet', '--nodbus', '--raw', '-Sbinary', png], { encoding: 'buffer' });
    // Scanner versions differ on whether they append an output delimiter.
    assert.ok(stdout.equals(Buffer.from(payload)) || stdout.equals(Buffer.from(payload + '\n')));
  }
});
