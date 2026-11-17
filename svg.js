import { SaxesParser } from "saxes";
import { ICONS } from "./icons.js";

// Custom icons are a drawing format, not arbitrary HTML, CSS or executable SVG.
// Parse XML and serialize only this static subset; never splice source markup
// back into the page. Unsupported or malformed icons fall back as a whole.
const ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "title", "desc",
]);
const ATTRIBUTES = new Set([
  "viewBox", "width", "height", "preserveAspectRatio", "id", "d", "points",
  "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr",
  "fill", "stroke", "color", "opacity", "fill-opacity", "stroke-opacity",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "fill-rule", "clip-rule", "transform",
  "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity",
  "clipPathUnits", "maskUnits", "maskContentUnits", "clip-path", "mask", "vector-effect",
]);
const PAINT = new Set(["fill", "stroke", "color", "stop-color"]);
const FRAGMENT = /^url\(\s*#[a-z_][\w.-]*\s*\)$/i;
const COLOR = /^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+-]+\))$/i;
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function cleanSvg(source, warn) {
  try {
    if (Buffer.byteLength(source) > 1024 * 1024) throw new Error("icon exceeds 1 MiB");
    const parser = new SaxesParser({ xmlns: true });
    const output = [];
    let depth = 0, hasViewBox = false;
    parser.on("doctype", () => { throw new Error("DOCTYPE is not allowed"); });
    parser.on("processinginstruction", () => { throw new Error("processing instructions are not allowed"); });
    parser.on("opentag", (node) => {
      if (!ELEMENTS.has(node.name) || node.prefix || (node.uri && node.uri !== "http://www.w3.org/2000/svg")) {
        throw new Error("unsupported SVG element");
      }
      if (depth === 0) {
        if (node.name !== "svg") throw new Error("root must be svg");
        hasViewBox = Object.hasOwn(node.attributes, "viewBox");
      }
      if (++depth > 64) throw new Error("SVG is nested too deeply");
      const attributes = [];
      for (const attr of Object.values(node.attributes)) {
        const { name, value } = attr;
        if (name === "xmlns" && value === "http://www.w3.org/2000/svg") continue;
        if (attr.prefix || !ATTRIBUTES.has(name)) throw new Error("unsupported SVG attribute");
        if (PAINT.has(name) && !COLOR.test(value) && !FRAGMENT.test(value)) {
          throw new Error("unsupported SVG paint");
        }
        if (["clip-path", "mask"].includes(name) && value !== "none" && !FRAGMENT.test(value)) {
          throw new Error("only local SVG references are allowed");
        }
        attributes.push(` ${name}="${escape(value)}"`);
      }
      output.push(`<${node.name}${attributes.join("")}>`);
    });
    parser.on("closetag", (node) => { output.push(`</${node.name}>`); depth--; });
    parser.on("text", (text) => output.push(escape(text)));
    parser.on("cdata", (text) => output.push(escape(text)));
    parser.write(source).close();
    if (!hasViewBox) warn("SVG has no viewBox, so it may be cropped instead of scaled");
    return output.join("").trim();
  } catch {
    warn("unsafe, unsupported or invalid SVG — using link");
    return ICONS.link;
  }
}
