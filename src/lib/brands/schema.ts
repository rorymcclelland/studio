import { z } from "zod";
import { normaliseKitText } from "@/lib/context/keys";

// One brand's kit: what every agent needs to stay on-brand (S2-2).
// Limits match the database checks in migration 20261025000003.

const text = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`);

const list = (maxItems: number, maxLen: number, label: string) =>
  z
    .array(text(maxLen, label).min(1, `${label} can't be empty.`))
    .max(maxItems, `No more than ${maxItems} ${label.toLowerCase()}s.`);

/** A list whose entries must differ (ignoring case and spacing), because each one is keyed by its text (F-11). */
const uniqueList = (maxItems: number, maxLen: number, label: string) =>
  list(maxItems, maxLen, label).superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const k = normaliseKitText(item);
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: [i], message: `This ${label.toLowerCase()} is already in the list.` });
      seen.add(k);
    });
  });

export const colourSchema = z.object({
  name: text(40, "Colour name").min(1, "Name the colour."),
  hex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #3F5B3A."),
});

/** The kit's fields, before the checks across fields (own names against banned terms). */
const brandFields = z.object({
  name: text(80, "Name").min(1, "Give the brand a name."),
  slug: z
    .string()
    .trim()
    .max(40, "Short name must be 40 characters or fewer.")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case letters, numbers and hyphens, such as fern-hollow."),
  description: text(500, "Description").default(""),
  category: text(60, "Category").default(""),
  toneWords: list(12, 30, "Tone word").default([]),
  voiceNotes: text(2000, "Voice notes").default(""),
  doRules: uniqueList(20, 300, "Rule").default([]),
  dontRules: uniqueList(20, 300, "Rule").default([]),
  palette: z.array(colourSchema).max(12, "No more than 12 colours.").default([]),
  fontPrimary: text(60, "Font").default(""),
  fontSecondary: text(60, "Font").default(""),
  legalLines: uniqueList(20, 500, "Legal line").default([]),
  bannedTerms: list(50, 80, "Banned term").default([]),
  evidenceClaims: list(20, 120, "Claim").default([]),
  /** D-2 (Sprint 10b): other names the brand's ads may use, such as a parent brand's ("Also known as"). */
  ownNames: uniqueList(5, 80, "Own name").default([]),
  logoSvg: z.string().max(50_000, "The logo is too large.").nullable().optional(),
});

export const brandInputSchema = brandFields.superRefine((kit, ctx) => {
  // An own name the brand also bans would be allowed and refused at once.
  const banned = new Set(kit.bannedTerms.map(normaliseKitText));
  kit.ownNames.forEach((n, i) => {
    if (banned.has(normaliseKitText(n))) ctx.addIssue({ code: "custom", path: ["ownNames", i], message: "This name is also one of the brand's banned terms." });
  });
});

export type BrandInput = z.input<typeof brandInputSchema>;
export type BrandKit = z.output<typeof brandInputSchema>;

export type ParseResult =
  | { ok: true; data: BrandKit }
  | { ok: false; fieldErrors: Record<string, string> };

/** Validates brand input; errors are keyed by field path, e.g. "palette.0.hex". */
export function parseBrandInput(raw: unknown): ParseResult {
  const r = brandInputSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}

/**
 * D-1: a short name from a brand's name: lower case, accents folded, every run of
 * other characters one hyphen, no hyphen at either end, at most 40 characters (cut
 * at a hyphen where it can be). "" when nothing is left.
 */
export function slugFromName(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= 40) return s;
  const cut = s.slice(0, 40);
  const at = cut.lastIndexOf("-");
  return (at > 0 ? cut.slice(0, at) : cut).replace(/-+$/, "");
}

/** D-1: the New brand form's fields, with the kit's own rules and words. */
export const newBrandSchema = brandFields.pick({ name: true, slug: true, category: true, description: true });

export type NewBrand = z.output<typeof newBrandSchema>;

export function parseNewBrand(raw: unknown): { ok: true; data: NewBrand } | { ok: false; fieldErrors: Record<string, string> } {
  const r = newBrandSchema.safeParse(raw);
  if (r.success) return { ok: true, data: { name: r.data.name, slug: r.data.slug, category: r.data.category, description: r.data.description } };
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) fieldErrors[issue.path.join(".") || "form"] ??= issue.message;
  return { ok: false, fieldErrors };
}
