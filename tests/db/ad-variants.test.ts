// S5-3 and S5-4 (rule 7): ad_variants carry workspace_id with row-level
// security, attach only to parts of their own workspace and campaign, and are
// append-only except the marks and the layout (with its checks). F-10: a
// brand's PNG logo must be a logo asset of the same brand and workspace.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertImage, toWebp } from "@/lib/assets/store";
import { closeSql, getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { drawMockImage } from "@/lib/models/mock-image";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
type Fixture = { brand: string; campaign: string; image: string; set: string; emailSet: string; run: string };

const brief = { title: "T", summary: "s".repeat(20), story: "s".repeat(20), insights: [], audiences: [], channels: [], kpi: { metric: "reach" }, mustInclude: [], avoid: [] };
const checks = { layout: "full-bleed", legalLinePresent: true };
const kit = { brandName: "Brand", palette: [{ name: "Ink", hex: "#14213D" }], fontPrimary: "Georgia", fontSecondary: "Helvetica", logo: null };

let a: Member;
let b: Member;
let fa: Fixture;
let fb: Fixture;

async function fixture(m: Member, slug: string): Promise<Fixture> {
  const webp = await toWebp(await drawMockImage({ prompt: "test", palette: ["#14213D", "#F2C14E"] }));
  return asUser(m.userId, async (tx) => {
    const [br] = await tx`insert into public.brands (workspace_id, name, slug, created_by) values (${m.workspaceId}, 'Brand', ${slug}, ${m.userId}) returning id`;
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
      values (${m.workspaceId}, ${br.id}, 'Win back lapsed savers', ${m.userId}, 1) returning id`;
    await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
      values (${m.workspaceId}, ${c.id}, 1, ${tx.json(brief)}, 'agent', ${m.userId})`;
    const [r] = await tx`insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
      values (${m.workspaceId}, 'creative', 1, ${tx.json({ mode: "make", campaignId: c.id, version: 1 })}, ${m.userId}) returning id`;
    const image = await insertImage(tx, { workspaceId: m.workspaceId, userId: m.userId, brandId: br.id, campaignId: c.id, runId: null, webp, simulated: true, createdByKind: "agent", meta: { picture: 1, briefVersion: 1 } });
    const set = async (channel: string, copy: unknown) => {
      const [s] = await tx`
        insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_title, set, legal_lines, source, created_by)
        values (${m.workspaceId}, ${c.id}, 1, null, ${channel}, 'Everyone', ${tx.json(copy as never)}, ${["Capital at risk."]}, 'agent', ${m.userId})
        returning id`;
      return s.id as string;
    };
    return {
      brand: br.id,
      campaign: c.id,
      image,
      set: await set("paid social", { headline: "Hello", body: "A calm look at your money.", cta: "Get the app" }),
      emailSet: await set("email", { subject: "Hello", preview: "A calm look at your money." }),
      run: r.id,
    };
  });
}

const insertVariant = (m: Member, workspaceId: string, f: Partial<Fixture> & Pick<Fixture, "campaign" | "image" | "set">, layout = "full-bleed") =>
  asUser(m.userId, async (tx) => {
    const [v] = await tx`
      insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, run_id, created_by)
      values (${workspaceId}, ${f.campaign}, 1, ${f.image}, ${f.set}, ${layout}, ${tx.json(checks)}, ${tx.json(kit as never)}, 'composed', ${f.run ?? null}, ${m.userId})
      returning id`;
    return v.id as string;
  });

describe("ad_variants tenancy and rules", () => {
  let va: string;
  beforeAll(async () => {
    await truncateAll();
    a = await createMember();
    b = await createMember();
    fa = await fixture(a, "brand-a");
    fb = await fixture(b, "brand-b");
    va = await insertVariant(a, a.workspaceId, fa);
  });
  afterAll(closeSql);

  it("another workspace reads none, can't add one to this workspace, and can't point at this workspace's parts", async () => {
    expect(await asUser(a.userId, (tx) => tx`select id from public.ad_variants`)).toHaveLength(1);
    expect(await asUser(b.userId, (tx) => tx`select id from public.ad_variants`)).toHaveLength(0);
    // Refused by row-level security, or first by the parts check (B can't see A's picture, so it names no detail).
    await expect(insertVariant(b, a.workspaceId, fa)).rejects.toThrow(/row-level security|same campaign/);
    // In B's workspace but with A's campaign, picture, words or run: the (id, workspace_id) keys refuse it.
    await expect(insertVariant(b, b.workspaceId, { ...fb, campaign: fa.campaign })).rejects.toThrow(/foreign key|same campaign/);
    await expect(insertVariant(b, b.workspaceId, { ...fb, image: fa.image })).rejects.toThrow(/foreign key|same campaign/);
    await expect(insertVariant(b, b.workspaceId, { ...fb, set: fa.set })).rejects.toThrow(/foreign key|paid-social/);
    await expect(insertVariant(b, b.workspaceId, { ...fb, run: fa.run })).rejects.toThrow(/foreign key/);
    // B can't mark or change A's variant.
    expect((await asUser(b.userId, (tx) => tx`update public.ad_variants set picked_at = now() where id = ${va}`)).count).toBe(0);
    expect((await asUser(b.userId, (tx) => tx`update public.ad_variants set discarded_at = now() where id = ${va}`)).count).toBe(0);
  });

  it("a variant's words must be an ad set (paid social or display), and its picture an image of the same campaign", async () => {
    await expect(insertVariant(a, a.workspaceId, { ...fa, set: fa.emailSet })).rejects.toThrow(/paid-social or display set/);
    const other = await asUser(a.userId, async (tx) => {
      const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
        values (${a.workspaceId}, ${fa.brand}, 'Another objective here', ${a.userId}, 1) returning id`;
      await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
        values (${a.workspaceId}, ${c.id}, 1, ${tx.json(brief)}, 'agent', ${a.userId})`;
      return c.id as string;
    });
    await expect(insertVariant(a, a.workspaceId, { ...fa, campaign: other })).rejects.toThrow(/same campaign/);
    await expect(insertVariant(a, a.workspaceId, fa, "poster")).rejects.toThrow(/ad_variants_layout_check/);
  });

  it("one current variant per picture and words", async () => {
    await expect(insertVariant(a, a.workspaceId, fa)).rejects.toThrow(/ad_variants_current_once/);
  });

  it("is append-only: marks and the layout (with its checks) change; nothing else does, and nothing is deleted", async () => {
    await asUser(a.userId, (tx) => tx`update public.ad_variants set picked_at = now() where id = ${va}`);
    await asUser(a.userId, (tx) => tx`update public.ad_variants set layout = 'split', checks = ${tx.json({ ...checks, layout: "split" })} where id = ${va}`);
    // Checks change only with the layout (they are that layout's checks).
    await expect(asUser(a.userId, (tx) => tx`update public.ad_variants set checks = ${tx.json({ forged: true })} where id = ${va}`)).rejects.toThrow(/marks and layout/);
    await expect(asUser(a.userId, (tx) => tx`update public.ad_variants set kit = '{}'::jsonb where id = ${va}`)).rejects.toThrow();
    await expect(asUser(a.userId, (tx) => tx`update public.ad_variants set copy_set_id = ${fa.emailSet} where id = ${va}`)).rejects.toThrow();
    await expect(asUser(a.userId, (tx) => tx`delete from public.ad_variants where id = ${va}`)).rejects.toThrow();
    // Even the table owner can't rewrite a variant's parts (the guard trigger).
    await expect(getSql()`update public.ad_variants set image_asset_id = ${fb.image} where id = ${va}`).rejects.toThrow(/marks and layout/);
    await asUser(a.userId, (tx) => tx`update public.ad_variants set discarded_at = now() where id = ${va}`);
    await asUser(a.userId, (tx) => tx`update public.ad_variants set discarded_at = null where id = ${va}`);
  });

  it("a deleted run leaves its variants, without the run", async () => {
    const id = await asUser(a.userId, async (tx) => {
      const [s] = await tx`
        insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_title, set, source, created_by)
        values (${a.workspaceId}, ${fa.campaign}, 1, null, 'display', 'Everyone', ${tx.json({ headline: "Hi", body: "A calm look.", cta: "Go" })}, 'agent', ${a.userId})
        returning id`;
      return s.id as string;
    });
    const v = await insertVariant(a, a.workspaceId, { ...fa, set: id });
    await getSql()`delete from public.agent_runs where id = ${fa.run}`;
    const [row] = await asUser(a.userId, (tx) => tx`select run_id from public.ad_variants where id = ${v}`);
    expect(row.run_id).toBeNull();
  });

  it("the anonymous role sees nothing", async () => {
    const result = await getSql().begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select * from public.ad_variants`;
    }).catch((e: Error) => e);
    if (result instanceof Error) expect(result.message).toMatch(/permission denied/);
    else expect(result).toHaveLength(0);
  });
});

describe("F-10 brands.logo_asset_id", () => {
  async function logoAsset(m: Member, brandId: string, kind = "logo"): Promise<string> {
    return asUser(m.userId, async (tx) => {
      const [x] = await tx`
        insert into public.assets (workspace_id, kind, brand_id, mime, width, height, bytes, sha256, created_by, created_by_kind)
        values (${m.workspaceId}, ${kind}, ${brandId}, 'image/png', 1, 1, ${Buffer.from([1])}, ${"a".repeat(64)}, ${m.userId}, 'person')
        returning id`;
      return x.id as string;
    });
  }

  it("must be a PNG logo asset of the same brand, in the same workspace", async () => {
    const own = await logoAsset(a, fa.brand);
    await asUser(a.userId, (tx) => tx`update public.brands set logo_asset_id = ${own} where id = ${fa.brand}`);
    // An image (not a logo) is refused.
    const image = await logoAsset(a, fa.brand, "image");
    await expect(asUser(a.userId, (tx) => tx`update public.brands set logo_asset_id = ${image} where id = ${fa.brand}`)).rejects.toThrow(/PNG logo asset of the same brand/);
    // Another brand's logo in the same workspace is refused.
    const [other] = await asUser(a.userId, (tx) => tx`insert into public.brands (workspace_id, name, slug, created_by) values (${a.workspaceId}, 'Other', 'other-a', ${a.userId}) returning id`);
    const theirs = await logoAsset(a, other.id);
    await expect(asUser(a.userId, (tx) => tx`update public.brands set logo_asset_id = ${theirs} where id = ${fa.brand}`)).rejects.toThrow(/same brand/);
    // Another workspace's logo: the composite key refuses it.
    const foreign = await logoAsset(b, fb.brand);
    await expect(asUser(a.userId, (tx) => tx`update public.brands set logo_asset_id = ${foreign} where id = ${fa.brand}`)).rejects.toThrow(/foreign key|same brand/);
    const [kept] = await asUser(a.userId, (tx) => tx`select logo_asset_id from public.brands where id = ${fa.brand}`);
    expect(kept.logo_asset_id).toBe(own);
  });

  it("deleting a brand removes its logo asset too", async () => {
    const [br] = await asUser(a.userId, (tx) => tx`insert into public.brands (workspace_id, name, slug, created_by) values (${a.workspaceId}, 'Gone', 'gone-a', ${a.userId}) returning id`);
    const logo = await logoAsset(a, br.id);
    await asUser(a.userId, (tx) => tx`update public.brands set logo_asset_id = ${logo} where id = ${br.id}`);
    await asUser(a.userId, (tx) => tx`delete from public.brands where id = ${br.id}`);
    expect(await asUser(a.userId, (tx) => tx`select id from public.assets where id = ${logo}`)).toHaveLength(0);
  });
});
