// C7-1 (Q1): pictures are drawn at 2K from Sprint 7. A stored picture must fit
// the assets table (bytes at most 2 MB, width and height at most 4096): a 2K
// WebP at quality 82 does for the mock and for a photo-like picture; a
// picture that doesn't (heavy grain, or noise) is stored at a lower quality,
// then smaller, rather than refused after it was paid for.
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSET_MAX_BYTES, insertImage, toWebp, WEBP_QUALITY } from "@/lib/assets/store";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { drawMockImage } from "@/lib/models/mock-image";
import { createMember, truncateAll } from "../helpers/db";

/** A 2048 × 2048 test picture: soft colour waves (like a photo's tones) with grain of the given strength, or pure noise. */
async function testPicture(grain: number, waves = true): Promise<Buffer> {
  const size = 2048;
  const raw = Buffer.alloc(size * size * 3);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) {
        const base = waves ? 128 + 90 * Math.sin((x + c * 300) / 170) * Math.cos(y / 230) : 128;
        raw[i + c] = Math.max(0, Math.min(255, Math.round(base + (rnd() - 0.5) * grain)));
      }
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

describe("C7-1 (Q1): 2K pictures fit the assets table", () => {
  let m: { userId: string; workspaceId: string };
  let brand: string;
  beforeAll(async () => {
    await truncateAll();
    m = await createMember();
    brand = await asUser(m.userId, async (tx) => {
      const [b] = await tx`insert into public.brands (workspace_id, name, slug, created_by) values (${m.workspaceId}, 'Brand', 'brand-2k', ${m.userId}) returning id`;
      return b.id as string;
    });
  });
  afterAll(closeSql);

  const store = (webp: Awaited<ReturnType<typeof toWebp>>) =>
    asUser(m.userId, (tx) => insertImage(tx, { workspaceId: m.workspaceId, userId: m.userId, brandId: brand, campaignId: null, runId: null, webp, simulated: true, createdByKind: "agent", meta: {} }));

  it("the mock's 2K picture is 2048 × 2048 and stores at quality 82, far under 2 MB", async () => {
    const png = await drawMockImage({ prompt: "2k", palette: ["#14213D", "#F2C14E", "#6B9080"], size: "2K" });
    expect(await sharp(png).metadata()).toMatchObject({ width: 2048, height: 2048 });
    const webp = await toWebp(png);
    expect(webp).toMatchObject({ width: 2048, height: 2048, quality: WEBP_QUALITY });
    expect(webp.data.length).toBeLessThan(ASSET_MAX_BYTES / 10);
    expect(await store(webp)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a photo-like 2K picture stores at quality 82, whole, under 2 MB", async () => {
    const webp = await toWebp(await testPicture(40));
    expect(webp).toMatchObject({ width: 2048, height: 2048, quality: WEBP_QUALITY });
    expect(webp.data.length).toBeLessThanOrEqual(ASSET_MAX_BYTES);
    expect(await store(webp)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a grainy 2K picture over 2 MB at quality 82 is stored at a lower quality, still 2048 × 2048", async () => {
    const png = await testPicture(120);
    expect((await sharp(png).webp({ quality: WEBP_QUALITY }).toBuffer()).length).toBeGreaterThan(ASSET_MAX_BYTES);
    const webp = await toWebp(png);
    expect(webp.width).toBe(2048);
    expect(webp.quality).toBeLessThan(WEBP_QUALITY);
    expect(webp.data.length).toBeLessThanOrEqual(ASSET_MAX_BYTES);
    expect(await store(webp)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("noise that no quality fits is stored smaller, never refused", async () => {
    const webp = await toWebp(await testPicture(255, false));
    expect(webp.width).toBeLessThan(2048);
    expect(webp.data.length).toBeLessThanOrEqual(ASSET_MAX_BYTES);
    expect(await store(webp)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("the table itself still refuses more than 2 MB", async () => {
    const big = { data: Buffer.alloc(ASSET_MAX_BYTES + 1, 1), width: 2048, height: 2048 };
    await expect(store(big as Awaited<ReturnType<typeof toWebp>>)).rejects.toThrow(/check constraint/);
  });
});
