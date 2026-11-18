// Start responsive; the first click overrides the layout until the next visit.
(() => {
  const sheet = document.getElementById('card-landscape');
  const automatic = sheet.media;
  const media = matchMedia(automatic);
  const room = matchMedia('(min-width: 640px) and (min-height: 760px)');
  let preference, button;

  function apply() {
    // A hidden toggle must not leave a tall portrait locked into a short window.
    const choice = room.matches ? preference : undefined;
    const mode = choice ?? (media.matches ? 'landscape' : 'portrait');
    sheet.media = choice === undefined ? automatic
      : choice === 'landscape' ? '(min-width: 640px)' : 'not all';
    document.documentElement.dataset.layout = mode;
    if (!button) return;
    button.hidden = !room.matches;
    button.setAttribute('aria-pressed', String(mode === 'landscape'));
    const action = mode === 'landscape' ? 'layoutPortrait' : 'layoutLandscape';
    button.setAttribute('data-i18n-title', action);
    button.title = button.querySelector('[data-layout-label="' + action + '"]').textContent;
  }
  apply();
  media.addEventListener('change', apply);
  room.addEventListener('change', apply);
  addEventListener('mecard:languagechange', apply);
  document.addEventListener('DOMContentLoaded', () => {
    button = document.querySelector('.layout-toggle');
    button.addEventListener('click', () => {
      preference = document.documentElement.dataset.layout === 'landscape' ? 'portrait' : 'landscape';
      apply();
    });
    apply();
  }, { once: true });
})();
