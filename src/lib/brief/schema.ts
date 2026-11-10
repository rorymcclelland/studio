import { z } from "zod";

// S3-2: the campaign brief. The model writes the creative parts and cites the
// context it used by tag (C1, C2, ...); code maps tags to context item ids and
// adds the must-include and avoid lists from the brand kit, so the model can
// never drop a legal line or a banned term.

export const CHANNELS = ["paid social", "search", "display", "email", "app push", "out-of-home"] as const;
export const KPI_METRICS = [
  "conversions",
  "revenue",
  "return on ad spend",
  "cost per acquisition",
  "click-through rate",
  "reactivation rate",
  "sign-ups",
  "reach",
] as const;

export const BRIEF_SECTIONS = ["title", "line", "summary", "story", "insights", "audiences", "channels", "kpi"] as const;
export type BriefSection = (typeof BRIEF_SECTIONS)[number];

/**
 * D-4 (Sprint 10b): the campaign's line, the headline of every paid-social and
 * display ad. 30 characters at most, so it fits every headline limit (paid
 * social 40, display 30, search 30).
 */
export const CAMPAIGN_LINE_MIN = 3;
export const CAMPAIGN_LINE_MAX = 30;

const str = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} can't be empty.`).max(max, `${label} must be ${max} characters or fewer.`);

/** The parts the model writes. `cites` and `segmentRef` hold tags (model) or item ids (stored). */
export const briefCore = z.object({
  title: str(3, 100, "The title"),
  /** D-4: optional; a person's words (typed, or picked from the Tagline agent's suggestions), never the Brief agent's. */
  line: z
    .string()
    .trim()
    .min(CAMPAIGN_LINE_MIN, `The campaign line must be at least ${CAMPAIGN_LINE_MIN} characters.`)
    .max(CAMPAIGN_LINE_MAX, `The campaign line must be ${CAMPAIGN_LINE_MAX} characters or fewer.`)
    // Review fix N5: one line of plain text, as every headline shows it.
    .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, "The campaign line must be one line, with no tabs, line breaks or control characters.")
    .optional(),
  summary: str(20, 600, "The summary"),
  story: str(20, 1200, "The story"),
  insights: z
    .array(z.object({ text: str(10, 300, "An insight"), cites: z.array(z.string().min(1).max(60)).min(1, "Each insight needs at least one source.").max(4) }))
    .min(3, "A brief needs at least three insights.")
    .max(6, "No more than six insights."),
  audiences: z.array(z.object({ segmentRef: z.string().min(1).max(60), why: str(10, 300, "The reason") })).max(3, "No more than three audiences."),
  channels: z
    .array(z.object({ channel: z.enum(CHANNELS), role: str(5, 200, "The channel's role") }))
    .min(1, "Choose at least one channel.")
    .max(4, "No more than four channels."),
  kpi: z.object({ metric: z.enum(KPI_METRICS), target: z.string().trim().max(80).optional() }),
});

export type BriefCore = z.infer<typeof briefCore>;

/** A stored brief: the core with item ids, plus the kit's lists added in code. */
export const storedBrief = briefCore.extend({
  mustInclude: z.array(z.string().max(500)).max(20),
  avoid: z.array(z.string().max(300)).max(80),
});

export type StoredBrief = z.infer<typeof storedBrief>;
