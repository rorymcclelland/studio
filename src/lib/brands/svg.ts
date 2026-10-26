import sanitizeHtml from "sanitize-html";

export class LogoError extends Error {}

// Allow-list of SVG elements and attributes for logos (S2-2 #6). Anything not
// listed is dropped: scripts, event handlers, foreignObject, images, links,
// <use>, style attributes and every external reference. Logos are also shown
// through <img src="data:…">, where browsers never run scripts: two layers.
const ELEMENTS = [
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "title", "desc",
];

const SHAPE = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "opacity", "transform", "clip-path", "id",
];

type Attr = string | { name: string; multiple?: boolean; values: string[] };

const ATTRIBUTES: Record<string, Attr[]> = {
  svg: [{ name: "xmlns", multiple: false, values: ["http://www.w3.org/2000/svg"] }, "viewBox", "width", "height", "preserveAspectRatio", "fill", "role", "aria-label"],
  g: SHAPE,
  path: [...SHAPE, "d"],
  rect: [...SHAPE, "x", "y", "width", "height", "rx", "ry"],
  circle: [...SHAPE, "cx", "cy", "r"],
  ellipse: [...SHAPE, "cx", "cy", "rx", "ry"],
  line: [...SHAPE, "x1", "y1", "x2", "y2"],
  polyline: [...SHAPE, "points"],
  polygon: [...SHAPE, "points"],
  text: [...SHAPE, "x", "y", "dx", "dy", "font-family", "font-size", "font-weight", "letter-spacing", "text-anchor"],
  tspan: [...SHAPE, "x", "y", "dx", "dy", "font-weight"],
  linearGradient: ["id", "x1", "y1", "x2", "y2", "gradientUnits"],
  radialGradient: ["id", "cx", "cy", "r", "fx", "fy", "gradientUnits"],
  stop: ["offset", "stop-color", "stop-opacity"],
  clipPath: ["id"],
};

// Paint and clip references may only point inside the logo: url(#id). Only
// the attributes that can hold a reference are tested (F-10: an id or label
// containing "https" or "data:" is just text, and no longer drops the shape).
const EXTERNAL = /url\(\s*(?!['"]?#)|javascript:|data:|https?:/i;
const REFERENCE_ATTRS = new Set(["fill", "stroke", "clip-path", "mask", "filter", "stop-color", "style", "href", "xlink:href", "src"]);

/** Returns a safe copy of an SVG logo, or throws LogoError if it is not usable SVG. */
export function sanitizeLogoSvg(input: string): string {
  if (input.length > 50_000) throw new LogoError("The logo is too large (50 KB at most).");
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(input)) throw new LogoError("The logo must be an SVG image.");
  const out = sanitizeHtml(input, {
    allowedTags: ELEMENTS,
    allowedAttributes: ATTRIBUTES,
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "foreignObject", "foreignobject", "textarea", "noscript"],
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false, xmlMode: true },
    // The namespace declaration is an identifier, not a link, so it is exempt.
    exclusiveFilter: (frame) =>
      Object.entries(frame.attribs).some(([k, v]) => REFERENCE_ATTRS.has(k.toLowerCase()) && EXTERNAL.test(v)),
  });
  if (!/^<svg[\s>]/.test(out.trim())) throw new LogoError("The logo must be an SVG image.");
  // F-10: without the namespace a logo shown through <img> doesn't display.
  const svg = out.trim();
  return svgTagAttributeNames(svg).includes("xmlns") ? svg : svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

/**
 * The names of the opening <svg> tag's own attributes, read attribute by
 * attribute, so a value that mentions xmlns (aria-label="a xmlns=b") or holds
 * a ">" isn't taken for the namespace (review nit).
 */
function svgTagAttributeNames(svg: string): string[] {
  const names: string[] = [];
  const attr = /\s*([^\s=/>"']+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?/y;
  attr.lastIndex = 4; // after "<svg"
  while (attr.lastIndex < svg.length && !/^\s*\/?>/.test(svg.slice(attr.lastIndex))) {
    const at = attr.lastIndex;
    const m = attr.exec(svg);
    if (!m || attr.lastIndex === at) break;
    names.push(m[1]);
  }
  return names;
}

// What an uploaded logo may not contain. Stored logos are sanitised silently
// (S2-2); an upload is refused with the reason instead, so the person knows
// what to fix (F-10).
const REFUSE: [RegExp, string][] = [
  [/<script[\s>]/i, "it contains a script"],
  [/\son[a-z]+\s*=/i, "it contains an event handler (such as onload)"],
  [/<foreignObject[\s>]/i, "it embeds HTML (foreignObject)"],
  [/<image[\s>]/i, "it contains an embedded or linked picture; use a vector-only SVG or upload a PNG"],
  [/<use[^>]*\s(?:xlink:)?href\s*=\s*["'](?!#)/i, "it links to another file"],
  [/(?:\s(?:xlink:)?href|\ssrc)\s*=\s*["']\s*(?:javascript:|https?:|data:|\/\/)/i, "it links to another file"],
  [/url\(\s*['"]?(?!#)/i, "it refers to an outside file in a style or paint"],
];

/** F-10: checks an uploaded SVG logo, refusing it with a reason, then returns the sanitised copy. */
export function checkUploadedSvg(input: string): string {
  if (Buffer.byteLength(input, "utf8") > 200_000) throw new LogoError("The SVG is too large (200 KB at most).");
  for (const [re, why] of REFUSE) if (re.test(input)) throw new LogoError(`This logo can't be used: ${why}.`);
  const out = sanitizeLogoSvg(input.length > 50_000 ? input.replace(/<!--[\s\S]*?-->|<metadata[\s\S]*?<\/metadata>/g, "") : input);
  if (out.length > 50_000) throw new LogoError("The logo is too detailed (50,000 characters at most once cleaned). Simplify it or upload a PNG.");
  return out;
}
