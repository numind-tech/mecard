import QRCode from "qrcode";

// Keep the SVG geometry separate from its DOM. Switching language only updates
// numeric path data, never inserts translated markup into the page.
export function contactQrGeometry(vcard) {
  const { modules } = QRCode.create(vcard, { errorCorrectionLevel: "M" });
  const margin = 4;
  const size = modules.size + margin * 2;
  let path = "";
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size;) {
      if (!modules.get(y, x)) { x++; continue; }
      const start = x;
      while (x < modules.size && modules.get(y, x)) x++;
      path += `M${start + margin} ${y + margin + 0.5}h${x - start}`;
    }
  }
  return { viewBox: `0 0 ${size} ${size}`, path };
}

export function contactQrSvg(geometry) {
  return `<svg xmlns="http://www.w3.org/2000/svg" data-contact-qr="" viewBox="${geometry.viewBox}" shape-rendering="crispEdges" aria-hidden="true"><rect width="100%" height="100%" fill="#fff"/><path data-qr-modules="" stroke="#16161a" d="${geometry.path}"/></svg>`;
}
