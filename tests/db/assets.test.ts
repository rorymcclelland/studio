// S5-1 test case 7 and the asset store's rules: another workspace can't read
// an asset by id (404 from /assets/[id]) or list it; assets are append-only
// except the discarded mark; children can't attach across workspaces.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assetResponse } from "@/lib/assets/serve";
import { insertImage, listAssets, readAsset, setDiscarded, toWebp } from "@/lib/assets/store";
import { closeSql, getSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { drawMockImage } from "@/lib/models/mock-image";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };

async function brandFor(m: Member, slug = "test-brand"): Promise<string> {
  const [b] = await asUser(m.userId, (tx) => tx`
    insert into public.brands (workspace_id, name, slug, created_by) values (${m.workspaceId}, 'Test Brand', ${slug}, ${m.userId}) returning id`);
  return b.id as string;
}

async function storeOne(m: Member, brandId: string, campaignId: string | null = null): Promise<string> {
  const webp = await toWebp(await drawMockImage({ prompt: "test", palette: ["#14213D", "#F2C14E"] }));
  return asUser(m.userId, (tx) =>
    insertImage(tx, { workspaceId: m.workspaceId, userId: m.userId, brandId, campaignId, runId: null, webp, simulated: true, createdByKind: "agent", meta: { picture: 1 } }),
  );
}

describe("S5-1 asset store", () => {
  let a: Member;
  let b: Member;
  let brandA: string;
  beforeEach(async () => {
    await truncateAll();
    a = await createMember();
    b = await createMember();
    brandA = await brandFor(a);
  });
  afterAll(closeSql);

  it("#7 another workspace can't read an asset by id (404 from /assets/[id]) or list it", async () => {
    const id = await storeOne(a, brandA);

    const mine = await assetResponse(a.userId, id);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/webp");
    expect(mine.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(mine.headers.get("x-content-type-options")).toBe("nosniff");
    const body = Buffer.from(await mine.arrayBuffer());
    expect((await sharp(body).metadata()).format).toBe("webp");
    expect(mine.headers.get("etag")).toBe(`"${createHash("sha256").update(body).digest("hex")}"`);

    for (const [who, asked] of [[b.userId, id], [null, id], [a.userId, "not-an-id"], [a.userId, `${id}x`], [a.userId, "00000000-0000-0000-0000-000000000000"]] as const) {
      const res = await assetResponse(who, asked);
      expect(res.status, `${who} ${asked}`).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.text()).toBe("Not found");
    }
    expect(await readAsset(b.userId, id)).toBeNull();
    expect(await listAssets(b.userId)).toEqual([]);
    expect((await listAssets(a.userId)).map((x) => x.id)).toEqual([id]);
    expect(await asUser(b.userId, (tx) => tx`select 1 from public.assets`)).toHaveLength(0);
  });

  it("another workspace can't add an asset to a workspace, attach one to its brand or campaign, or mark one discarded", async () => {
    const id = await storeOne(a, brandA);
    const brandB = await brandFor(b, "b-brand");
    const webp = await toWebp(await drawMockImage({ prompt: "x" }));
    const row = (m: Member, brandId: string, workspaceId = m.workspaceId) => (tx: Parameters<Parameters<typeof asUser>[1]>[0]) =>
      insertImage(tx, { workspaceId, userId: m.userId, brandId, campaignId: null, runId: null, webp, simulated: true, createdByKind: "agent", meta: {} });
    await expect(asUser(b.userId, row(b, brandA, a.workspaceId))).rejects.toThrow(/row-level security/);
    await expect(asUser(b.userId, row(b, brandA))).rejects.toThrow(/foreign key/);
    await expect(asUser(a.userId, row(a, brandB))).rejects.toThrow(/foreign key/);
    expect(await setDiscarded(b.userId, id, true)).toBe(false);
    expect((await listAssets(a.userId)).map((x) => x.discardedAt)).toEqual([null]);
  });

  it("an asset is append-only: only the discarded mark changes, and it can be undone", async () => {
    const id = await storeOne(a, brandA);
    expect(await setDiscarded(a.userId, id, true)).toBe(true);
    expect(await listAssets(a.userId)).toEqual([]);
    expect((await listAssets(a.userId, { includeDiscarded: true }))[0].discardedAt).toBeInstanceOf(Date);
    // A discarded picture is still served (the trail and the "Discarded" list show it).
    expect((await assetResponse(a.userId, id)).status).toBe(200);
    expect(await setDiscarded(a.userId, id, false)).toBe(true);
    expect(await listAssets(a.userId)).toHaveLength(1);

    await expect(asUser(a.userId, (tx) => tx`update public.assets set simulated = false where id = ${id}`)).rejects.toThrow(/permission denied/);
    await expect(asUser(a.userId, (tx) => tx`update public.assets set bytes = '\\x00' where id = ${id}`)).rejects.toThrow(/permission denied/);
    await expect(asUser(a.userId, (tx) => tx`delete from public.assets where id = ${id}`)).rejects.toThrow(/permission denied/);
    // Even with full privileges, the guard refuses any change but the mark.
    await expect(getSql()`update public.assets set sha256 = ${"0".repeat(64)} where id = ${id}`).rejects.toThrow(/only marked discarded/);
    await expect(getSql()`update public.assets set meta = '{"picture": 2}' where id = ${id}`).rejects.toThrow(/only marked discarded/);
  });

  it("a deleted run leaves its pictures, unlinked; the anonymous role reads nothing", async () => {
    const [run] = await asUser(a.userId, (tx) => tx`
      insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by) values (${a.workspaceId}, 'imagery', 1, '{}', ${a.userId}) returning id`);
    const webp = await toWebp(await drawMockImage({ prompt: "y" }));
    const id = await asUser(a.userId, (tx) =>
      insertImage(tx, { workspaceId: a.workspaceId, userId: a.userId, brandId: brandA, campaignId: null, runId: run.id, webp, simulated: true, createdByKind: "agent", meta: {} }),
    );
    await getSql()`delete from public.agent_runs where id = ${run.id}`;
    expect((await listAssets(a.userId))[0]).toMatchObject({ id, runId: null });
    const res = await asAnon((tx) => tx`select 1 from public.assets`).catch((e: Error) => e);
    if (res instanceof Error) expect(res.message).toMatch(/permission denied/);
    else expect(res).toHaveLength(0);
  });

  it("the database refuses what isn't a stored picture", async () => {
    const sql = getSql();
    const bad = (over: string) =>
      sql.unsafe(`insert into public.assets (workspace_id, kind, brand_id, mime, width, height, bytes, sha256, created_by, created_by_kind)
        values ('${a.workspaceId}', ${over}, '${a.userId}', 'agent')`);
    await expect(bad(`'image', '${brandA}', 'image/svg+xml', 10, 10, '\\x01', '${"a".repeat(64)}'`)).rejects.toThrow(/check constraint/);
    await expect(bad(`'video', '${brandA}', 'image/webp', 10, 10, '\\x01', '${"a".repeat(64)}'`)).rejects.toThrow(/check constraint/);
    await expect(bad(`'image', '${brandA}', 'image/webp', 10, 10, '\\x01', 'nothex'`)).rejects.toThrow(/check constraint/);
  });
});
