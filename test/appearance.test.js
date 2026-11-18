import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { appearanceTheme, contrast } from '../appearance-theme.js';
import { THEME, loadConfig } from '../config.js';
import { mix } from '../backgrounds.js';

const script = readFileSync(new URL('../appearance.js', import.meta.url), 'utf8');
const run = promisify(execFile);

function browser({ dark = false, saved, blocked = false } = {}) {
  const listeners = new Map(), buttonListeners = new Map(), mediaListeners = new Map();
  const attributes = new Map();
  const root = { dataset: {} };
  const button = { hidden: true, setAttribute: (key, value) => attributes.set(key, value), addEventListener: (event, callback) => buttonListeners.set(event, callback) };
  const meta = { content: '#original', dataset: { light: '#f4f3f7', dark: '#121218' } };
  const media = { matches: dark, addEventListener: (event, callback) => mediaListeners.set(event, callback) };
  const storage = new Map(saved === undefined ? [] : [['mecard-theme', saved]]);
  let parsed = false, qrOpen = false;
  runInNewContext(script, {
    document: {
      documentElement: root,
      querySelector: selector => selector === '.theme-toggle' ? (parsed ? button : null)
        : selector === '.qr-full[open]' ? (qrOpen ? {} : null) : meta,
      addEventListener: (event, callback) => listeners.set(event, callback),
    },
    localStorage: {
      getItem: key => { if (blocked) throw Error('Blocked'); return storage.get(key); },
      setItem: (key, value) => { if (blocked) throw Error('Blocked'); storage.set(key, value); },
    },
    matchMedia: query => { assert.equal(query, '(prefers-color-scheme: dark)'); return media; },
    addEventListener: (event, callback) => listeners.set(event, callback),
  });
  return {
    root, button, meta, storage, attributes,
    parse() { parsed = true; listeners.get('DOMContentLoaded')(); },
    click() { buttonListeners.get('click')(); },
    system(dark) { media.matches = dark; mediaListeners.get('change')(); },
    openQr() { qrOpen = true; meta.content = '#ffffff'; },
    closeQr() { qrOpen = false; listeners.get('mecard:qrclose')(); },
  };
}

test('appearance is selected before controls exist and follows the system until chosen manually', () => {
  const page = browser({ dark: true });
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.meta.content, '#121218');
  assert.equal(page.button.hidden, true);
  assert.equal(page.storage.size, 0, 'automatic choices must not be persisted');
  page.parse();
  assert.equal(page.button.hidden, false);
  assert.equal(page.attributes.get('aria-pressed'), 'true');
  page.system(false);
  assert.equal(page.root.dataset.theme, 'light');
  assert.equal(page.attributes.get('aria-pressed'), 'false');
  page.click();
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.storage.get('mecard-theme'), 'dark');
  page.system(false);
  assert.equal(page.root.dataset.theme, 'dark');
});

test('remembered themes are validated and blocked storage does not break the toggle', () => {
  assert.equal(browser({ dark: true, saved: 'light' }).root.dataset.theme, 'light');
  assert.equal(browser({ dark: false, saved: 'dark' }).root.dataset.theme, 'dark');
  for (const saved of ['system', 'constructor', '<script>']) {
    assert.equal(browser({ dark: true, saved }).root.dataset.theme, 'dark');
  }
  const page = browser({ blocked: true });
  page.parse();
  page.click();
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.attributes.get('aria-pressed'), 'true');
  page.click();
  assert.equal(page.root.dataset.theme, 'light');
});

test('a full-screen QR stays white and closing restores the current theme after a system change', () => {
  const page = browser();
  page.parse();
  page.openQr();
  page.system(true);
  assert.equal(page.meta.content, '#ffffff');
  page.closeQr();
  assert.equal(page.meta.content, '#121218');
});

