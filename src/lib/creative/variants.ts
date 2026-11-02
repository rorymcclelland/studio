import { createHash } from "node:crypto";
import sharp from "sharp";
import { storedBrief } from "@/lib/brief/schema";
import { asUser, type Tx } from "@/lib/db/scoped";
import type { PaletteColour } from "./render/colour";
import { LAYOUT_IDS, LAYOUT_SPECS, type LayoutId } from "./render/layouts";
import { renderAd, type RenderChecks, type RenderInput } from "./render/render";
import { SQUARE, type SizeId } from "./render/sizes";

// S5-3 and S5-4: ad variants. A variant is one picture, one paid-social (or
// display) copy set and one layout, drawn in code by renderAd (rule 8). The
// PNG is drawn when it is asked for (/ads/[id]); the row keeps the checks the
// renderer made and a snapshot of the kit, so an ad already made looks the
// same tomorrow even if the brand's palette or logo changes.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bump when the renderer's output changes, so browsers fetch the new drawing (it is part of the ETag). */
export const RENDER_VERSION = 2; // 2: the "Simulated image" label (review finding 3)

/** The channels whose copy is composed into ads; search, email and app push stay text (shown beside the gallery). */
export const AD_CHANNELS = ["paid social", "display"] as const;
export type AdChannel = (typeof AD_CHANNELS)[number];

/** The order layouts are tried in: the first that renders is used. */
export const LAYOUT_ORDER: readonly LayoutId[] = ["full-bleed", "split", "card"];

export type KitSnapshot = {
  brandName: string;
  palette: PaletteColour[];
  fontPrimary: string;
  fontSecondary: string;
  /** The SVG logo's text, or the PNG logo asset (assets never change, so the id is enough), or none. */
  logo: { svg: string } | { assetId: string; sha256: string } | null;
};

export type AdWords = { headline: string; body: string; cta: string };

/** Everything renderAd needs for one variant, except the layout. */
export type VariantParts = {
  /** `simulated`: the mock image model drew it, so the ad is labelled "Simulated image" (rule 1). */
  picture: { png: Buffer; sha256: string; simulated: boolean };
  copy: AdWords;
  legalLines: string[];
  kit: KitSnapshot;
  logoPng: Buffer | null;
};

export type LayoutAttempt = { layout: LayoutId; refused: string };
export type Rendered = { ok: true; layout: LayoutId; checks: RenderChecks; png: Buffer; tried: LayoutAttempt[] } | { ok: false; tried: LayoutAttempt[] };

/** The brand's kit as it is now, for a new variant. A PNG logo asset wins over the SVG (a brand has one or the other). */
export async function kitSnapshot(tx: Tx, brandId: string): Promise<KitSnapshot | null> {
  const [b] = await tx`
    select b.name, b.palette, b.font_primary, b.font_secondary, b.logo_svg, b.logo_asset_id, a.sha256 as logo_sha256
    from public.brands b left join public.assets a on a.id = b.logo_asset_id
    where b.id = ${brandId}`;
  if (!b) return null;
  const palette = ((b.palette ?? []) as PaletteColour[]).filter((p) => /^#[0-9a-f]{6}$/i.test(p.hex));
  return {
    brandName: b.name as string,
    palette,
    fontPrimary: (b.font_primary as string) ?? "",
    fontSecondary: (b.font_secondary as string) ?? "",
    logo: b.logo_asset_id && b.logo_sha256
      ? { assetId: b.logo_asset_id as string, sha256: b.logo_sha256 as string }
      : b.logo_svg
        ? { svg: b.logo_svg as string }
        : null,
  };
}

/** renderAd takes PNG or JPEG; pictures are stored as WebP (S5-1), so they are converted here. */
export async function pictureToPng(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).png({ compressionLevel: 3 }).toBuffer();
}

async function logoBytes(tx: Tx, kit: KitSnapshot): Promise<Buffer | null> {
  if (!kit.logo || !("assetId" in kit.logo)) return null;
  const [l] = await tx`select bytes from public.assets where id = ${kit.logo.assetId}`;
  return l ? (l.bytes as Buffer) : null;
}

export function renderInputFor(parts: VariantParts, layout: LayoutId): RenderInput {
  const logo = parts.kit.logo && "svg" in parts.kit.logo ? { svg: parts.kit.logo.svg } : parts.logoPng ? { png: parts.logoPng } : null;
  return {
    layout,
    image: { bytes: parts.picture.png, mime: "image/png" },
    copy: parts.copy,
    legalLines: parts.legalLines,
    logo,
    palette: parts.kit.palette,
    fontPrimary: parts.kit.fontPrimary,
    fontSecondary: parts.kit.fontSecondary,
    brandName: parts.kit.brandName,
    simulated: parts.picture.simulated,
  };
}

