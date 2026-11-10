import { refusableNames } from "@/lib/brands/own-names";
import { COMPLIANCE } from "@/config/compliance";
import { containsName } from "@/lib/brief/checks";
import { foldText } from "@/lib/creative/copy-rules";
import { AA_TEXT, contrastRatio, parseHex, type PaletteColour } from "@/lib/creative/render/colour";
import { normaliseText } from "@/lib/creative/render/fit";
import { bannedRule, dontRules, RULE_NAMES, type Status } from "./rules";

// C8-3: the rules for an ad uploaded from outside Studio, as pure functions of
// what the Read ad agent read in it (its words, each with an estimated box,
// and the logo's box), what code measured from its pixels (the contrast under
// each word box, src/lib/uploads/contrast.ts) and the brand's kit as it is
// now. Kept apart from rules.ts, which reads the boxes Studio laid out itself;
// the banned-term and don't-rule rules are reused from there as they are.
//
// Every finding says how it was found (rule 1):
// - "code": checked in code, on the words the AI read (banned terms, legal
//   lines, real company names); these pass or fail like a drawn ad's.
// - "estimated": measured in code from the AI's boxes (text density, and
//   contrast from the pixels under them); always Review, as estimates.
// - "ai": the model's own judgement (the logo, a face for a finance brand,
//   the don't rules); Review at most (Q4), and a model's "no" is shown as "No
//   issues found by AI", never as Pass.
// The thresholds are Studio's own (src/config/compliance.ts), not any
// platform's policy. Nothing here changes the upload: the fixes are
// suggestions only.

export type UploadRuleId = "banned" | "legal" | "realName" | "contrast" | "density" | "logo" | "face" | "dont";
export type How = "code" | "estimated" | "ai";

export const UPLOAD_RULE_NAMES: Record<UploadRuleId, string> = {
  banned: RULE_NAMES.banned,
  legal: RULE_NAMES.legal,
  realName: "Real company name",
  contrast: RULE_NAMES.contrast,
  density: RULE_NAMES.density,
  logo: "Logo",
  face: "Picture: face (finance brands)",
  dont: RULE_NAMES.dont,
};

/** How each finding was found, as the check page says it. */
export const HOW_LABELS: Record<How, string> = {
  code: "Checked in code, on the words read by AI",
  estimated: "Estimated",
  ai: "Checked by AI",
};

export type UploadFinding = {
  rule: UploadRuleId;
  key: string;
  name: string;
  status: Status;
  reason: string;
  /** A suggestion only; for a don't rule, the rule itself. */
  fix: string | null;
  how: How;
};

/** The status as a person reads it: a model's "no" is "No issues found by AI", never "Pass" (decision 0009, Q4). */
export function statusLabel(f: Pick<UploadFinding, "status" | "how">): string {
  if (f.status === "pass") return f.how === "ai" ? "No issues found by AI" : "Pass";
  return { review: "Review", fail: "Fail", na: "Not applied" }[f.status];
}

export type Box = { x: number; y: number; width: number; height: number };
export type Word = { text: string; part: "headline" | "body" | "button" | "legal" | "other"; box: Box };

/** The words in reading order, as one text, for the checks that look across lines (a legal line may wrap). */
export function allText(words: Word[]): string {
  return words.map((w) => w.text).join(" ");
}

const flat = (s: string) =>
  normaliseText(foldText(s))
    .toLowerCase()
    .replace(/[‐-―-]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "");

const quote = (s: string) => `"${s}"`;
const join = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ratio = (x: number) => `${(Math.floor(x * 100) / 100).toFixed(2)}:1`;

function make(rule: UploadRuleId, status: Status, reason: string, fix: string | null, how: How, key: string = rule): UploadFinding {
  return { rule, key, name: UPLOAD_RULE_NAMES[rule], status, reason, fix, how };
}

// ---------------------------------------------------------------- the words

/** Banned terms (the language's and the English ones) in the words read, through C8-1's rule. */
export function uploadBannedRule(words: Word[], terms: string[], langName: string): UploadFinding {
  const of = (parts: Word["part"][]) => words.filter((w) => parts.includes(w.part)).map((w) => w.text).join(" ");
  const f = bannedRule({ headline: of(["headline"]), body: of(["body", "other", "legal"]), cta: of(["button"]) }, terms, langName, { size: null, lang: null });
  return make("banned", f.status, f.reason, f.fix, "code");
}

/**
 * Every legal line the kit has for the language is somewhere in the words
 * read (a line may wrap, so the words are read as one text). A language with
 * no lines of its own while English has some fails, as for a drawn ad.
 */
