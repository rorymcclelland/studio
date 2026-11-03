import { z } from "zod";

// C8-2: the picture check's results, kept with the picture in assets.meta.vision
// (written only through public.set_asset_vision, migration
// 20261103000004_vision_results.sql). One record per picture: what the model
// said about text, a face and each of the kit's don't rules, with the run, the
// step, the provider and the model (rule 4), or why the check didn't run (an
// error, or the daily cap). The compliance rules read it (rules.ts:
// pictureFindings); nothing here calls a model.

/** The most a record may take in meta (the column holds 8,000 bytes in all, with the picture's prompt and idea). */
export const VISION_MAX_BYTES = 5_000;
/** The meta column's limit (octet_length(meta::text), 20261028000002_assets_and_images.sql). */
export const META_MAX_BYTES = 8_000;
/** Room left in meta beyond the measured record and the rest of meta, for the "vision" key and anything measured a little short. */
export const META_MARGIN_BYTES = 500;
/** A reason as stored: the model may write up to 300 characters; long ones are cut so every rule fits. */
const REASON_MAX = 200;

const ruleResult = z.object({ key: z.string().regex(/^dont:[0-9a-f]{16}$/), breaks: z.boolean(), reason: z.string().max(REASON_MAX) });

const common = {
  checkedAt: z.string().max(40),
  runId: z.string().max(40),
  stepId: z.string().max(40).nullable(),
  provider: z.string().max(40).nullable(),
  model: z.string().max(80).nullable(),
};

export const visionRecord = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("checked"),
    ...common,
    hasText: z.boolean(),
    reason: z.string().max(REASON_MAX),
    face: z.object({ present: z.boolean(), closeUp: z.boolean() }),
    /** Each don't rule the model was asked about, by its key (rules.ts: dontKey), so an edited rule is a new one. */
    rules: z.array(ruleResult).max(20),
  }),
  z.object({ status: z.enum(["error", "cap"]), ...common, message: z.string().max(400) }),
]);

export type VisionRecord = z.infer<typeof visionRecord>;

/** The record in an asset's meta.vision, or null when the picture has none (or it can't be read). */
export function readVision(value: unknown): VisionRecord | null {
  const parsed = visionRecord.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Whether the record was written by the mock model (rule 1: "simulated"). */
export const isSimulated = (v: VisionRecord) => v.provider === "mock";

const cut = (s: string, n: number) => (n <= 3 ? "" : Array.from(s).length > n ?`${Array.from(s).slice(0, n - 3).join("").trimEnd()}...` : s);
/**
 * A value's size as Postgres prints jsonb (`meta::text`, which the meta column's
 * limit measures): ", " between items and ": " after each key, so a little
 * larger than compact JSON (Sprint 8 review fix 6).
 */
export function jsonbText(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => jsonbText(x === undefined ? null : x)).join(", ")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${JSON.stringify(k)}: ${jsonbText(x)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(v);
}
export const jsonbBytes = (v: unknown) => Buffer.byteLength(jsonbText(v), "utf8");
const bytes = jsonbBytes;

/**
 * The record as stored: reasons cut to 200 characters, then shorter until the
 * record fits in `budget` bytes as jsonb prints it, so the meta column's
 * 8,000-byte limit is never the reason a paid-for check is lost.
 */
export function fitVision(v: VisionRecord, budget = VISION_MAX_BYTES): VisionRecord {
  for (const n of [REASON_MAX, 120, 60, 20, 0]) {
    const out: VisionRecord =
      v.status === "checked"
        ? { ...v, reason: cut(v.reason, n), rules: v.rules.map((r) => ({ ...r, reason: cut(r.reason, n) })) }
        : { ...v, message: cut(v.message, Math.max(n, 60)) };
    if (bytes(out) <= budget) return out;
  }
  // Twenty rule keys and flags are well under the budget, so this is not reached in practice.
  return v.status === "checked" ? { ...v, reason: "", rules: v.rules.slice(0, 20).map((r) => ({ ...r, reason: "" })) } : { ...v, message: v.message.slice(0, 60) };
}