/** Tries the layouts in order (the preferred one first) and returns the first that renders, with every refusal on the way. */
export async function firstLayoutThatRenders(parts: VariantParts, prefer?: LayoutId): Promise<Rendered> {
  const order = prefer ? [prefer, ...LAYOUT_ORDER.filter((l) => l !== prefer)] : [...LAYOUT_ORDER];
  const tried: LayoutAttempt[] = [];
  for (const layout of order) {
    const r = await renderAd(renderInputFor(parts, layout));
    if ("refused" in r) {
      tried.push({ layout, refused: r.refused });
      continue;
    }
    return { ok: true, layout, checks: r.checks, png: r.png, tried };
  }
  return { ok: false, tried };
}

/** A plain sentence for refusals in every layout ("headline too long for Full bleed; ..."). */
export function refusalText(tried: LayoutAttempt[]): string {
  return tried.map((t) => t.refused).join("; ");
}

/** The words of an ad copy set, or null if the set isn't an ad's. */
export function adWords(channel: string, set: unknown): AdWords | null {
  if (!(AD_CHANNELS as readonly string[]).includes(channel)) return null;
  const s = set as Partial<AdWords>;
  if (typeof s?.headline !== "string" || typeof s.body !== "string" || typeof s.cta !== "string") return null;
  return { headline: s.headline, body: s.body, cta: s.cta };
}

export function kitHash(kit: KitSnapshot): string {
  return createHash("sha256").update(JSON.stringify(kit)).digest("hex");
}

/** Bump when a size other than the square draws differently (C7-1); the square's ETag doesn't include it. */
export const SIZES_VERSION = 1;

export type EtagParts = { imageSha256: string; copySetId: string; layout: string; kit: KitSnapshot; simulated: boolean };

/**
 * The ETag of a drawn ad: the renderer's version and its parts' hashes (assets
 * and copy sets never change, so their ids and hashes are enough). C7-1: a
 * size other than the 1080 square adds the size, so each size revalidates on
 * its own; the square's is unchanged (it is the same drawing as before sizes).
 */
export function adEtag(p: EtagParts & { size?: SizeId }): string {
  const sized = p.size && p.size !== SQUARE ? [`size:${p.size}`, `sizes:${SIZES_VERSION}`] : [];
  const h = createHash("sha256")
    .update([RENDER_VERSION, p.imageSha256, p.copySetId, p.layout, kitHash(p.kit), p.simulated ? "simulated" : "real", ...sized].join("|"))
    .digest("hex")
    .slice(0, 40);
  return `"ad-${h}"`;
}

/** Loads a picture (as PNG) and a set's words into parts, inside a transaction the caller holds. */
export async function loadParts(
  tx: Tx,
  imageAssetId: string,
  copySetId: string,
  kit: KitSnapshot,
  override?: { words: AdWords; legalLines: string[] },
): Promise<VariantParts | null> {
  const [img] = await tx`select bytes, sha256, simulated from public.assets where id = ${imageAssetId} and kind = 'image'`;
  const [cs] = await tx`select channel, set, legal_lines from public.copy_sets where id = ${copySetId}`;
  if (!img || !cs) return null;
  const words = override?.words ?? adWords(cs.channel as string, cs.set);
  if (!words) return null;
  return {
    picture: { png: await pictureToPng(img.bytes as Buffer), sha256: img.sha256 as string, simulated: img.simulated === true },
    copy: words,
    legalLines: override?.legalLines ?? (cs.legal_lines as string[]),
    kit,
    logoPng: await logoBytes(tx, kit),
  };
}

export type NewVariant = {
  workspaceId: string;
  userId: string;
  campaignId: string;
  briefVersion: number;
  imageAssetId: string;
  copySetId: string;
  layout: LayoutId;
  checks: RenderChecks;
  kit: KitSnapshot;
  origin: "composed" | "new picture" | "new words" | "edited words";
  runId: string | null;
  basedOn: string | null;
  /** A replacement keeps the shortlist mark of the ad it replaces (the person changed part of an ad they picked). */
  pickedAt?: Date | null;
};

/** Stores a variant in a transaction the caller holds; returns its id, or null if the same picture and words are already a current variant. */
export async function insertVariant(tx: Tx, v: NewVariant): Promise<string | null> {
  const [row] = await tx`
    insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, run_id, based_on, picked_at, created_by, created_at)
    values (${v.workspaceId}, ${v.campaignId}, ${v.briefVersion}, ${v.imageAssetId}, ${v.copySetId}, ${v.layout},
            ${tx.json(v.checks as never)}, ${tx.json(v.kit as never)}, ${v.origin}, ${v.runId}, ${v.basedOn}, ${v.pickedAt ?? null}, ${v.userId}, clock_timestamp())
    on conflict (image_asset_id, copy_set_id) where discarded_at is null do nothing
    returning id`;
  return row ? (row.id as string) : null;
}