export function uploadLegalRule(words: Word[], kitLines: string[] | null, english: string[], langName: string, isEnglish: boolean): UploadFinding {
  const expected = (kitLines ?? []).filter((l) => normaliseText(l));
  if (!isEnglish && expected.length === 0 && english.length > 0) {
    return make("legal", "fail", `The brand has no ${langName} legal lines, so this ad can't be checked for them.`, `Add the legal lines in ${langName} on the Languages page`, "code");
  }
  if (expected.length === 0) return make("legal", "pass", `The brand has no legal line for ${langName}, so none is needed.`, null, "code");
  const text = flat(allText(words));
  const missing = expected.filter((l) => !text.includes(flat(l)));
  if (missing.length) {
    return make(
      "legal",
      "fail",
      `${missing.length === 1 ? "A legal line is" : `${missing.length} legal lines are`} missing in ${langName}: ${join(missing.map(quote))}.`,
      `Add ${join(missing.map(quote))} to the ad, as the kit writes ${missing.length === 1 ? "it" : "them"}`,
      "code",
    );
  }
  return make("legal", "pass", `Every legal line for ${langName} is in the ad (${expected.length}).`, null, "code");
}

/** The real companies (from the brand's market notes) the words name. */
export function namedCompanies(words: Word[], realNames: string[]): string[] {
  // A possessive is the name too ("Brightwell's"): the word matcher would read it as another word.
  const text = foldText(allText(words)).replace(/(\p{L})'s(?![\p{L}\p{N}])/gu, "$1");
  return [...new Set(realNames.filter((n) => normaliseText(n).length >= 2 && containsName(text, foldText(n))))];
}

/**
 * Real company names (rule 2): any company the brand's market notes name
 * fails. The name is said here, once; the words shown with the check say "a
 * named company" instead (maskNames).
 */
export function realNameRule(words: Word[], allRealNames: string[], ownNames: readonly string[] = []): UploadFinding {
  // D-2 (Sprint 10b): the brand's own names, such as a parent brand's, may be named.
  const realNames = refusableNames(allRealNames, { name: "", ownNames });
  const found = namedCompanies(words, realNames);
  if (found.length) {
    return make(
      "realName",
      "fail",
      `The words name ${join(found.map(quote))}, ${found.length === 1 ? "a real company" : "real companies"} from the brand's market notes. An ad names no other company.`,
      `Remove ${found.length === 1 ? "the company's name" : "the companies' names"}`,
      "code",
    );
  }
  return make(
    "realName",
    "pass",
    realNames.length ? `None of the ${realNames.length} real companies in the brand's market notes is named.` : "The brand's market notes name no real companies, so there were none to look for.",
    null,
    "code",
  );
}

/** A text with each real company's name replaced by "a named company", so the name is shown only in its finding. */
export function maskNames(text: string, realNames: string[]): string {
  let out = text;
  for (const n of [...realNames].sort((a, b) => b.length - a.length)) {
    const name = normaliseText(n);
    if (name.length < 2) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), "[a named company]");
  }
  return out;
}

// ---------------------------------------------------------------- estimates

const clip = (b: Box): Box => {
  const x = Math.max(0, Math.min(1, b.x));
  const y = Math.max(0, Math.min(1, b.y));
  return { x, y, width: Math.max(0, Math.min(1, b.x + b.width) - x), height: Math.max(0, Math.min(1, b.y + b.height) - y) };
};

/** How much of the ad the words cover, from the AI's boxes (each line's box, as C8-1 counts a drawn ad's). */
export function uploadWordShare(words: Word[]): number {
  return Math.min(1, words.reduce((sum, w) => {
    const b = clip(w.box);
    return sum + b.width * b.height;
  }, 0));
}

/**
 * Text density from the AI's boxes: always Review, as an estimate, with the
 * share and where it falls against Studio's thresholds. Not applied to
 * banners (Q2).
 */
export function uploadDensityRule(words: Word[], channel: string): UploadFinding {
  if (channel === "display") return make("density", "na", "Not applied to banners: their words naturally fill them.", null, "estimated");
  const t = COMPLIANCE.textDensity;
  const share = uploadWordShare(words);
  const band = share <= t.pass ? `within the ${pct(t.pass)} that passes for Studio's own ads` : share <= t.fail ? `between ${pct(t.pass)} and ${pct(t.fail)}, which needs a look` : `over the ${pct(t.fail)} that fails`;
  return make(
    "density",
    "review",
    `The words cover about ${pct(share)} of the ad, ${band}. Estimated from the boxes the AI drew round the words, so a person judges it.`,
    share > t.pass ? "Shorten the words" : null,
    "estimated",
  );
}

export type MeasuredContrast = { index: number; ratio: number; text: string; background: string } | { index: number; ratio: null };

