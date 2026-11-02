// C7-1 Sizes through /ads/<id>/<size>.png and the Sizes view (rule 7): test
// cases 1, 2, 4, 5 and 8 as served, and 7 (hostile): an unknown size, a size
// from the other channel, another workspace's ad, a signed-out request and a
// malformed id are all the same 404, in every size.
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertImage, toWebp } from "@/lib/assets/store";
import { adResponse, adSizeResponse, clearAdCache } from "@/lib/creative/ad-serve";
import { adSizes, clearSizeCache } from "@/lib/creative/ad-sizes";
import { SIZE_IDS, SIZES, sizesFor } from "@/lib/creative/render/sizes";
import { adEtag, type KitSnapshot } from "@/lib/creative/variants";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { FERNHOLLOW, QUILLMOOR } from "@/lib/demo/briefs";
import { drawMockImage } from "@/lib/models/mock-image";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };

const brief = { title: "T", summary: "s".repeat(20), story: "s".repeat(20), insights: [], audiences: [], channels: [], kpi: { metric: "reach" }, mustInclude: [], avoid: [] };

const kitOf = (b: typeof QUILLMOOR): KitSnapshot => ({ brandName: b.kit.name, palette: b.kit.palette, fontPrimary: b.kit.fontPrimary, fontSecondary: b.kit.fontSecondary, logo: { svg: b.kit.logoSvg } });

let a: Member;
let b: Member;
/** Ad ids: paid social (Quillmoor, simulated 1K picture), display (Fernhollow; Quillmoor's legal lines), and one on a 2K picture. */
let ids: { social: string; display: string; displayQuill: string; social2k: string; otherSocial: string };

async function campaignWithAds(m: Member, slug: string) {
  const oneK = await toWebp(await drawMockImage({ prompt: "sizes", palette: QUILLMOOR.kit.palette.map((p) => p.hex) }));
  const twoK = await toWebp(await drawMockImage({ prompt: "sizes", palette: QUILLMOOR.kit.palette.map((p) => p.hex), size: "2K" }));
  return asUser(m.userId, async (tx) => {
    const [br] = await tx`insert into public.brands (workspace_id, name, slug, created_by) values (${m.workspaceId}, 'Brand', ${slug}, ${m.userId}) returning id`;
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
      values (${m.workspaceId}, ${br.id}, 'Win back lapsed savers', ${m.userId}, 1) returning id`;
    await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${m.workspaceId}, ${c.id}, 1, ${tx.json(brief)}, 'agent', ${m.userId})`;
    const image = (webp: typeof oneK, simulated: boolean) =>
      insertImage(tx, { workspaceId: m.workspaceId, userId: m.userId, brandId: br.id, campaignId: c.id, runId: null, webp, simulated, createdByKind: "agent", meta: { picture: 1, briefVersion: 1 } });
    const set = async (channel: string, copy: unknown, legal: string[]) => {
      const [s] = await tx`
        insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_title, set, legal_lines, source, created_by)
        values (${m.workspaceId}, ${c.id}, 1, null, ${channel}, 'Everyone', ${tx.json(copy as never)}, ${legal}, 'agent', ${m.userId})
        returning id`;
      return s.id as string;
    };
    const variant = async (img: string, setId: string, layout: string, kit: KitSnapshot) => {
      const [v] = await tx`
        insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by)
        values (${m.workspaceId}, ${c.id}, 1, ${img}, ${setId}, ${layout}, ${tx.json({ layout })}, ${tx.json(kit as never)}, 'composed', ${m.userId})
        returning id`;
      return v.id as string;
    };
    const sim1k = await image(oneK, true);
    const real2k = await image(twoK, false);
    const quillWords = { headline: "See where your money goes", body: "Round up everyday spending into a savings pot, and watch it grow a little each week.", cta: "Get the app" };
    const fernWords = { headline: "Made for the long way round", body: "A three-layer shell for wet days on high ground.", cta: "Shop jackets" };
    const social = await set("paid social", quillWords, QUILLMOOR.kit.legalLines);
    const display = await set("display", fernWords, FERNHOLLOW.kit.legalLines);
    const displayQuill = await set("display", quillWords, QUILLMOOR.kit.legalLines);
    return {
      social: await variant(sim1k, social, "full-bleed", kitOf(QUILLMOOR)),
      display: await variant(sim1k, display, "split", kitOf(FERNHOLLOW)),
      displayQuill: await variant(real2k, displayQuill, "full-bleed", kitOf(QUILLMOOR)),
      social2k: await variant(real2k, social, "card", kitOf(QUILLMOOR)),
    };
  });
}

