import { createHash } from "node:crypto";
import { COMPLIANCE } from "@/config/compliance";
import { containsTerm } from "@/lib/brief/checks";
import { foldText } from "@/lib/creative/copy-rules";
import type { AdBoxes, Box } from "@/lib/creative/render/boxes";
import { AA_LARGE, AA_TEXT, contrastRatio, parseHex, type PaletteColour } from "@/lib/creative/render/colour";
import { normaliseText } from "@/lib/creative/render/fit";
import type { RenderChecks } from "@/lib/creative/render/render";
import type { SizeId } from "@/lib/creative/render/sizes";

// C8-1: the compliance rules, as pure functions of what an ad is (its laid-out
// boxes and checks from planAd, its words) and the brand's kit as it is now.
// Each gives a finding: pass, review (a person's judgement), fail, or not
// applied, with the reason and a suggested fix. No model is called and nothing
// costs anything. The thresholds are Studio's own (src/config/compliance.ts),
// not any platform's policy (rule 1). The fixes are suggestions only: nothing
// here changes an ad (out of scope).

export type Status = "pass" | "review" | "fail" | "na";

export type RuleId = "contrast" | "legal" | "banned" | "logo" | "density" | "platform" | "dont" | "simulated";

export const RULE_NAMES: Record<RuleId, string> = {
  contrast: "Text contrast",
  legal: "Legal lines present",
  banned: "Banned terms",
  logo: "Logo clear space",
  density: "Text density",
  platform: "9:16 platform zones",
  dont: "Don't rule",
  simulated: "Simulated label",
};

/** The order rules are listed in, per size and language; the don't rules (once per ad) come first. */
export const RULE_ORDER: RuleId[] = ["dont", "contrast", "legal", "banned", "logo", "density", "platform", "simulated"];

export type Finding = {
  rule: RuleId;
  /** The rule's key: its id, or "dont:<hash of the rule>" for each don't rule. */
  key: string;
  name: string;
  status: Status;
  reason: string;
  fix: string | null;
  /** Short, for a pack's left-out reason ("banned term \"guaranteed\" in German"). */
  short: string;
  /** Null for a finding about the whole ad (the don't rules). */
  size: SizeId | null;
  lang: string | null;
};

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const ratio = (x: number) => `${x.toFixed(2)}:1`;
const quote = (s: string) => `"${s}"`;
const join = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

type Where = { size: SizeId | null; lang: string | null };

function finding(rule: RuleId, where: Where, status: Status, reason: string, fix: string | null, short: string, key: string = rule): Finding {
  return { rule, key, name: RULE_NAMES[rule], status, reason, fix, short, ...where };
}

// ---------------------------------------------------------------- contrast

/**
 * Text contrast: the words on their panel and the button's words at 4.5:1,
 * the button's edge against its panel at 3:1 (AA). A drawn ad always passes
 * (the renderer refuses otherwise); within the margin above a threshold
 * (4.5 to 4.95:1 for words) is review, with a palette colour that would do
 * better. Below a threshold can't happen in a drawn ad; it is a fail here, for
 * the uploaded ads of C8-3.
 */
