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
  options: { paper: true, pwa: false, qrContact: true, saveContact: false },
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
  const translations = JSON.parse(html.match(/id="card-locales">([\s\S]*?)<\/script>/)[1]);
  for (const lang of ['fr', 'en']) {
    const config = loadConfig(file, assert.fail, lang);
    const card = buildVCard(config);
    assert.deepEqual(translations[lang].qr, contactQrGeometry(card));
    assert.doesNotMatch(card, /PHOTO;/);
    const contact = new ICAL.Component(ICAL.parse(card));
    assert.equal(contact.getFirstPropertyValue('fn'), raw.name);
    assert.equal(contact.getFirstPropertyValue('tel'), raw.phone);
    assert.equal(contact.getFirstPropertyValue('email'), raw.email);
    assert.equal(contact.getFirstPropertyValue('title'), raw.translations[lang].title);
  }
});

test('QR can be hidden completely and the URL QR remains the default', async () => {
  const html = await build({ ...raw, options: { ...raw.options, qr: false } });
  assert.doesNotMatch(html, /<svg[^>]+data-contact-qr=/);
  assert.doesNotMatch(html, /<button[^>]+class="qr-container"/);
  assert.doesNotMatch(html, /class="contact-block"/);
  writeFileSync(file, JSON.stringify({ name: 'Test', url: raw.url }));
  assert.equal(loadConfig(file).options.qrContact, false);
});

// zbar is an optional independent scanner, not a build/runtime dependency.
// It verifies rendered pixels, including UTF-8 bytes and the four-module margin.
const hasScanner = spawnSync('zbarimg', ['--version']).status === 0;
test('an independent QR scanner recovers the exact UTF-8 vCard from rendered pixels', { skip: !hasScanner }, async () => {
  writeFileSync(file, JSON.stringify(raw));
  for (const lang of ['fr', 'en']) {
    const payload = buildVCard(loadConfig(file, assert.fail, lang));
    const png = join(dir, `qr-${lang}.png`);
    writeFileSync(png, new Resvg(contactQrSvg(contactQrGeometry(payload)), { fitTo: { mode: 'width', value: 800 } }).render().asPng());
    const { stdout } = await run('zbarimg', ['--quiet', '--nodbus', '--raw', '-Sbinary', png], { encoding: 'buffer' });
    // Scanner versions differ on whether they append an output delimiter.
    assert.ok(stdout.equals(Buffer.from(payload)) || stdout.equals(Buffer.from(payload + '\n')));
  }
});