async function png(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  return sharp(buf).metadata();
}

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  const mine = await campaignWithAds(a, "brand-a");
  const theirs = await campaignWithAds(b, "brand-b");
  ids = { ...mine, otherSocial: theirs.social };
});
beforeEach(() => {
  clearAdCache();
  clearSizeCache();
});
afterAll(closeSql);

describe("C7-1 /ads/<id>/<size>.png", () => {
  it("#1 a paid-social ad is served in each social size, each with its own ETag (the square's is the ad's own)", async () => {
    const square = await adResponse(a.userId, `${ids.social}.png`);
    const etags = new Set<string>();
    for (const size of sizesFor("paid social")) {
      const res = await adSizeResponse(a.userId, ids.social, `${size.id}.png`);
      expect(res.status, size.id).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe("private, no-cache");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      const meta = await png(res);
      expect([meta.width, meta.height]).toEqual([size.width, size.height]);
      etags.add(res.headers.get("etag")!);
      // A matching If-None-Match is a 304 without a drawing.
      const again = await adSizeResponse(a.userId, ids.social, size.id, res.headers.get("etag"));
      expect(again.status).toBe(304);
    }
    expect(etags.size).toBe(4);
    expect(etags.has(square.headers.get("etag")!)).toBe(true);
    // The size is part of the ETag.
    const [img] = await getSql()`select a.sha256, v.copy_set_id, v.kit from public.ad_variants v join public.assets a on a.id = v.image_asset_id where v.id = ${ids.social}`;
    const parts = { imageSha256: img.sha256 as string, copySetId: img.copy_set_id as string, layout: "full-bleed", kit: img.kit as KitSnapshot, simulated: true };
    expect(etags.has(adEtag({ ...parts, size: "1080x1920" }))).toBe(true);
    expect(adEtag({ ...parts, size: "1080x1080" })).toBe(adEtag(parts));
  });

  it("#1 the square through the size route is the same drawing as /ads/<id>.png", async () => {
    const one = Buffer.from(await (await adResponse(a.userId, ids.social)).arrayBuffer());
    const two = Buffer.from(await (await adSizeResponse(a.userId, ids.social, "1080x1080.png")).arrayBuffer());
    expect(two.equals(one)).toBe(true);
  });

  it("#2 a display ad is served in the three banner sizes", async () => {
    for (const size of sizesFor("display")) {
      const res = await adSizeResponse(a.userId, ids.display, `${size.id}.png`);
      expect(res.status, size.id).toBe(200);
      const meta = await png(res);
      expect([meta.width, meta.height]).toEqual([size.width, size.height]);
    }
  });

  it("#4 a size the legal lines don't fit is a 422 with the reason; the other sizes still render", async () => {
    const res = await adSizeResponse(a.userId, ids.displayQuill, "728x90.png");
    expect(res.status).toBe(422);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toBe("This size can't be drawn: the legal lines don't fit a 728 × 90 leaderboard at a readable size.");
    for (const size of ["300x250", "300x600"]) expect((await adSizeResponse(a.userId, ids.displayQuill, `${size}.png`)).status).toBe(200);
  });

  it("#7 hostile: unknown sizes, the other channel's sizes, another workspace's ad, no session and malformed ids are all 404", async () => {
    const notFound = async (who: string | null, id: string, size: string) => {
      const r = await adSizeResponse(who, id, size);
      expect(r.status, `${who} ${id} ${size}`).toBe(404);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(r.headers.get("etag")).toBeNull();
    };
    for (const size of ["640x480.png", "1080x1081.png", "728x90.gif", "", "..%2F..%2Fetc%2Fpasswd", "%E0%A4%A", "1080X1080.PNG ", "728x90.png.png"]) await notFound(a.userId, ids.social, size);
    // A size from the other channel.
    for (const size of sizesFor("display")) await notFound(a.userId, ids.social, `${size.id}.png`);
    for (const size of sizesFor("paid social")) await notFound(a.userId, ids.display, `${size.id}.png`);
    // Another workspace's ad, and no session, in every size.
    for (const size of SIZE_IDS) {
      await notFound(b.userId, ids.social, `${size}.png`);
      await notFound(b.userId, ids.display, `${size}.png`);
      await notFound(a.userId, ids.otherSocial, `${size}.png`);
      await notFound(null, ids.social, `${size}.png`);
    }
    for (const id of ["not-an-id", `${ids.social}x`, "00000000-0000-0000-0000-000000000000", "1' or '1'='1"]) await notFound(a.userId, id, "1080x1350.png");
    // And their own ad answers in B's workspace, so the 404s above are about access, not the drawing.
    expect((await adSizeResponse(b.userId, ids.otherSocial, "1080x1350.png")).status).toBe(200);
  });

  it("#7 a discarded ad, or one whose picture was discarded, is a 404 in every size", async () => {
    await asUser(a.userId, (tx) => tx`update public.ad_variants set discarded_at = now() where id = ${ids.social}`);
    try {
      // A discarded ad is still drawable while its parts are current (as /ads/<id> is); its picture discarded is not.
      const [v] = await getSql()`select image_asset_id from public.ad_variants where id = ${ids.display}`;
      await asUser(a.userId, (tx) => tx`update public.assets set discarded_at = now() where id = ${v.image_asset_id}`);
      for (const size of sizesFor("display")) expect((await adSizeResponse(a.userId, ids.display, size.id)).status).toBe(404);
      for (const size of sizesFor("paid social")) expect((await adSizeResponse(a.userId, ids.social, size.id)).status).toBe(404);
      await asUser(a.userId, (tx) => tx`update public.assets set discarded_at = null where id = ${v.image_asset_id}`);
    } finally {
      await asUser(a.userId, (tx) => tx`update public.ad_variants set discarded_at = null where id = ${ids.social}`);
    }
  });
});

