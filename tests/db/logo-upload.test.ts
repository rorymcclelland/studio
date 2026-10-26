// F-10 test cases 4 and 5, with 1 and 3 through the upload path: a brand's
// own logo as SVG or PNG. Hostile files are refused with a reason and nothing
// is stored; a PNG is re-encoded without its metadata; the brand save path
// keeps the stored logo; a PNG logo is drawn in ads.
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetResponse } from "@/lib/assets/serve";
import { getBrand, updateBrand, type Member } from "@/lib/brands/repo";
import { LOGO_MAX_SIDE, LogoError, PNG_MAX_BYTES, readLogoUpload, removeBrandLogo, uploadBrandLogo } from "@/lib/brands/logo-upload";
import { firstLayoutThatRenders, kitSnapshot } from "@/lib/creative/variants";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { createMember, truncateAll } from "../helpers/db";

let a: Member;
let b: Member;
let brand: string;

const SVG = '<svg viewBox="0 0 120 40"><rect id="https-badge" aria-label="data: chart" width="120" height="40" fill="#14213D"/><path d="M10 10h20v20H10z" fill="#F2C14E"/></svg>';

const logoPng = (width: number, height: number, opts: { exif?: boolean } = {}) => {
  const img = sharp({ create: { width, height, channels: 4, background: { r: 20, g: 33, b: 61, alpha: 1 } } });
  const withExif = opts.exif
    ? img.withExif({ IFD0: { Artist: "Secret Studio", ImageDescription: "taken at home" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 1234/100" } })
    : img;
  return withExif.png().toBuffer();
};

async function brandRow(id = brand) {
  const [r] = await asUser(a.userId, (tx) => tx`select logo_svg, logo_asset_id from public.brands where id = ${id}`);
  return r;
}
const assetCount = async () => (await asUser(a.userId, (tx) => tx`select count(*)::int as n from public.assets where kind = 'logo'`))[0].n as number;

describe("F-10 logo upload", () => {
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    b = await createMember();
    const [r] = await asUser(a.userId, (tx) => tx`
      insert into public.brands (workspace_id, name, slug, created_by, palette, font_primary, font_secondary, legal_lines)
      values (${a.workspaceId}, 'Inkwell Savings', 'inkwell', ${a.userId}, ${tx.json([{ name: "Ink", hex: "#14213D" }, { name: "Paper", hex: "#F7F5F0" }, { name: "Gold", hex: "#F2C14E" }])},
              'Georgia', 'Helvetica', ${["Capital at risk."]})
      returning id`);
    brand = r.id;
  });
  afterAll(closeSql);

  it("#1 and #3: an SVG with an https or data: id or label is accepted, stored sanitised with its namespace", async () => {
    const res = await uploadBrandLogo(a, brand, { name: "logo.svg", type: "image/svg+xml", bytes: Buffer.from(SVG) });
    expect(res.kind).toBe("svg");
    const row = await brandRow();
    expect(row.logo_asset_id).toBeNull();
    expect(row.logo_svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(row.logo_svg).toContain('id="https-badge"');
  });

  it("#4 a PNG with EXIF location data is stored without it, re-encoded and at most 1024 px on its longest side", async () => {
    const original = await logoPng(2000, 800, { exif: true });
    expect((await sharp(original).metadata()).exif).toBeDefined();
    expect(original.includes(Buffer.from("Secret Studio"))).toBe(true);

    const res = await uploadBrandLogo(a, brand, { name: "logo.png", type: "image/png", bytes: original });
    expect(res).toMatchObject({ kind: "png", width: LOGO_MAX_SIDE, height: 410 });
    const row = await brandRow();
    expect(row.logo_svg).toBeNull();
    const assetId = (res as { assetId: string }).assetId;
    expect(row.logo_asset_id).toBe(assetId);
    const [stored] = await asUser(a.userId, (tx) => tx`select kind, mime, width, height, bytes, brand_id, created_by_kind, simulated from public.assets where id = ${assetId}`);
    expect(stored).toMatchObject({ kind: "logo", mime: "image/png", width: 1024, height: 410, brand_id: brand, created_by_kind: "person", simulated: false });
    const meta = await sharp(stored.bytes as Buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.exif).toBeUndefined();
    expect((stored.bytes as Buffer).includes(Buffer.from("Secret Studio"))).toBe(false);
    expect((stored.bytes as Buffer).includes(Buffer.from("taken at home"))).toBe(false);
    // Served to its workspace only.
    expect((await assetResponse(a.userId, assetId)).status).toBe(200);
    expect((await assetResponse(b.userId, assetId)).status).toBe(404);
    expect((await getBrand(a.userId, brand))!.logoPngSrc).toBe(`/assets/${assetId}`);
  });

  it("a small PNG is not enlarged, and junk after its end is dropped by the re-encode", async () => {
    const polyglot = Buffer.concat([await logoPng(300, 100), Buffer.from("<script>alert(1)</script>")]);
    const read = await readLogoUpload({ name: "logo.png", bytes: polyglot });
    expect(read).toMatchObject({ kind: "png", width: 300, height: 100 });
    expect((read as { png: Buffer }).png.includes(Buffer.from("<script"))).toBe(false);
  });

  describe("#5 hostile files are refused with a reason, and nothing is stored", () => {
    const cases: [string, () => Promise<{ name: string; type?: string; bytes: Buffer }>, RegExp][] = [
      [
        "a 5 MB PNG",
        async () => {
          const noise = Buffer.alloc(1200 * 1200 * 4);
          for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
          const big = await sharp(noise, { raw: { width: 1200, height: 1200, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
          expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
          return { name: "big.png", type: "image/png", bytes: big };
        },
        /The PNG is too large \(1 MB at most\)/,
      ],
      ["a script named .png", async () => ({ name: "logo.png", type: "image/png", bytes: Buffer.from("<script>fetch('/api')</script>") }), /named \.png but isn't a PNG/],
      ["a shell script named .png", async () => ({ name: "logo.PNG", bytes: Buffer.from("#!/bin/sh\nrm -rf /\n") }), /named \.png but isn't a PNG/],
      ["an SVG with a script", async () => ({ name: "logo.svg", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>') }), /it contains a script/],
      ["an SVG with onload", async () => ({ name: "logo.svg", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>') }), /event handler \(such as onload\)/],
      ["an SVG that links a picture", async () => ({ name: "logo.svg", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/x.png"/></svg>') }), /embedded or linked picture/],
      ["an SVG that declares entities", async () => ({ name: "logo.svg", bytes: Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>') }), /declares XML entities/],
      ["a PNG named .svg", async () => ({ name: "logo.svg", bytes: await logoPng(10, 10) }), /named \.svg but is a PNG/],
      ["binary named .svg", async () => ({ name: "logo.svg", bytes: Buffer.from([0xff, 0xfe, 0x00, 0x81, 0x00]) }), /isn't text/],
      ["an empty file", async () => ({ name: "logo.png", bytes: Buffer.alloc(0) }), /The file is empty/],
      ["a JPEG", async () => ({ name: "logo.jpg", bytes: await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).jpeg().toBuffer() }), /as an SVG or a PNG/],
      [
        "a PNG that unpacks to too many pixels",
        async () => ({ name: "huge.png", bytes: await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer() }),
        /too many pixels/,
      ],
    ];
    for (const [label, file, reason] of cases) {
      it(label, async () => {
        const before = await brandRow();
        const assets = await assetCount();
        const err = await uploadBrandLogo(a, brand, await file()).catch((e) => e);
        expect(err).toBeInstanceOf(LogoError);
        expect((err as Error).message).toMatch(reason);
        expect(await brandRow()).toEqual(before);
        expect(await assetCount()).toBe(assets);
      }, 30_000);
    }
    it("the size limits are 1 MB for PNG", () => expect(PNG_MAX_BYTES).toBe(1_048_576));
  });

  it("the brand save path keeps the stored logo when none is uploaded (PNG or SVG)", async () => {
    const png = await uploadBrandLogo(a, brand, { name: "logo.png", bytes: await logoPng(200, 80) });
    const kit = await getBrand(a.userId, brand);
    const draft = { name: kit!.name, slug: kit!.slug, palette: kit!.palette, fontPrimary: kit!.fontPrimary, fontSecondary: kit!.fontSecondary, legalLines: kit!.legalLines, description: "Edited description" };
    expect(await updateBrand(a, brand, draft)).toBe(true);
    expect((await brandRow()).logo_asset_id).toBe((png as { assetId: string }).assetId);
    await uploadBrandLogo(a, brand, { name: "logo.svg", bytes: Buffer.from(SVG) });
    // The PNG it replaced stays in the store, discarded.
    const [old] = await asUser(a.userId, (tx) => tx`select discarded_at from public.assets where id = ${(png as { assetId: string }).assetId}`);
    expect(old.discarded_at).toBeInstanceOf(Date);
    expect(await updateBrand(a, brand, { ...draft, description: "Edited again" })).toBe(true);
    expect((await brandRow()).logo_svg).toContain("https-badge");
    expect((await getBrand(a.userId, brand))!.description).toBe("Edited again");
  });

  it("another workspace can't upload to or remove this brand's logo", async () => {
    const before = await brandRow();
    await expect(uploadBrandLogo(b, brand, { name: "logo.svg", bytes: Buffer.from(SVG) })).rejects.toThrow(/isn't in your workspace/);
    expect(await removeBrandLogo(b, brand)).toBe(false);
    await expect(uploadBrandLogo(a, "not-an-id", { name: "logo.svg", bytes: Buffer.from(SVG) })).rejects.toThrow(/isn't in your workspace/);
    expect(await brandRow()).toEqual(before);
  });

  it("a PNG logo is drawn in ads, and the kit snapshot names the asset", async () => {
    const res = await uploadBrandLogo(a, brand, { name: "logo.png", bytes: await logoPng(400, 120) });
    const kit = (await asUser(a.userId, (tx) => kitSnapshot(tx, brand)))!;
    expect(kit.logo).toMatchObject({ assetId: (res as { assetId: string }).assetId });
    const [l] = await asUser(a.userId, (tx) => tx`select bytes from public.assets where id = ${(res as { assetId: string }).assetId}`);
    const picture = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#6B9080" } }).png().toBuffer();
    const rendered = await firstLayoutThatRenders({
      picture: { png: picture, sha256: "x", simulated: false },
      copy: { headline: "See where your money goes", body: "Round up everyday spending into a pot.", cta: "Get the app" },
      legalLines: ["Capital at risk."],
      kit,
      logoPng: l.bytes as Buffer,
    });
    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(rendered.checks.logo).toBe("drawn");
    expect(await removeBrandLogo(a, brand)).toBe(true);
    expect(await brandRow()).toEqual({ logo_svg: null, logo_asset_id: null });
  });
});