/**
 * Contrast measured in code from the pixels under each word's box: always
 * Review, as an estimate (the boxes are the AI's, and a word over a picture
 * has no single background). Says the lowest ratio, which words, and whether
 * it looks below AA (4.5:1), with a palette colour that would stand further
 * from the words.
 */
export function uploadContrastRule(words: Word[], measured: MeasuredContrast[], palette: PaletteColour[]): UploadFinding {
  const ok = measured.filter((m): m is Extract<MeasuredContrast, { ratio: number }> => m.ratio !== null && !!words[m.index]);
  if (ok.length === 0) return make("contrast", "na", words.length ? "The words' boxes were too small to measure." : "No words were read, so there is no contrast to measure.", null, "estimated");
  const worst = [...ok].sort((a, b) => a.ratio - b.ratio)[0];
  const below = ok.filter((m) => m.ratio < AA_TEXT);
  const near = ok.filter((m) => m.ratio >= AA_TEXT && m.ratio < AA_TEXT * (1 + COMPLIANCE.contrastMargin));
  const w = words[worst.index];
  const lowest = `The lowest is about ${ratio(worst.ratio)}, for ${quote(w.text.length > 60 ? `${w.text.slice(0, 57)}...` : w.text)}.`;
  const verdict = below.length
    ? `${below.length === 1 ? "One line looks" : `${below.length} lines look`} below AA (4.5:1 for words).`
    : near.length
      ? `Every line looks to pass AA (4.5:1 for words), ${near.length === 1 ? "one" : near.length} by less than ${Math.round(COMPLIANCE.contrastMargin * 100)}%.`
      : "Every line looks to pass AA (4.5:1 for words).";
  const best = palette
    .filter((p) => parseHex(p.hex))
    .map((p) => ({ p, r: contrastRatio(p.hex, worst.text) }))
    .sort((a, b) => b.r - a.r)[0];
  const fix =
    below.length || near.length
      ? best && best.r >= AA_TEXT * (1 + COMPLIANCE.contrastMargin)
        ? `Use ${best.p.name} behind those words (about ${ratio(best.r)} with them)`
        : "Make those words and their background stand further apart"
      : null;
  return make("contrast", "review", `${lowest} ${verdict} Estimated from the pixels under the boxes the AI drew round ${ok.length} ${ok.length === 1 ? "line" : "lines"}, so a person judges it.`, fix, "estimated");
}

// ---------------------------------------------------------------- the model's judgement

/** The gap between two boxes, in pixels of a picture this size (0 when they touch). */
function gapPx(a: Box, b: Box, W: number, H: number): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0) * W;
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0) * H;
  return Math.max(dx, dy);
}

/**
 * The logo, as the AI reports it: Review either way (a model's word, and its
 * box an estimate). With a box, the clear space is estimated as C8-1 measures
 * it: from the nearest edge and the nearest word, as a share of the shorter side.
 */
export function uploadLogoRule(logo: { present: boolean; box: Box | null }, words: Word[], hasLogo: boolean, size: { width: number; height: number }): UploadFinding {
  if (!hasLogo) return make("logo", "na", "The brand has no logo in its kit, so there is none to look for.", null, "ai");
  if (!logo.present || !logo.box) return make("logo", "review", "No logo found by AI. A person checks whether the brand's logo is in the ad.", "Add the brand's logo", "ai");
  const { width: W, height: H } = size;
  const short = Math.min(W, H);
  const m = clip(logo.box);
  const edge = Math.min(m.x * W, m.y * H, (1 - m.x - m.width) * W, (1 - m.y - m.height) * H) / short;
  const toWords = words.length ? Math.min(...words.map((w) => gapPx(m, clip(w.box), W, H))) / short : Infinity;
  const least = Math.min(edge, toWords);
  const t = COMPLIANCE.logoClearSpace;
  const near = Number.isFinite(toWords) ? `, ${pct(toWords)} from the nearest word` : "";
  return make(
    "logo",
    "review",
    `A logo found by AI. Its clear space is about ${pct(edge)} of the shorter side from the nearest edge${near} (Estimated; Studio's own ads keep ${pct(t.pass)}).`,
    least < t.pass ? "Give the logo more clear space" : null,
    "ai",
  );
}

/** A person's face, for a finance brand only (F-24): Review on the AI's "yes"; its "no" is "No issues found by AI". */
export function uploadFaceRule(face: { present: boolean; reason: string }, finance: boolean): UploadFinding {
  if (!finance) return make("face", "na", "Not applied: only a finance brand keeps faces out of its ads.", null, "ai");
  if (face.present) return make("face", "review", `The AI found a person's face: ${face.reason}`, "Use a picture without a person's face, or with people only from behind, at a distance or as hands", "ai");
  return make("face", "pass", `No person's face found by AI: ${face.reason}`, null, "ai");
}

