// Both previews share one mode; choosing a language never resets that choice.
// All QR geometry is generated at build time and switched without requests.
(() => {
  const element = document.getElementById('card-qr');
  if (!element) return;
  const data = JSON.parse(element.textContent);
  const buttons = [...document.querySelectorAll('[data-qr-mode]')];
  let mode = data.initial;

  function render() {
    const variant = data.variants[document.documentElement.lang] ?? data.variants[data.defaultLang];
    const geometry = mode === 'contact' ? variant.contact : data.link;
    for (const svg of document.querySelectorAll('[data-contact-qr]')) {
      svg.setAttribute('viewBox', geometry.viewBox);
      svg.querySelector('[data-qr-modules]').setAttribute('d', geometry.path);
    }
    for (const caption of document.querySelectorAll('[data-qr-caption]')) {
      caption.textContent = mode === 'contact' ? variant.contactLabel : variant.linkLabel;
    }
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.qrMode === mode));
  }

  for (const button of buttons) button.addEventListener('click', () => {
    if (!['contact', 'link'].includes(button.dataset.qrMode)) return;
    mode = button.dataset.qrMode;
    render();
  });
  addEventListener('mecard:languagechange', render);
  render();
  for (const control of document.querySelectorAll('.qr-mode-switch')) control.hidden = false;
})();
