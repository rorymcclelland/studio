import { inflateSync } from "node:zlib";
import sharp from "sharp";

// C8-3: an ad uploaded to be checked. A PNG or JPEG up to 4 MB and 4096 px on
// each side. The file's contents decide what it is, never its name or the
// type the browser claims: anything else (an SVG, a PDF, a script renamed
// .png) is refused with a plain reason. A file whose metadata or trailing
// bytes carry a script or markup is refused too, rather than quietly cleaned,
// so a person knows what they sent. What is kept is re-encoded by sharp from
// the decoded pixels (turned upright first, as a phone photo's orientation
// says): no EXIF, XMP, text chunks, comments or colour profile survive. The
// upload is checked, never redrawn (rule 8). Touches no database.

export class UploadError extends Error {}

export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const UPLOAD_MAX_SIDE = 4096;
/** The assets table's limit on an upload's bytes once re-encoded (db/migrations/20261103000002_uploaded_ads.sql). */
export const UPLOAD_STORED_MAX_BYTES = 10 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC);
const isJpeg = (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export type UploadFile = { name: string; type?: string | null; bytes: Uint8Array };

export type ReadUpload = {
  mime: "image/png" | "image/jpeg";
  bytes: Buffer;
  width: number;
  height: number;
  original: { width: number; height: number; bytes: number; format: "png" | "jpeg" };
};

// Script or markup that has no place in a picture's metadata.
const SCRIPTY = /<\s*script\b|javascript\s*:|vbscript\s*:|<\?php|<\s*iframe\b|<\s*object\b|<\s*embed\b|<\s*html\b|<\s*body\b|\bon(?:load|error|click|mouseover|focus)\s*=/i;

/** Text a PNG keeps compressed (zTXt, and iTXt with its flag set), inflated with a cap, so a script can't hide in it. */
function pngCompressedText(b: Buffer): string[] {
  const out: string[] = [];
  let at = 8;
  while (at + 12 <= b.length) {
    const len = b.readUInt32BE(at);
    const type = b.toString("latin1", at + 4, at + 8);
    const start = at + 8;
    const end = start + len;
    if (end + 4 > b.length) break;
    const data = b.subarray(start, end);
    try {
      if (type === "zTXt") {
        const nul = data.indexOf(0);
        if (nul >= 0) out.push(inflateSync(data.subarray(nul + 2), { maxOutputLength: 1_000_000 }).toString("latin1"));
      } else if (type === "iTXt") {
        const nul = data.indexOf(0);
        if (nul >= 0 && data[nul + 1] === 1) {
          // keyword \0 flag method language \0 translated keyword \0 text
          const lang = data.indexOf(0, nul + 3);
          const trans = lang >= 0 ? data.indexOf(0, lang + 1) : -1;
          if (trans >= 0) out.push(inflateSync(data.subarray(trans + 1), { maxOutputLength: 1_000_000 }).toString("utf8"));
        }
      }
    } catch {
      // Text that doesn't inflate is dropped by the re-encode anyway.
    }
    if (type === "IEND") break;
    at = end + 4;
  }
  return out;
}

/** Whether the file carries a script or markup anywhere outside its pixels: metadata, text chunks, comments or trailing bytes. */
export function carriesScript(b: Buffer, meta: { exif?: Buffer; xmp?: Buffer; iptc?: Buffer; comments?: { keyword: string; text: string }[] } = {}): boolean {
  if (SCRIPTY.test(b.toString("latin1"))) return true;
  if (isPng(b) && pngCompressedText(b).some((t) => SCRIPTY.test(t))) return true;
  for (const part of [meta.exif, meta.xmp, meta.iptc]) if (part && SCRIPTY.test(part.toString("latin1"))) return true;
  return (meta.comments ?? []).some((c) => SCRIPTY.test(`${c.keyword} ${c.text}`));
}

function looksLikeSvg(b: Buffer): boolean {
  const head = b.subarray(0, 2048).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")) || /^<!doctype svg/.test(head) || /^(<!--[\s\S]*?-->\s*)+<svg/.test(head);
}

const UNREADABLE = "This picture couldn't be read. Export it again and upload the new file.";

/** Checks an uploaded ad and returns what would be stored, or throws UploadError with the reason. */
export async function readAdUpload(file: UploadFile): Promise<ReadUpload> {
  const bytes = Buffer.from(file.bytes ?? []);
  if (bytes.length === 0) throw new UploadError("The file is empty.");
  if (bytes.length > UPLOAD_MAX_BYTES) throw new UploadError("The file is too large (4 MB at most).");
  const png = isPng(bytes);
  const jpeg = !png && isJpeg(bytes);
  if (!png && !jpeg) {
    if (looksLikeSvg(bytes)) throw new UploadError("An SVG can't be checked. Upload the ad as a PNG or JPEG.");
    throw new UploadError("This file isn't a PNG or JPEG picture, so it can't be checked.");
  }
  const format = png ? "png" : "jpeg";
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    // The header only (nothing is decoded), so a picture that is too big is refused before any pixels are unpacked.
    meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new UploadError(UNREADABLE);
  }
  if (meta.format !== format || !meta.width || !meta.height) throw new UploadError(UNREADABLE);
  if (meta.width > UPLOAD_MAX_SIDE || meta.height > UPLOAD_MAX_SIDE) {
    throw new UploadError(`The picture is too big: ${UPLOAD_MAX_SIDE} pixels at most on each side (this one is ${meta.width} × ${meta.height}).`);
  }
  if (carriesScript(bytes, meta)) {
    throw new UploadError("This picture can't be checked: its metadata carries a script or web code. Export it again without metadata and upload the new file.");
  }
  try {
    // Decoded, turned upright, and re-encoded from the pixels: no metadata is carried over (sharp drops it unless asked to keep it).
    const pipeline = sharp(bytes, { limitInputPixels: UPLOAD_MAX_SIDE * UPLOAD_MAX_SIDE, failOn: "error" }).rotate();
    const { data, info } = await (png ? pipeline.png({ compressionLevel: 6 }) : pipeline.jpeg({ quality: 90 })).toBuffer({ resolveWithObject: true });
    if (data.length > UPLOAD_STORED_MAX_BYTES) throw new UploadError("This picture is too detailed to keep once re-encoded. Export it smaller and upload the new file.");
    return {
      mime: png ? "image/png" : "image/jpeg",
      bytes: data,
      width: info.width,
      height: info.height,
      original: { width: meta.width, height: meta.height, bytes: bytes.length, format },
    };
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError(UNREADABLE);
  }
}