describe("C7-1 the Sizes view", () => {
  it("lists every size of the channel with its badges, or the refusal reason (#4), and nothing for another workspace", async () => {
    const view = (await adSizes(a.userId, ids.displayQuill))!;
    expect(view.sizes.map((s) => s.size)).toEqual(["300x250", "300x600", "728x90"]);
    const leaderboard = view.sizes.find((s) => s.size === "728x90")!;
    expect(leaderboard).toMatchObject({ ok: false, reason: "The legal lines don't fit a 728 × 90 leaderboard at a readable size.", src: `/ads/${ids.displayQuill}/728x90.png` });
    const half = view.sizes.find((s) => s.size === "300x600")!;
    if (!half.ok) throw new Error(half.reason);
    expect(half.badges.map((x) => x.key)).toEqual(["contrast", "fit", "legal"]);
    expect(half.layoutName).toBe("Banner");
    expect(await adSizes(b.userId, ids.displayQuill)).toBeNull();
    expect(await adSizes(a.userId, "not-an-id")).toBeNull();
  });

  it("#5 and #8: a simulated 1K picture is labelled in every size, and noted as upscaled where it is enlarged", async () => {
    const view = (await adSizes(a.userId, ids.social))!;
    expect(view.sizes.map((s) => s.size)).toEqual(["1080x1080", "1080x1350", "1080x1920", "1200x628"]);
    for (const s of view.sizes) {
      if (!s.ok) throw new Error(`${s.size}: ${s.reason}`);
      expect(s.badges.some((x) => x.key === "simulated"), s.size).toBe(true);
      expect(s.layout).toBe("full-bleed");
    }
    const upscaled = Object.fromEntries(view.sizes.map((s) => [s.size, s.ok && s.badges.find((x) => x.key === "upscaled")?.label]));
    expect(upscaled).toEqual({ "1080x1080": undefined, "1080x1350": "Upscaled from a 1K picture", "1080x1920": "Upscaled from a 1K picture", "1200x628": "Upscaled from a 1K picture" });
    // A 2K picture is never enlarged, and a real picture carries no simulated badge.
    const twoK = (await adSizes(a.userId, ids.social2k))!;
    for (const s of twoK.sizes) {
      if (!s.ok) throw new Error(`${s.size}: ${s.reason}`);
      expect(s.badges.map((x) => x.key)).not.toContain("upscaled");
      expect(s.badges.map((x) => x.key)).not.toContain("simulated");
    }
  });

  it("the thumbnails it lists are answered from the drawings it made (one drawing per size)", async () => {
    const view = (await adSizes(a.userId, ids.social))!;
    const started = performance.now();
    for (const s of view.sizes) expect((await adSizeResponse(a.userId, ids.social, `${s.size}.png`)).status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(SIZES["1080x1920"].height).toBe(1920);
  });
});