export type ComposeResult = {
  /** Variants made, in gallery order (by picture, then words). */
  made: { id: string; imageAssetId: string; copySetId: string; layout: LayoutId; channel: AdChannel }[];
  /** Picture and words pairs that refused in every layout: nothing was recorded for them. */
  refused: { imageAssetId: string; copySetId: string; reason: string }[];
  /** Pairs that were already current variants (a retried step), left as they are. */
  existing: number;
  pictures: number;
  sets: number;
  /** Plain sentences for the run and the gallery ("Ads use the words for ..."). */
  notes: string[];
  /** The audience whose words were used. */
  audience: { segmentRef: string | null; title: string } | null;
};

/** Sets that are new words waiting beside the set they would replace (S5-2): a person hasn't chosen them yet. */
const WAITING = (tx: Tx) => tx`(s.source = 'agent' and s.based_on is not null and exists (
  select 1 from public.copy_sets o where o.id = s.based_on and o.discarded_at is null))`;

/**
 * Composes variants for a campaign's signed-off version: each current picture
 * (all of them, or those given) with each current ad copy set for the brief's
 * first audience (paid social, and display if the brief has it), in the first
 * layout that renders. A pair that refuses in every layout is reported, not
 * recorded.
 */
export async function composeVariants(
  ctx: { userId: string; workspaceId: string },
  campaignId: string,
  opts: { runId?: string | null; imageIds?: string[] } = {},
): Promise<ComposeResult> {
  const empty: ComposeResult = { made: [], refused: [], existing: 0, pictures: 0, sets: 0, notes: [], audience: null };
  if (!UUID.test(campaignId)) return { ...empty, notes: ["That campaign isn't in this workspace."] };

  const loaded = await asUser(ctx.userId, async (tx) => {
    const [c] = await tx`select brand_id, approved_version from public.campaigns where id = ${campaignId}`;
    if (!c?.approved_version) return null;
    const version = c.approved_version as number;
    const [v] = await tx`select brief from public.brief_versions where campaign_id = ${campaignId} and version = ${version}`;
    const brief = storedBrief.parse(v.brief);
    const images = await tx`
      select id from public.assets
      where campaign_id = ${campaignId} and kind = 'image' and discarded_at is null and (meta ->> 'briefVersion')::int = ${version}
        and ${opts.imageIds ? tx`id = any(${opts.imageIds}::uuid[])` : tx`true`}
      order by coalesce((meta ->> 'picture')::int, 0), created_at, id`;
    const sets = await tx`
      select s.id, s.channel, s.segment_ref, s.segment_title from public.copy_sets s
      where s.campaign_id = ${campaignId} and s.brief_version = ${version} and s.discarded_at is null
        and s.channel in ('paid social', 'display') and not ${WAITING(tx)}
      order by s.created_at, s.id`;
    const existing = await tx`
      select image_asset_id, copy_set_id from public.ad_variants
      where campaign_id = ${campaignId} and brief_version = ${version} and discarded_at is null`;
    const kit = await kitSnapshot(tx, c.brand_id as string);
    return { version, brief, images: images.map((r) => r.id as string), sets, existing, kit };
  });
  if (!loaded) return { ...empty, notes: ["The brief isn't signed off, so there is nothing to compose."] };
  if (!loaded.kit) return { ...empty, notes: ["The brand no longer exists."] };
  const { version, brief, images, kit } = loaded;

  // The first audience's words (in the brief's order); a brief without audiences has one "everyone" audience (null).
  const segments = [...new Set(loaded.sets.map((s) => (s.segment_ref as string | null) ?? null))];
  const firstRef = brief.audiences.map((a) => a.segmentRef).find((r) => segments.includes(r)) ?? segments[0] ?? null;
  const sets = loaded.sets.filter((s) => ((s.segment_ref as string | null) ?? null) === firstRef);
  const audience = sets[0] ? { segmentRef: firstRef, title: sets[0].segment_title as string } : null;
  const notes: string[] = [];
  if (segments.length > 1 && audience) {
    const others = segments.length - 1;
    notes.push(`Ads use the words for ${audience.title}, the brief's first audience; the words for the other ${others === 1 ? "audience are" : `${others} audiences are`} in the copy lists.`);
  }
  if (images.length === 0) notes.push("There are no current pictures for this brief version, so no ads were composed.");
  if (sets.length === 0) notes.push("There are no current paid-social or display words for this brief version, so no ads were composed.");

  const have = new Set(loaded.existing.map((e) => `${e.image_asset_id}:${e.copy_set_id}`));
  const result: ComposeResult = { ...empty, pictures: images.length, sets: sets.length, notes, audience };
  const pairs = images.flatMap((imageAssetId) => sets.map((s) => ({ imageAssetId, set: s })));

  // Pictures are converted once each and reused across their words.
  const pictures = new Map<string, Promise<VariantParts["picture"] | null>>();
  const pictureOf = (id: string) => {
    if (!pictures.has(id)) {
      pictures.set(
        id,
        asUser(ctx.userId, async (tx) => {
          const [img] = await tx`select bytes, sha256, simulated from public.assets where id = ${id}`;
          return img ? { png: await pictureToPng(img.bytes as Buffer), sha256: img.sha256 as string, simulated: img.simulated === true } : null;
        }),
      );
    }
    return pictures.get(id)!;
  };
  const setRows = await asUser(ctx.userId, (tx) => tx`select id, channel, set, legal_lines from public.copy_sets where id = any(${sets.map((s) => s.id)}::uuid[])`);
  const setById = new Map(setRows.map((r) => [r.id as string, r]));
  const logoPng = await asUser(ctx.userId, (tx) => logoBytes(tx, kit));

  for (const { imageAssetId, set } of pairs) {
    if (have.has(`${imageAssetId}:${set.id}`)) {
      result.existing++;
      continue;
    }
    const picture = await pictureOf(imageAssetId);
    const row = setById.get(set.id as string);
    const words = row ? adWords(row.channel as string, row.set) : null;
    if (!picture || !row || !words) {
      result.refused.push({ imageAssetId, copySetId: set.id as string, reason: "the picture or the words could not be read" });
      continue;
    }
    const rendered = await firstLayoutThatRenders({ picture, copy: words, legalLines: row.legal_lines as string[], kit, logoPng });
    if (!rendered.ok) {
      result.refused.push({ imageAssetId, copySetId: set.id as string, reason: refusalText(rendered.tried) });
      continue;
    }
    const id = await asUser(ctx.userId, (tx) =>
      insertVariant(tx, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        campaignId,
        briefVersion: version,
        imageAssetId,
        copySetId: set.id as string,
        layout: rendered.layout,
        checks: rendered.checks,
        kit,
        origin: "composed",
        runId: opts.runId ?? null,
        basedOn: null,
      }),
    );
    if (id) result.made.push({ id, imageAssetId, copySetId: set.id as string, layout: rendered.layout, channel: row.channel as AdChannel });
    else result.existing++;
  }
  return result;
}

