// C8-3: fixture ads for Check an ad, made in code for the fictional demo
// brands (rule 2). The mock model can't see a picture, so it "reads" fixed
// words chosen by the picture's size (src/lib/agents/read-ad-mock.ts); each
// fixture is drawn with letter-like marks exactly inside those words' boxes,
// and a logo-like mark in the logo's box, so the contrast measured from its
// pixels is real. No font is needed: the marks are plain shapes. Used by the
// Vitest tests and the browser test (tests/e2e/upload.spec.ts).
import sharp from "sharp";
import { MOCK_UPLOAD_SIZES, mockReading, type MockBox, type MockKind } from "../../src/lib/agents/read-ad-mock";

export type FixtureOptions = {
  brand?: "Fernhollow Outfitters" | "Quillmoor Money";
  kind?: MockKind;
  format?: "png" | "jpeg";
  /** The panel behind the words and the words' colour (Fernhollow's Fog and Peat by default). */
  background?: string;
  text?: string;
  /** Another size for the clean reading (any size other than the special ones reads clean). */
  size?: { width: number; height: number };
};

export const CLEAN_SIZE = { width: 1080, height: 1080 };

export function fixtureSize(kind: MockKind, size?: { width: number; height: number }) {
  if (kind === "clean") return size ?? CLEAN_SIZE;
  return MOCK_UPLOAD_SIZES[kind];
}

/** Letter-like bars filling a box, as words would (about half the box is ink). */
function marks(b: MockBox, W: number, H: number, colour: string): string {
  const x0 = b.x * W;
  const y0 = b.y * H;
  const w = b.width * W;
  const h = b.height * H;
  const bar = Math.max(2, h * 0.18);
  const out: string[] = [];
  for (let x = x0 + bar * 0.5; x + bar <= x0 + w; x += bar * 2) {
    out.push(`<rect x="${x.toFixed(1)}" y="${(y0 + h * 0.15).toFixed(1)}" width="${bar.toFixed(1)}" height="${(h * 0.7).toFixed(1)}" fill="${colour}"/>`);
  }
  return out.join("");
}

/** The SVG of a fixture ad: a panel, marks where the words are, and a logo mark. */
export function fixtureSvg(opts: FixtureOptions = {}): string {
  const brand = opts.brand ?? "Fernhollow Outfitters";
  const kind = opts.kind ?? "clean";
  const { width: W, height: H } = fixtureSize(kind, opts.size);
  const reading = mockReading(brand, W, H);
  const bg = opts.background ?? "#E8EBE4";
  const ink = opts.text ?? "#2B2A26";
  const logo = reading.logo.box
    ? `<rect x="${reading.logo.box.x * W}" y="${reading.logo.box.y * H}" width="${reading.logo.box.width * W}" height="${reading.logo.box.height * H}" rx="6" fill="#3F5B3A"/>`
    : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
    logo,
    ...reading.words.map((w) => marks(w.box, W, H, ink)),
    "</svg>",
  ].join("");
}

/** A fixture ad as PNG or JPEG bytes. */
export async function fixtureAd(opts: FixtureOptions = {}): Promise<Buffer> {
  const img = sharp(Buffer.from(fixtureSvg(opts)));
  return opts.format === "jpeg" ? img.jpeg({ quality: 92 }).toBuffer() : img.png().toBuffer();
}

/** A PNG with a text chunk inserted after its header (tEXt keyword\0text), to stand for metadata a person didn't mean to send. */
export function withTextChunk(png: Buffer, keyword: string, text: string): Buffer {
  const data = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
  const type = Buffer.from("tEXt", "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), len, type, data, crc, png.subarray(ihdrEnd)]);
}

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
