// One DOM and one copy of the assets. Only plain text, accessibility labels,
// metadata and the photo-free contact change when a language is selected.
(() => {
  const data = document.getElementById('card-locales');
  if (!data) return;
  const translations = JSON.parse(data.textContent);
  const buttons = [...document.querySelectorAll('[data-language]')];
  const select = document.querySelector('[data-language-select]');
  const save = document.querySelector('.save-btn');
  const schema = document.querySelector('script[type="application/ld+json"]');
  const person = schema && JSON.parse(schema.textContent);
  const storageKey = 'mecard-language:' + location.pathname;

  function apply(lang, remember = false) {
    if (!Object.hasOwn(translations, lang)) return;
    const value = translations[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = value.dir;
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const text = value.text[el.dataset.i18n] ?? '';
      el.textContent = text;
      if (el.hasAttribute('data-hide-empty')) el.hidden = !text;
    }
    for (const [marker, attribute] of [['data-i18n-aria', 'aria-label'], ['data-i18n-title', 'title']]) {
      for (const el of document.querySelectorAll('[' + marker + ']')) {
        el.setAttribute(attribute, value.text[el.getAttribute(marker)] ?? '');
      }
    }
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.language === lang));
    if (select) select.value = lang;
    for (const el of document.querySelectorAll('meta[name="description"], meta[property="og:description"]')) el.content = value.summary;
    if (person) {
      person.jobTitle = value.text.title || undefined;
      person.description = value.text.tagline || undefined;
      if (person.worksFor) person.worksFor.department = value.department ? { '@type': 'Organization', name: value.department } : undefined;
      schema.textContent = JSON.stringify(person).replace(/</g, '\\u003c');
    }
    if (save) save.href = toVCardDataUri(value.vcard);
    if (remember) {
      try { localStorage.setItem(storageKey, lang); } catch (e) {}
    }
    dispatchEvent(new Event('mecard:languagechange'));
  }

  function browserLanguage() {
    const available = new Map(Object.keys(translations).map(lang => [lang.toLowerCase(), lang]));
    const preferences = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const preference of preferences) {
      if (typeof preference !== 'string') continue;
      let prefix = preference.toLowerCase();
      // Match exact tags first, then progressively broader language/script
      // prefixes: fr-CA -> fr, zh-Hant-TW -> zh-Hant, en-AU -> en-GB.
      while (prefix) {
        if (available.has(prefix)) return available.get(prefix);
        const variant = [...available.keys()].find(lang => lang.startsWith(prefix + '-'));
        if (variant) return available.get(variant);
        const separator = prefix.lastIndexOf('-');
        prefix = separator < 0 ? '' : prefix.slice(0, separator);
      }
    }
  }

  for (const button of buttons) button.addEventListener('click', () => apply(button.dataset.language, true));
  select?.addEventListener('change', () => apply(select.value, true));
  let initial = browserLanguage() ?? document.documentElement.lang;
  try {
    const saved = localStorage.getItem(storageKey);
    if (Object.hasOwn(translations, saved)) initial = saved;
  } catch (e) {}
  // Only explicit choices are persisted; automatic selection can follow
  // future changes to the browser's preferred languages.
  apply(initial);
  for (const control of document.querySelectorAll('.language-switch, .language-picker')) control.hidden = false;
})();