/** The don't rules' keys as the Read ad agent gets them (D1, D2 ...), from C8-1's list of the kit's rules (normalised, once each). */
export function dontKeys(rules: string[]): { key: string; rule: string; findingKey: string }[] {
  return dontRules(rules).map((f, i) => ({ key: `D${i + 1}`, rule: f.fix ?? "", findingKey: f.key }));
}

/**
 * Each of the kit's don't rules, once: always Review, for a person to confirm
 * (no code can check them). The AI's view is given with it.
 */
export function uploadDontRules(rules: string[], answers: { key: string; breaks: boolean; reason: string }[]): UploadFinding[] {
  return dontKeys(rules).map(({ key, rule, findingKey }) => {
    const a = answers.find((x) => x.key === key);
    const reason = !a
      ? "The AI gave no answer for this rule. A person confirms the ad keeps it."
      : a.breaks
        ? `The AI thinks the ad may break this rule: ${a.reason} A person decides.`
        : `No issues found by AI (${a.reason.replace(/\.$/, "")}). A person confirms the ad keeps it.`;
    return make("dont", "review", reason, rule, "ai", findingKey);
  });
}

// ---------------------------------------------------------------- the whole check

export type UploadKit = {
  langName: string;
  isEnglish: boolean;
  /** The language's legal lines (null: the brand has none for it). */
  legalLines: string[] | null;
  englishLegal: string[];
  /** The language's banned terms and the English ones. */
  bannedTerms: string[];
  dontRules: string[];
  realNames: string[];
  palette: PaletteColour[];
  hasLogo: boolean;
  finance: boolean;
  channel: string;
};

export type Reading = {
  words: Word[];
  logo: { present: boolean; box: Box | null };
  face: { present: boolean; reason: string };
  dontRules: { key: string; breaks: boolean; reason: string }[];
};

export const UPLOAD_RULE_ORDER: UploadRuleId[] = ["banned", "legal", "realName", "contrast", "density", "logo", "face", "dont"];

/**
 * Every finding for an uploaded ad, in the order the check page lists them.
 * Rule 2: a real company's name is said once, in the "Real company name"
 * finding. Every other finding's reason and fix is masked ("[a named
 * company]"), whether it quotes the ad's words (the contrast rule's lowest
 * line) or the model's own words (the face and don't-rule reasons). The
 * checks themselves read the words as the AI read them.
 */
export function uploadFindings(reading: Reading, measured: MeasuredContrast[], kit: UploadKit, size: { width: number; height: number }): UploadFinding[] {
  const shown = reading.words.map((w) => ({ ...w, text: maskNames(w.text, kit.realNames) }));
  const findings = [
    uploadBannedRule(reading.words, kit.bannedTerms, kit.langName),
    uploadLegalRule(reading.words, kit.legalLines, kit.englishLegal, kit.langName, kit.isEnglish),
    realNameRule(reading.words, kit.realNames),
    uploadContrastRule(shown, measured, kit.palette),
    uploadDensityRule(reading.words, kit.channel),
    uploadLogoRule(reading.logo, reading.words, kit.hasLogo, size),
    uploadFaceRule(reading.face, kit.finance),
    ...uploadDontRules(kit.dontRules, reading.dontRules),
  ];
  return findings.map((f) => (f.rule === "realName" ? f : maskFinding(f, kit.realNames)));
}

/** A finding with any real company's name in its reason and fix replaced (rule 2). */
export function maskFinding(f: UploadFinding, realNames: string[]): UploadFinding {
  if (realNames.length === 0) return f;
  return { ...f, reason: maskNames(f.reason, realNames), fix: f.fix === null ? null : maskNames(f.fix, realNames) };
}

export type UploadOutcome = "passes" | "review" | "fails";

/** Fails if anything fails, else review if anything waits for a person, else passes. */
export function uploadOutcome(findings: UploadFinding[]): UploadOutcome {
  if (findings.some((f) => f.status === "fail")) return "fails";
  if (findings.some((f) => f.status === "review")) return "review";
  return "passes";
}

/** "Fails: 2 rules. 6 to review." for the run's summary and the list of uploads (no words from the ad, so no names). */
export function outcomeLine(findings: UploadFinding[]): string {
  const fails = findings.filter((f) => f.status === "fail");
  const review = findings.filter((f) => f.status === "review").length;
  const rest = review ? ` ${review} to review.` : "";
  if (fails.length) return `Fails: ${join([...new Set(fails.map((f) => f.name.toLowerCase()))])}.${rest}`;
  return review ? `${review} to review.` : "Passes.";
}
