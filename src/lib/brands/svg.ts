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

// Paint and clip references may only point inside the logo: url(#id).
const EXTERNAL = /url\(\s*(?!['"]?#)|javascript:|data:|https?:/i;

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
      Object.entries(frame.attribs).some(([k, v]) => k !== "xmlns" && EXTERNAL.test(v)),
  });
  if (!/^<svg[\s>]/.test(out.trim())) throw new LogoError("The logo must be an SVG image.");
  return out.trim();
}
