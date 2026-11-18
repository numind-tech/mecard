import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const script = readFileSync(new URL('../layout.js', import.meta.url), 'utf8');
const automatic = '(min-width: 640px) and (max-height: 759px)';
const available = '(min-width: 640px) and (min-height: 760px)';
const run = promisify(execFile);

function browser({ width = 1440, height = 1000 } = {}) {
  const root = { dataset: {} }, sheet = { media: automatic };
  const events = new Map(), changes = new Map(), attributes = new Map();
  const labels = { layoutPortrait: 'Switch to portrait', layoutLandscape: 'Switch to landscape' };
  const button = {
    hidden: true,
    addEventListener: (name, fn) => changes.set(name, fn),
    setAttribute: (name, value) => attributes.set(name, value),
    querySelector: selector => ({ textContent: labels[selector.match(/"(.+)"/)[1]] }),
  };
  const queries = new Map();
  const matches = query => query === automatic ? width >= 640 && height < 760 : width >= 640 && height >= 760;
  runInNewContext(script, {
    document: {
      documentElement: root,
      getElementById: id => { assert.equal(id, 'card-landscape'); return sheet; },
      querySelector: () => button,
      addEventListener: (name, fn) => events.set(name, fn),
    },
    matchMedia: query => {
      assert.ok([automatic, available].includes(query));
      const media = { matches: matches(query), addEventListener: (_, fn) => { media.change = fn; } };
      queries.set(query, media);
      return media;
    },
    addEventListener: (name, fn) => events.set(name, fn),
  });
  return {
    root, sheet, button, labels, attributes,
    parse() { events.get('DOMContentLoaded')(); },
    click() { changes.get('click')(); },
    resize(w, h) {
      width = w; height = h;
      for (const [query, media] of queries) media.matches = matches(query);
      for (const media of queries.values()) media.change();
    },
    translate() { events.get('mecard:languagechange')(); },
  };
}

test('large screens start in portrait and the toggle alternates only two layouts', () => {
  const page = browser();
  assert.equal(page.sheet.media, automatic);
  assert.equal(page.root.dataset.layout, 'portrait');
  assert.equal(page.button.hidden, true);
  page.parse();
  assert.equal(page.button.hidden, false);
  page.click();
  assert.equal(page.sheet.media, '(min-width: 640px)');
  assert.equal(page.root.dataset.layout, 'landscape');
  assert.equal(page.attributes.get('aria-pressed'), 'true');
  assert.equal(page.button.title, 'Switch to portrait');
  page.click();
  assert.equal(page.sheet.media, 'not all');
  assert.equal(page.root.dataset.layout, 'portrait');
  assert.equal(page.attributes.get('aria-pressed'), 'false');
  assert.equal(page.button.title, 'Switch to landscape');
});

test('short or narrow windows hide the toggle without trapping a manual layout', () => {
  const page = browser();
  page.parse();
  page.click();
  page.click(); // Explicit portrait preference.
  page.resize(844, 390);
  assert.equal(page.button.hidden, true);
  assert.equal(page.root.dataset.layout, 'landscape');
  assert.equal(page.sheet.media, automatic);
  page.resize(639, 900);
  assert.equal(page.button.hidden, true);
  assert.equal(page.root.dataset.layout, 'portrait');
  page.resize(640, 759);
  assert.equal(page.button.hidden, true);
  page.resize(640, 760);
  assert.equal(page.button.hidden, false);
  assert.equal(page.root.dataset.layout, 'portrait');
  assert.equal(page.sheet.media, 'not all', 'manual preference resumes when space allows');
  const fresh = browser({ width: 844, height: 390 });
  fresh.parse();
  assert.equal(fresh.root.dataset.layout, 'landscape');
  assert.equal(fresh.button.hidden, true);
});

test('opening starts responsive again and translated tooltips keep the selected layout', () => {
  const page = browser();
  page.parse();
  page.click();
  page.labels.layoutPortrait = 'Afficher en portrait';
  page.translate();
  assert.equal(page.button.title, 'Afficher en portrait');
  assert.equal(page.attributes.get('data-i18n-title'), 'layoutPortrait');
  assert.equal(page.root.dataset.layout, 'landscape');
  assert.equal(browser().sheet.media, automatic);
  assert.equal(browser({ width: 844, height: 390 }).root.dataset.layout, 'landscape');
});

test('both card styles include a localized two-state toggle even without theme controls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mecard-layout-'));
  try {
    for (const paper of [false, true]) {
      const config = join(dir, 'card.yaml'), out = join(dir, 'out');
      writeFileSync(config, JSON.stringify({
        name: 'Test Person', url: 'https://example.test/card', lang: 'fr',
        options: { paper, darkMode: false, pwa: false },
        translations: { fr: {}, en: {}, de: { labels: { layoutLandscape: '<Querformat>' } } },
      }));
      await run(process.execPath, [new URL('../build.js', import.meta.url).pathname,
        '--config', config, '--out', out, '--strict']);
      const html = readFileSync(join(out, 'index.html'), 'utf8');
      assert.equal((html.match(/class="layout-toggle"/g) ?? []).length, 1);
      assert.match(html, /<button type="button" class="layout-toggle"[^>]*hidden>/);
      assert.match(html, /data-i18n="layoutLandscape">Afficher en paysage<\/span>/);
      assert.match(html, /<style id="card-landscape" media="\(min-width: 640px\) and \(max-height: 759px\)">/);
      assert.ok(html.indexOf("const automatic = sheet.media") < html.indexOf('<body'));
      const translations = JSON.parse(html.match(/id="card-locales">([\s\S]*?)<\/script>/)[1]);
      assert.equal(translations.en.text.layoutLandscape, 'Switch to landscape');
      assert.equal(translations.de.text.layoutLandscape, '<Querformat>');
      assert.doesNotMatch(html, /class="theme-toggle"|<Querformat>/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
