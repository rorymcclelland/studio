import { createHash } from "node:crypto";
import sharp from "sharp";
import { asUser } from "@/lib/db/scoped";
import { checkUploadedSvg, LogoError } from "./svg";

// F-10: a brand's own logo, uploaded as SVG (up to 200 KB) or PNG (up to 1 MB,
// Q4). The file's contents decide what it is, never its name alone: a file
// named .png must really be a PNG, and an SVG must be text that passes the
// upload check. An SVG is sanitised into brands.logo_svg; a PNG is decoded and
// re-encoded by sharp (metadata such as EXIF location dropped, at most 1024 px
// on its longest side) and kept as an asset of kind 'logo', linked from
// brands.logo_asset_id. A brand has one logo: uploading either kind replaces
// the other. Refusals are LogoError with the reason, and nothing is stored.

export { LogoError };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PNG_MAX_BYTES = 1024 * 1024;
export const SVG_MAX_BYTES = 200_000;
export const LOGO_MAX_SIDE = 1024;
/** A PNG this many pixels or more is refused before it is decoded (a small file can unpack to a huge picture). */
export const PNG_MAX_PIXELS = 4096 * 4096;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type LogoFile = { name: string; type?: string | null; bytes: Uint8Array };

export type ReadLogo =
  | { kind: "svg"; svg: string }
  | { kind: "png"; png: Buffer; width: number; height: number; original: { width: number; height: number; bytes: number } };

export type UploadedLogo = { kind: "svg"; svg: string } | { kind: "png"; assetId: string; src: string; width: number; height: number };

const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC);

function extension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

function asText(b: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/** Checks an uploaded logo and returns what would be stored, or throws LogoError with the reason. Touches no database. */
export async function readLogoUpload(file: LogoFile): Promise<ReadLogo> {
  const bytes = Buffer.from(file.bytes ?? []);
  if (bytes.length === 0) throw new LogoError("The file is empty.");
  const ext = extension(file.name ?? "");
  const looksPng = isPng(bytes);

  if (ext === "png" || (looksPng && ext !== "svg")) {
    if (bytes.length > PNG_MAX_BYTES) throw new LogoError("The PNG is too large (1 MB at most).");
    if (!looksPng) throw new LogoError("This file is named .png but isn't a PNG picture, so it can't be used.");
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try {
      // The header only (nothing is decoded), so the size can be refused with a reason before any pixels are unpacked.
      meta = await sharp(bytes, { limitInputPixels: false }).metadata();
    } catch {
      throw new LogoError("This PNG couldn't be read. Export it again and upload the new file.");
    }
    if (meta.format !== "png" || !meta.width || !meta.height) throw new LogoError("This file isn't a PNG picture, so it can't be used.");
    if (meta.width * meta.height > PNG_MAX_PIXELS) throw new LogoError("The PNG has too many pixels (4096 × 4096 at most).");
    try {
      // Re-encoded from the decoded pixels: no EXIF, text chunks or colour profiles are carried over.
      const { data, info } = await sharp(bytes, { limitInputPixels: PNG_MAX_PIXELS })
        .resize({ width: LOGO_MAX_SIDE, height: LOGO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      return { kind: "png", png: data, width: info.width, height: info.height, original: { width: meta.width, height: meta.height, bytes: bytes.length } };
    } catch {
      throw new LogoError("This PNG couldn't be read. Export it again and upload the new file.");
    }
  }

  if (ext === "svg" || ext === "" || file.type === "image/svg+xml") {
    if (looksPng) throw new LogoError("This file is named .svg but is a PNG. Rename it to .png, or upload the SVG.");
    if (bytes.length > SVG_MAX_BYTES) throw new LogoError("The SVG is too large (200 KB at most).");
    const text = asText(bytes);
    if (text === null) throw new LogoError("This file isn't an SVG (it isn't text), so it can't be used.");
    if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) throw new LogoError("This logo can't be used: it declares XML entities.");
    if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) {
      throw new LogoError("This file isn't an SVG image, so it can't be used.");
    }
    return { kind: "svg", svg: checkUploadedSvg(text.replace(/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?/i, "")) };
  }

  throw new LogoError("Upload the logo as an SVG or a PNG.");
}

/** Uploads a logo for a brand in the member's workspace, replacing its current one. Throws LogoError with the reason; nothing is stored then. */
export async function uploadBrandLogo(member: { userId: string; workspaceId: string }, brandId: string, file: LogoFile): Promise<UploadedLogo> {
  if (!UUID.test(brandId)) throw new LogoError("That brand isn't in your workspace.");
  const [brand] = await asUser(member.userId, (tx) => tx`select id, workspace_id from public.brands where id = ${brandId}`);
  if (!brand) throw new LogoError("That brand isn't in your workspace.");
  const logo = await readLogoUpload(file);

  return asUser(member.userId, async (tx) => {
    const [b] = await tx`select logo_asset_id from public.brands where id = ${brandId} for update`;
    if (!b) throw new LogoError("That brand isn't in your workspace.");
    const previous = (b.logo_asset_id as string | null) ?? null;
    let result: UploadedLogo;
    if (logo.kind === "svg") {
      await tx`update public.brands set logo_svg = ${logo.svg}, logo_asset_id = null where id = ${brandId}`;
      result = { kind: "svg", svg: logo.svg };
    } else {
      const sha256 = createHash("sha256").update(logo.png).digest("hex");
      const name = (file.name ?? "").replace(/[^\w .()-]/g, "").slice(0, 100);
      const [a] = await tx`
        insert into public.assets (workspace_id, kind, brand_id, campaign_id, run_id, mime, width, height, bytes, sha256, simulated, meta, created_by, created_by_kind)
        values (${brand.workspace_id}, 'logo', ${brandId}, null, null, 'image/png', ${logo.width}, ${logo.height}, ${logo.png}, ${sha256}, false,
                ${tx.json({ name, original: logo.original } as never)}, ${member.userId}, 'person')
        returning id`;
      await tx`update public.brands set logo_asset_id = ${a.id}, logo_svg = null where id = ${brandId}`;
      result = { kind: "png", assetId: a.id as string, src: `/assets/${a.id}`, width: logo.width, height: logo.height };
    }
    // The old PNG stays in the store (ads already made may show it), marked discarded.
    if (previous) await tx`update public.assets set discarded_at = now() where id = ${previous} and discarded_at is null`;
    return result;
  });
}

/** Removes a brand's logo (either kind). Ads already made keep the logo they were drawn with. */
export async function removeBrandLogo(member: { userId: string; workspaceId: string }, brandId: string): Promise<boolean> {
  if (!UUID.test(brandId)) return false;
  return asUser(member.userId, async (tx) => {
    const [b] = await tx`select logo_asset_id from public.brands where id = ${brandId} for update`;
    if (!b) return false;
    await tx`update public.brands set logo_svg = null, logo_asset_id = null where id = ${brandId}`;
    if (b.logo_asset_id) await tx`update public.assets set discarded_at = now() where id = ${b.logo_asset_id} and discarded_at is null`;
    return true;
  });
}
