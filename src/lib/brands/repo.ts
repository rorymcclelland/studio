import { asUser } from "@/lib/db/scoped";
import { syncBrandContext } from "@/lib/context/sync";
import { parseBrandInput, type BrandInput, type BrandKit } from "./schema";
import { sanitizeLogoSvg } from "./svg";

export class BrandInputError extends Error {
  constructor(message: string, public fieldErrors: Record<string, string> = {}) {
    super(message);
  }
}

export type Member = { userId: string; workspaceId: string };

export type Brand = BrandKit & {
  id: string;
  workspaceId: string;
  logoSvg: string | null;
  /** F-10: a PNG logo (an asset of kind 'logo'); a brand has this or an SVG, not both. */
  logoAssetId: string | null;
  /** Where the PNG logo is served from (/assets/[id]), or null. */
  logoPngSrc: string | null;
  /** D-2 (decision 0028): the brand's data is simulated (the demo brands, or a brand given simulated data). */
  isSimulated: boolean;
  /** D-2 (decision 0028): the brand is invented (the demo brands). A person's own brand is not. */
  isFictional: boolean;
  /** When simulated customer data was generated; time windows count back from it. */
  dataAsOf: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** logoSvg undefined means "keep the stored logo" (F-10: logos change only through an upload). */
function validated(raw: BrandInput): BrandKit & { logoSvg: string | null | undefined } {
  const r = parseBrandInput(raw);
  if (!r.ok) {
    const [first] = Object.values(r.fieldErrors);
    throw new BrandInputError(first ?? "Check the highlighted fields.", r.fieldErrors);
  }
  const logo = r.data.logoSvg === undefined ? undefined : r.data.logoSvg ? sanitizeLogoSvg(r.data.logoSvg) : null;
  return { ...r.data, logoSvg: logo };
}

function columns(k: BrandKit & { logoSvg: string | null | undefined }) {
  return {
    name: k.name, slug: k.slug, description: k.description, category: k.category,
    tone_words: k.toneWords, voice_notes: k.voiceNotes, do_rules: k.doRules, dont_rules: k.dontRules,
    font_primary: k.fontPrimary, font_secondary: k.fontSecondary,
    ...(k.logoSvg === undefined ? {} : { logo_svg: k.logoSvg }),
    legal_lines: k.legalLines, banned_terms: k.bannedTerms, evidence_claims: k.evidenceClaims,
    own_names: k.ownNames,
  };
}

function toBrand(r: Record<string, unknown>): Brand {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    name: r.name as string,
    slug: r.slug as string,
    description: r.description as string,
    category: r.category as string,
    toneWords: r.tone_words as string[],
    voiceNotes: r.voice_notes as string,
    doRules: r.do_rules as string[],
    dontRules: r.dont_rules as string[],
    palette: r.palette as { name: string; hex: string }[],
    fontPrimary: r.font_primary as string,
    fontSecondary: r.font_secondary as string,
    logoSvg: (r.logo_svg as string | null) ?? null,
    logoAssetId: (r.logo_asset_id as string | null) ?? null,
    logoPngSrc: r.logo_asset_id ? `/assets/${r.logo_asset_id}` : null,
    legalLines: r.legal_lines as string[],
    bannedTerms: r.banned_terms as string[],
    evidenceClaims: r.evidence_claims as string[],
    ownNames: (r.own_names as string[] | null) ?? [],
    isSimulated: r.is_simulated as boolean,
    isFictional: r.is_fictional as boolean,
    dataAsOf: r.data_as_of ? new Date(r.data_as_of as string).toISOString() : null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

/** Review fix S1 (rule 2): a fictional demo brand has no other names; the database holds this too (brands_fictional_no_own_names). */
export const FICTIONAL_OWN_NAMES = "A demo brand is fictional, so it has no other names.";

function rethrow(err: unknown): never {
  if ((err as { code?: string }).code === "23505") {
    throw new BrandInputError("That short name is already used by another brand.", { slug: "Already used by another brand." });
  }
  if ((err as { code?: string; constraint_name?: string }).code === "23514" && (err as { constraint_name?: string }).constraint_name === "brands_fictional_no_own_names") {
    throw new BrandInputError(FICTIONAL_OWN_NAMES, { ownNames: FICTIONAL_OWN_NAMES });
  }
  throw err;
}

export async function createBrand(member: Member, raw: BrandInput, opts: { simulated?: boolean } = {}): Promise<string> {
  const k = validated(raw);
  try {
    return await asUser(member.userId, async (tx) => {
      const [row] = await tx`
        insert into public.brands ${tx({ ...columns(k), workspace_id: member.workspaceId, created_by: member.userId, is_fictional: false, is_simulated: opts.simulated ?? false })}
        returning id`;
      await tx`update public.brands set palette = ${tx.json(k.palette)} where id = ${row.id}`;
      await syncBrandContext(tx, row.id);
      return row.id as string;
    });
  } catch (err) {
    rethrow(err);
  }
}

/**
 * Returns false when the brand does not exist in the user's workspace. Leave
 * logoSvg out to keep the stored logo (SVG or PNG); null removes an SVG logo.
 */
export async function updateBrand(member: Member, brandId: string, raw: BrandInput): Promise<boolean> {
  if (!UUID.test(brandId)) return false;
  const k = validated(raw);
  try {
    return await asUser(member.userId, async (tx) => {
      const [current] = await tx`select is_fictional from public.brands where id = ${brandId}`;
      if (!current) return false;
      if (current.is_fictional && k.ownNames.length > 0) throw new BrandInputError(FICTIONAL_OWN_NAMES, { ownNames: FICTIONAL_OWN_NAMES });
      const cols = columns(k);
      const res = await tx`
        update public.brands set ${tx(cols, Object.keys(cols) as (keyof typeof cols)[])}, palette = ${tx.json(k.palette)}
        where id = ${brandId}`;
      if (res.count !== 1) return false;
      await syncBrandContext(tx, brandId);
      return true;
    });
  } catch (err) {
    rethrow(err);
  }
}

export async function getBrand(userId: string, brandId: string): Promise<Brand | null> {
  if (!UUID.test(brandId)) return null;
  const [row] = await asUser(userId, (tx) => tx`select * from public.brands where id = ${brandId}`);
  return row ? toBrand(row) : null;
}

/** Brands in one workspace (all of the user's workspaces when none is given). */
export async function listBrands(userId: string, workspaceId?: string): Promise<Brand[]> {
  const rows = await asUser(userId, (tx) => tx`
    select * from public.brands
    ${workspaceId ? tx`where workspace_id = ${workspaceId}` : tx``}
    order by name`);
  return rows.map(toBrand);
}

export async function deleteBrand(userId: string, brandId: string): Promise<boolean> {
  if (!UUID.test(brandId)) return false;
  const res = await asUser(userId, (tx) => tx`delete from public.brands where id = ${brandId}`);
  return res.count === 1;
}
