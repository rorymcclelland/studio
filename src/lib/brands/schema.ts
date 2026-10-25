import { z } from "zod";

// One brand's kit: what every agent needs to stay on-brand (S2-2).
// Limits match the database checks in migration 20261025000003.

const text = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`);

const list = (maxItems: number, maxLen: number, label: string) =>
  z
    .array(text(maxLen, label).min(1, `${label} can't be empty.`))
    .max(maxItems, `No more than ${maxItems} ${label.toLowerCase()}s.`);

export const colourSchema = z.object({
  name: text(40, "Colour name").min(1, "Name the colour."),
  hex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #3F5B3A."),
});

export const brandInputSchema = z.object({
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
  doRules: list(20, 300, "Rule").default([]),
  dontRules: list(20, 300, "Rule").default([]),
  palette: z.array(colourSchema).max(12, "No more than 12 colours.").default([]),
  fontPrimary: text(60, "Font").default(""),
  fontSecondary: text(60, "Font").default(""),
  legalLines: list(20, 500, "Legal line").default([]),
  bannedTerms: list(50, 80, "Banned term").default([]),
  evidenceClaims: list(20, 120, "Claim").default([]),
  logoSvg: z.string().max(50_000, "The logo is too large.").nullable().optional(),
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
