// Keep URL validation shared by the config loader and the vCard writer.
export const WEB_PROTOCOLS = ["http:", "https:"];
export const LINK_PROTOCOLS = [...WEB_PROTOCOLS, "mailto:", "tel:"];

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