export function contrastRule(c: RenderChecks["contrast"], palette: PaletteColour[], where: Where): Finding {
  const m = 1 + COMPLIANCE.contrastMargin;
  const parts = [
    { label: "the words on their panel", value: c.body, min: AA_TEXT, what: "panel" as const },
    { label: "the button's words", value: c.cta, min: AA_TEXT, what: "button" as const },
    { label: "the button's edge against the panel", value: c.buttonEdge, min: AA_LARGE, what: "button" as const },
  ];
  const below = parts.filter((p) => p.value < p.min);
  const near = parts.filter((p) => p.value >= p.min && p.value < p.min * m);
  const summary = `Words ${ratio(c.body)} on their panel, button ${ratio(c.cta)}, button edge ${ratio(c.buttonEdge)}.`;
  if (below.length === 0 && near.length === 0) {
    return finding("contrast", where, "pass", `${summary} AA needs 4.5:1 for words and 3:1 for the button's edge.`, null, "text contrast");
  }
  const worst = [...below, ...near][0];
  const fix = contrastFix(worst.what, c, palette);
  if (below.length) {
    return finding("contrast", where, "fail", `${summary} ${capitalise(worst.label)} ${ratio(worst.value)}: below AA (${ratio(worst.min)}).`, fix, `text contrast ${ratio(worst.value)}`);
  }
  return finding(
    "contrast",
    where,
    "review",
    `${summary} ${capitalise(worst.label)} ${ratio(worst.value)}: passes AA (${ratio(worst.min)}) by less than ${Math.round(COMPLIANCE.contrastMargin * 100)}%.`,
    fix,
    `text contrast ${ratio(worst.value)}`,
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Use Moss for the panel (8.12:1 with the words)": the palette colour that does best, or a note to add one. */
export function contrastFix(what: "panel" | "button", c: RenderChecks["contrast"], palette: PaletteColour[]): string {
  const valid = palette.filter((p) => parseHex(p.hex));
  const against = what === "panel" ? c.text : c.panel;
  const current = (what === "panel" ? c.panel : c.button).toUpperCase();
  const best = valid
    .filter((p) => p.hex.toUpperCase() !== current && p.hex.toUpperCase() !== against.toUpperCase())
    .map((p) => ({ p, r: contrastRatio(p.hex, against) }))
    .sort((a, b) => b.r - a.r)[0];
  const need = (what === "panel" ? AA_TEXT : AA_LARGE) * (1 + COMPLIANCE.contrastMargin);
  if (best && best.r >= need) {
    return what === "panel"
      ? `Use ${best.p.name} for the panel (${ratio(Math.floor(best.r * 100) / 100)} with the words)`
      : `Use ${best.p.name} for the button (${ratio(Math.floor(best.r * 100) / 100)} against the panel)`;
  }
  return "Add a darker or a lighter colour to the palette, so the words can stand further apart from their panel";
}

// ---------------------------------------------------------------- legal lines

const flat = (s: string) => normaliseText(foldText(s)).toLowerCase().replace(/[.\s]+$/, "");

/**
 * Every legal line the kit has for the ad's language is drawn. A drawn ad
 * carries its words' legal lines as they were when the words were written (or
 * translated), so a line added to the kit since, or a language with none, is
 * a fail. `kitLines` null: the brand has no legal lines for this language at
 * all (a language without its own lines while English has some).
 */
export function legalRule(drawn: string[], kitLines: string[] | null, english: string[], langName: string, isEnglish: boolean, where: Where): Finding {
  const expected = kitLines ?? [];
  if (!isEnglish && (kitLines === null || kitLines.length === 0) && english.length > 0) {
    return finding(
      "legal",
      where,
      "fail",
      `The brand has no ${langName} legal lines, so this ad can't carry them.`,
      `Add the legal lines in ${langName} on the Languages page`,
      `legal lines missing in ${langName}`,
    );
  }
  const have = new Set(drawn.map(flat));
  const missing = expected.filter((l) => !have.has(flat(l)));
  if (missing.length) {
    return finding(
      "legal",
      where,
      "fail",
      `${missing.length === 1 ? "A legal line is" : `${missing.length} legal lines are`} missing in ${langName}: ${join(missing.map(quote))}.`,
      isEnglish
        ? "Write new words for this ad (New words): new words carry the brand's legal lines as they are now"
        : `Add the legal lines in ${langName} on the Languages page, then translate this ad again`,
      `a legal line missing in ${langName}`,
    );
  }
  if (expected.length === 0 && drawn.length === 0) {
    return finding("legal", where, "pass", `The brand has no legal line for ${langName}, so none is drawn.`, null, "legal lines");
  }
  return finding("legal", where, "pass", `Every legal line for ${langName} is drawn (${drawn.length}).`, null, "legal lines");
}

// ---------------------------------------------------------------- banned terms

/**
 * None of the kit's banned terms (the language's list and the English one) in
 * the words. The edit checks refuse a banned term when words are written, so
 * this finds a term added to the kit after the ad was made. Matched as the
 * copy checks match (word endings, hyphens, accents folded).
 */
export function bannedRule(words: { headline: string; body: string; cta: string }, terms: string[], langName: string, where: Where): Finding {
  const fields: [string, string][] = [
    ["headline", words.headline],
    ["body", words.body],
    ["button", words.cta],
  ];
  const found: { term: string; field: string }[] = [];
  for (const t of terms) {
    const term = normaliseText(t);
    if (!term) continue;
    for (const [field, text] of fields) {
      if (containsTerm(foldText(text), foldText(term))) {
        found.push({ term, field });
        break;
      }
    }
  }
  if (found.length === 0) {
    return finding("banned", where, "pass", terms.length ? `None of the kit's ${terms.length} banned terms is in the ${langName} words.` : `The kit has no banned terms for ${langName}.`, null, "banned terms");
  }
  const unique = [...new Set(found.map((f) => f.term))];
  return finding(
    "banned",
    where,
    "fail",
    `${found.map((f) => `The banned term ${quote(f.term)} is in the ${langName} ${f.field}`).join(". ")}.`,
    `Remove ${join(unique.map(quote))}`,
    `banned term ${join(unique.map((t) => `'${t}'`))} in ${langName}`,
  );
}

// ---------------------------------------------------------------- logo safe zone

/** The gap between two boxes (0 when they touch or overlap). */
export function gapBetween(a: Box, b: Box): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
  return Math.max(dx, dy);
}

/** Whether two boxes touch or overlap. */
export function touches(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** The logo's clear space as a share of the shorter side: to the nearest edge and the nearest word. Null without a logo. */
export function logoClearance(boxes: AdBoxes): { edge: number; words: number; touching: boolean; short: number } | null {
  if (!boxes.logo) return null;
  const m = boxes.logo.mark;
  const { width: W, height: H } = boxes.canvas;
  const short = Math.min(W, H);
  const edge = Math.min(m.x, m.y, W - m.x - m.width, H - m.y - m.height) / short;
  const words = boxes.words.length ? Math.min(...boxes.words.map((w) => gapBetween(m, w))) / short : Infinity;
  return { edge, words, touching: boxes.words.some((w) => touches(m, w)), short };
}

/** The logo's status by its clearance alone (for suggesting another layout). */
export function logoStatus(boxes: AdBoxes): Status {
  const c = logoClearance(boxes);
  if (!c) return "na";
  const t = COMPLIANCE.logoClearSpace;
  const least = Math.min(c.edge, c.words);
  if (c.touching || least < t.review) return "fail";
  if (least < t.pass) return "review";
  return "pass";
}

/**
 * Clear space around the logo, from every edge of the canvas and from every
 * word: at least 4% of the shorter side passes, 2% to 4% is review, under 2%
 * or touching words fails. `better`: layouts of this size whose logo passes,
 * for the fix.
 */
export function logoRule(boxes: AdBoxes, better: string[], where: Where): Finding {
  const c = logoClearance(boxes);
  if (!c) return finding("logo", where, "na", "The brand has no logo, so there is no clear space to check.", null, "logo clear space");
  const status = logoStatus(boxes);
  const t = COMPLIANCE.logoClearSpace;
  const words = Number.isFinite(c.words) ? `, ${pct(c.words)} from the nearest word` : "";
  const measured = `The logo is ${pct(c.edge)} of the shorter side from the nearest edge${words}.`;
  if (status === "pass") return finding("logo", where, "pass", `${measured} At least ${pct(t.pass)} passes.`, null, "logo clear space");
  const fix = better.length ? `Use the ${better[0]} layout` : "Use a smaller logo";
  if (c.touching) return finding("logo", where, "fail", `The logo touches the words. ${measured}`, fix, "the logo touches the words");
  if (status === "fail") return finding("logo", where, "fail", `${measured} Under ${pct(t.review)} fails.`, fix, `logo clear space ${pct(Math.min(c.edge, c.words))}`);
  return finding("logo", where, "review", `${measured} ${pct(t.review)} to ${pct(t.pass)} needs a look.`, fix, `logo clear space ${pct(Math.min(c.edge, c.words))}`);
}

// ---------------------------------------------------------------- text density

/** How much of the canvas the words cover (each drawn line's box; the simulated label is Studio's, not the ad's). */
export function wordShare(boxes: AdBoxes): number {
  const area = boxes.words.reduce((sum, w) => sum + w.width * w.height, 0);
  return area / (boxes.canvas.width * boxes.canvas.height);
}

/**
 * Words cover 25% or less of a social ad: pass; 25% to 40%: review; over 40%:
 * fail. Not applied to banners (Q2). The fix estimates how many body words to
 * cut, from the body's own area per word.
 */
export function densityRule(boxes: AdBoxes, channel: string, where: Where): Finding {
  if (channel === "display") {
    return finding("density", where, "na", "Not applied to banners: their words naturally fill them.", null, "text density");
  }
  const t = COMPLIANCE.textDensity;
  const share = wordShare(boxes);
  const measured = `The words cover ${pct(share)} of the ad.`;
  if (share <= t.pass) return finding("density", where, "pass", `${measured} Up to ${pct(t.pass)} passes.`, null, "text density");
  const bodyBoxes = boxes.words.filter((w) => w.part === "body");
  const bodyWords = bodyBoxes.reduce((n, w) => n + (w.text.match(/\S+/g)?.length ?? 0), 0);
  const bodyArea = bodyBoxes.reduce((s, w) => s + w.width * w.height, 0);
  const excess = (share - t.pass) * boxes.canvas.width * boxes.canvas.height;
  const fix = bodyWords > 0 && bodyArea > 0 ? `Shorten the body by about ${Math.max(1, Math.ceil(excess / (bodyArea / bodyWords)))} words` : "Shorten the words";
  if (share > t.fail) return finding("density", where, "fail", `${measured} Over ${pct(t.fail)} fails.`, fix, `words cover ${pct(share)}`);
  return finding("density", where, "review", `${measured} ${pct(t.pass)} to ${pct(t.fail)} needs a look.`, fix, `words cover ${pct(share)}`);
}

// ---------------------------------------------------------------- 9:16 platform zones

/** The 9:16 story: the only size the platform-zone rule applies to (Q7). */
export const STORY: SizeId = "1080x1920";

/**
 * In a 9:16 story, no words, button or logo in the top 14% or bottom 20% of
 * the height (the platforms' own controls): inside a band fails, within 4% of
 * one is review. Card keeps clear of them (layouts.tsx), so it is the fix.
 * Null for any other size.
 */
export function platformRule(boxes: AdBoxes, size: SizeId, layout: { drawn: string; ownIsCard: boolean }, where: Where): Finding | null {
  if (size !== STORY) return null;
  const H = boxes.canvas.height;
  const z = COMPLIANCE.platformZones;
  const parts: { what: string; box: Box }[] = [
    ...boxes.words.map((w) => ({ what: w.part === "cta" ? "the button" : w.part === "legal" ? "the legal lines" : `the ${w.part}`, box: w as Box })),
    { what: "the button", box: boxes.button },
    ...(boxes.logo ? [{ what: "the logo", box: boxes.logo.mark }] : []),
  ];
  const topEdge = z.top * H;
  const bottomEdge = (1 - z.bottom) * H;
  const inside = parts.filter((p) => p.box.y < topEdge || p.box.y + p.box.height > bottomEdge);
  const near = parts.filter((p) => p.box.y < topEdge + z.near * H || p.box.y + p.box.height > bottomEdge - z.near * H);
  const names = (list: typeof parts) => join([...new Set(list.map((p) => p.what))]);
  const fix = layout.drawn === "card" ? "Shorten the words" : layout.ownIsCard ? "Shorten the words, so the Card layout can hold them in a 9:16 story" : "Use the Card layout";
  const bands = `the top ${pct(z.top)} or bottom ${pct(z.bottom)}`;
  if (inside.length) {
    return finding("platform", where, "fail", `${capitalise(names(inside))} ${inside.length === 1 ? "is" : "are"} in ${bands} of the story, where the platforms' own controls sit.`, fix, "words in the 9:16 platform zones");
  }
  if (near.length) {
    return finding("platform", where, "review", `${capitalise(names(near))} ${near.length === 1 ? "is" : "are"} within ${pct(z.near)} of ${bands} of the story.`, fix, "words near the 9:16 platform zones");
  }
  return finding("platform", where, "pass", `No words or logo in ${bands} of the story, or within ${pct(z.near)} of them.`, null, "9:16 platform zones");
}

// ---------------------------------------------------------------- don't rules and the simulated label

/** A don't rule's key: stable for its words, so editing the rule makes it a new finding. */
export function dontKey(rule: string): string {
  return `dont:${createHash("sha256").update(normaliseText(rule)).digest("hex").slice(0, 16)}`;
}

/** Each of the kit's don't rules, once per ad, for a person to confirm: no code can check them. */
export function dontRules(rules: string[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const raw of rules) {
    const rule = normaliseText(raw);
    if (!rule) continue;
    const key = dontKey(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding("dont", { size: null, lang: null }, "review", "No code can check this rule. A person confirms the ad keeps it, in every size and language.", rule, `don't rule ${quote(rule.length > 60 ? `${rule.slice(0, 57)}...` : rule)}`, key));
  }
  return out;
}

/** The "Simulated image" label is drawn on a simulated picture (the renderer refuses otherwise). */
export function simulatedRule(simulated: boolean, where: Where): Finding {
  return simulated
    ? finding("simulated", where, "pass", "The picture is simulated, and the ad says \"Simulated image\".", null, "simulated label")
    : finding("simulated", where, "pass", "The picture is not simulated, so no label is needed.", null, "simulated label");
}

// ---------------------------------------------------------------- decisions

export type Decision = { decision: "accept" | "reject"; note: string | null; decidedBy: string; decidedByName: string; decidedAt: Date };

/** A finding with its hash and any decision a person made on it (only while the hash is unchanged). */
export type Judged = Finding & {
  hash: string;
  decision: Decision | null;
  /** What counts: pass and not applied pass; an accepted review passes; a rejected review fails; an open review waits. */
  outcome: "pass" | "accepted" | "review" | "fail";
};

/** The finding's hash: what it says and what it is about (the drawing's ETag), so a redraw or an edit makes it new. */
export function findingHash(f: Finding, about: string): string {
  return createHash("sha256").update(JSON.stringify([f.key, f.size, f.lang, f.status, f.reason, about])).digest("hex");
}

export function judge(f: Finding, hash: string, decision: Decision | null): Judged {
  const usable = f.status === "review" ? decision : null;
  const outcome: Judged["outcome"] =
    f.status === "fail" ? "fail" : f.status === "review" ? (usable?.decision === "accept" ? "accepted" : usable?.decision === "reject" ? "fail" : "review") : "pass";
  return { ...f, hash, decision: usable, outcome };
}

export type Tally = { pass: number; review: number; fail: number; accepted: number };

export function tally(list: Judged[]): Tally {
  const t: Tally = { pass: 0, review: 0, fail: 0, accepted: 0 };
  for (const f of list) t[f.outcome === "accepted" ? "accepted" : f.outcome]++;
  return t;
}

/** The pill: Fails, N to review, or Passes. */
export function pillOf(t: Tally): { tone: "pass" | "review" | "fail"; label: string } {
  if (t.fail > 0) return { tone: "fail", label: "Fails" };
  if (t.review > 0) return { tone: "review", label: `${t.review} to review` };
  return { tone: "pass", label: "Passes" };
}

/** Why a file is left out of the pack, or null: "Fails: ..." first, else "Awaiting review: <rule>". */
export function leftOutReason(list: Judged[]): string | null {
  const fails = list.filter((f) => f.outcome === "fail");
  if (fails.length) {
    return `Fails: ${join([...new Set(fails.map((f) => (f.status === "review" ? `${f.short}, marked not acceptable by ${f.decision?.decidedByName ?? "a person"}` : f.short)))])}.`;
  }
  const open = list.filter((f) => f.outcome === "review");
  if (open.length) return `Awaiting review: ${join([...new Set(open.map((f) => (f.rule === "dont" ? f.short : f.name.toLowerCase())))])}.`;
  return null;
}
