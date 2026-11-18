// Keep URL validation shared by the config loader and the vCard writer.
export const WEB_PROTOCOLS = ["http:", "https:"];
export const LINK_PROTOCOLS = [...WEB_PROTOCOLS, "mailto:", "tel:"];

// Display a profile's last path component without changing the URL or its
// label in the exported contact. Encoded text still needs HTML escaping.
export function linkedinHandle(value) {
  const url = new URL(value);
  if (!WEB_PROTOCOLS.includes(url.protocol) || !/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const segment = url.pathname.split('/').filter(Boolean).at(-1);
  if (!segment) return null;
  try {
    const decoded = decodeURIComponent(segment);
    return /[\u0000-\u001f\u007f-\u009f]/u.test(decoded) ? segment : decoded;
  } catch { return segment; }
}

export function validateUrl(value, key = "url", protocols = WEB_PROTOCOLS) {
  const text = String(value);
  // URL parsers silently discard some controls. Reject them before parsing,
  // otherwise a value that looks safe can still inject a vCard content line.
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(text)) {
    throw new Error(`${key} must not contain control characters`);
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${key} isn't a valid URL`);
  }
  if (!protocols.includes(url.protocol) || url.username || url.password) {
    throw new Error(`${key} must use ${protocols.join(" or ")} without credentials`);
  }
  return text;
}
