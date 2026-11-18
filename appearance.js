// Runs in the head before the first paint; controls are wired once parsed.
(() => {
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const key = 'mecard-theme';
  let preference;
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch (e) {}

  function apply() {
    const mode = preference ?? (media.matches ? 'dark' : 'light');
    root.dataset.theme = mode;
    document.querySelector('.theme-toggle')?.setAttribute('aria-pressed', String(mode === 'dark'));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && !document.querySelector('.qr-full[open]')) meta.content = meta.dataset[mode];
  }
  apply();
  media.addEventListener?.('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('.theme-toggle');
    if (!button) return;
    button.hidden = false;
    button.addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, preference); } catch (e) {}
      apply();
    });
    apply();
  }, { once: true });
  addEventListener('mecard:qrclose', apply);
})();