test('generated palettes retain readable text and controls even for very bright or dark brand colours', () => {
  const brand = { ...THEME, dark: '#575086', page: '#f4f3f7', text: '#252930' };
  const paper = appearanceTheme(brand, true);
  assert.equal(paper.light.ink, brand.dark, 'paper should preserve readable brand colours');
  assert.equal(paper.light.button, brand.dark);
  assert.equal(paper.light.page, brand.page);
  assert.equal(paper.light.text, brand.text);
  for (const theme of [THEME, { ...THEME, dark: '#ffffff', accent: '#000000', text: '#ffffff' }, { ...THEME, dark: '#ffff00', accent: '#0000ff', text: '#808080' }]) {
    const { light, dark } = appearanceTheme(theme);
    for (const [mode, palette] of Object.entries({ light, dark })) {
      const artSurface = mix(mode === 'light' ? '#000000' : '#ffffff', palette.surface, .88);
      for (const surface of [palette.surface, artSurface]) {
        for (const key of ['text', 'muted', 'dim', 'ink']) {
          assert.ok(contrast(palette[key], surface) >= 4.5, `${mode} ${key} is unreadable on ${surface}`);
        }
      }
      assert.ok(contrast(palette.button, palette['button-text']) >= 4.5, `${mode} button`);
    }
  }
});

test('both layouts inline the control, translated name and early script, and opt-out keeps the original layout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mecard-appearance-'));
  try {
    const lightLogo = '<svg viewBox="0 0 10 10"><circle id="mark" cx="5" cy="5" r="4" fill="#123456"/></svg>';
    const darkLogo = '<svg viewBox="0 0 10 10"><circle id="mark" cx="5" cy="5" r="4" fill="#abcdef"/></svg>';
    mkdirSync(join(dir, 'branding'));
    writeFileSync(join(dir, 'branding/light.svg'), lightLogo);
    writeFileSync(join(dir, 'branding/dark.svg'), darkLogo);
    const defaults = join(dir, 'branding/shared.yaml');
    writeFileSync(defaults, JSON.stringify({ logo: 'light.svg', logoDark: 'dark.svg' }));
    for (const [paper, darkMode, paired = true] of [[true, true], [false, true], [true, false], [true, true, false]]) {
      const config = join(dir, 'card.yaml');
      const out = join(dir, 'dist');
      writeFileSync(config, JSON.stringify({
        name: 'Test Person', url: 'https://example.test/card', lang: 'fr',
        options: { paper, darkMode, pwa: false },
        ...(paired ? {} : { logoDark: null }),
        translations: { fr: {}, en: {}, de: { labels: { darkMode: 'Dunkelmodus' } } },
      }));
      await run(process.execPath, [new URL('../build.js', import.meta.url).pathname, '--config', config, '--defaults', defaults, '--out', out, '--strict']);
      const html = readFileSync(join(out, 'index.html'), 'utf8');
      if (darkMode && paired) {
        assert.match(html, /class="brand brand-themed"/);
        const logos = [...html.matchAll(/<img class="brand-(light|dark)" src="data:image\/svg\+xml;base64,([^"]+)" alt=""/g)];
        assert.equal(logos.length, 2);
        const settings = loadConfig(config, assert.fail, undefined, { defaults });
        for (const [index, expected] of [settings.logo, settings.logoDark].entries()) {
          const svg = Buffer.from(logos[index][2], 'base64').toString();
          assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
          assert.equal(svg.replace(' xmlns="http://www.w3.org/2000/svg"', ''), expected);
        }
        assert.match(settings.logoDark, /fill="#abcdef"/);
      } else {
        assert.match(html, /class="brand"/);
        assert.doesNotMatch(html, /<img class="brand-(light|dark)"/);
      }
      if (!darkMode) {
        assert.doesNotMatch(html, /class="theme-toggle"|--mode-page|mecard-theme/);
        continue;
      }
      assert.match(html, /class="theme-toggle" aria-label="Mode sombre" data-i18n-aria="darkMode" aria-pressed="false" hidden/);
      assert.ok(html.indexOf("const key = 'mecard-theme'") < html.indexOf('<body'), 'theme should apply before rendering');
      assert.match(html, /prefers-color-scheme: dark/);
      const translations = JSON.parse(html.match(/id="card-locales">([\s\S]*?)<\/script>/)[1]);
      assert.equal(translations.en.text.darkMode, 'Dark mode');
      assert.equal(translations.de.text.darkMode, 'Dunkelmodus');
      assert.equal((html.match(/class="theme-toggle"/g) ?? []).length, 1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