export type DrawableVariant = {
  id: string;
  layout: LayoutId;
  etag: string;
  imageAssetId: string;
  copySetId: string;
  kit: KitSnapshot;
  /** C7-1: the words' channel decides the sizes; the ETag's parts make each size's ETag. */
  channel: AdChannel;
  etagParts: EtagParts;
};

/**
 * A variant that can be drawn for the signed-in user, or null: another
 * workspace's, a malformed id, or one whose picture or words were discarded
 * (it can't be drawn any more; the gallery shows its replacement). Cheap: no
 * bytes are read, so a matching ETag is answered without drawing.
 */
export async function drawableVariant(userId: string, variantId: string): Promise<DrawableVariant | null> {
  if (!UUID.test(variantId)) return null;
  const [v] = await asUser(userId, (tx) => tx`
    select v.id, v.layout, v.kit, v.image_asset_id, v.copy_set_id, a.sha256, a.simulated, a.discarded_at as image_discarded, s.discarded_at as words_discarded, s.channel
    from public.ad_variants v
    join public.assets a on a.id = v.image_asset_id
    join public.copy_sets s on s.id = v.copy_set_id
    where v.id = ${variantId}`);
  if (!v || v.image_discarded || v.words_discarded) return null;
  const kit = v.kit as KitSnapshot;
  const etagParts: EtagParts = { imageSha256: v.sha256 as string, copySetId: v.copy_set_id as string, layout: v.layout as string, kit, simulated: v.simulated === true };
  return {
    id: v.id as string,
    layout: v.layout as LayoutId,
    imageAssetId: v.image_asset_id as string,
    copySetId: v.copy_set_id as string,
    kit,
    channel: v.channel as AdChannel,
    etagParts,
    etag: adEtag(etagParts),
  };
}

/** Draws a variant in its layout: the PNG, or the renderer's refusal. */
export async function drawVariant(userId: string, v: DrawableVariant): Promise<{ png: Buffer } | { refused: string }> {
  const parts = await asUser(userId, (tx) => loadParts(tx, v.imageAssetId, v.copySetId, v.kit));
  if (!parts) return { refused: "the picture or the words could not be read" };
  const r = await renderAd(renderInputFor(parts, v.layout));
  return "refused" in r ? { refused: r.refused } : { png: r.png };
}

export const LAYOUT_NAMES: Record<LayoutId, string> = Object.fromEntries(LAYOUT_IDS.map((id) => [id, LAYOUT_SPECS[id].name])) as Record<LayoutId, string>;
export { LAYOUT_IDS, type LayoutId };
