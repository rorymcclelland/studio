import { normaliseKitText } from "@/lib/context/keys";
import type { BriefCore, StoredBrief } from "./schema";

// S3-2: the evidence checks, in code (rule 1). They run on every agent draft
// and revision (with one repair) and on every hand edit.

export type EvidenceItem = { ref: string; kind: string; title: string; text: string };

export type KitLists = { legalLines: string[]; bannedTerms: string[]; dontRules: string[]; evidenceClaims: string[] };

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Numbers in a text, without thousands separators ("5,116" and "5116" match). */
export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""));
}

function textFields(b: BriefCore): { where: string; text: string; cites?: string[] }[] {
  return [
    { where: "the title", text: b.title },
    { where: "the summary", text: b.summary },
    { where: "the story", text: b.story },
    ...b.insights.map((i, n) => ({ where: `insight ${n + 1}`, text: i.text, cites: i.cites })),
    ...b.audiences.map((a, n) => ({ where: `audience ${n + 1}`, text: a.why })),
    ...b.channels.map((c) => ({ where: `the ${c.channel} role`, text: c.role })),
    { where: "the KPI target", text: b.kpi.target ?? "" },
  ];
}

function containsTerm(text: string, term: string): boolean {
  const t = normaliseKitText(term);
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}

/**
 * Problems with a brief's evidence. `refs` are tags for a model reply or item
 * ids for a stored brief; `objective` numbers are allowed anywhere.
 * Hand edits pass allowUnsourcedNumbers: a person may type a figure, and the
 * page marks it as not from the context instead.
 */
export function evidenceProblems(
  brief: BriefCore,
  context: EvidenceItem[],
  kit: KitLists,
  opts: { objective: string; allowUnsourcedNumbers?: boolean },
): string[] {
  const problems: string[] = [];
  const byRef = new Map(context.map((c) => [c.ref, c]));
  const segments = context.filter((c) => c.kind === "segment");

  brief.insights.forEach((ins, n) => {
    for (const c of ins.cites) if (!byRef.has(c)) problems.push(`insight ${n + 1} cites ${c}, which is not in the context`);
  });
  for (const [n, a] of brief.audiences.entries()) {
    const item = byRef.get(a.segmentRef);
    if (!item) problems.push(`audience ${n + 1} is ${a.segmentRef}, which is not in the context`);
    else if (item.kind !== "segment") problems.push(`audience ${n + 1} (${a.segmentRef}) is not a segment`);
  }
  if (segments.length > 0 && brief.audiences.length === 0) problems.push("choose at least one audience from the segments in the context");
  if (segments.length === 0 && brief.audiences.length > 0) problems.push("there are no segments in the context, so the brief can't name an audience");

  if (!opts.allowUnsourcedNumbers) {
    for (const f of unsourcedNumbers(brief, context, opts.objective)) {
      problems.push(`${f.where} says ${f.number}, which no ${f.cited ? "cited item" : "context item"} contains; use only figures from the context`);
    }
  }

  for (const f of textFields(brief)) {
    for (const term of kit.bannedTerms) if (containsTerm(f.text, term)) problems.push(`${f.where} uses the banned term "${term}"`);
    for (const claim of kit.evidenceClaims) {
      if (containsTerm(f.text, claim)) problems.push(`${f.where} claims "${claim}", which needs evidence the context does not hold`);
    }
  }
  return problems;
}

/** Figures in the brief that the context (or, for an insight, its cited items) does not contain. */
export function unsourcedNumbers(
  brief: BriefCore,
  context: EvidenceItem[],
  objective: string,
): { where: string; number: string; cited: boolean }[] {
  const byRef = new Map(context.map((c) => [c.ref, c]));
  const all = new Set(context.flatMap((c) => numbersIn(`${c.title} ${c.text}`)));
  const fromObjective = new Set(numbersIn(objective));
  const out: { where: string; number: string; cited: boolean }[] = [];
  for (const f of textFields(brief)) {
    const pool = f.cites
      ? new Set(f.cites.flatMap((c) => (byRef.get(c) ? numbersIn(`${byRef.get(c)!.title} ${byRef.get(c)!.text}`) : [])))
      : all;
    for (const n of numbersIn(f.text)) {
      if (!pool.has(n) && !fromObjective.has(n)) out.push({ where: f.where, number: n, cited: !!f.cites });
    }
  }
  return out;
}

/** The kit's lists a stored brief must carry: every legal line, and every banned term and don't rule to avoid. */
export function kitListsFor(kit: KitLists): Pick<StoredBrief, "mustInclude" | "avoid"> {
  return { mustInclude: [...kit.legalLines], avoid: [...kit.bannedTerms, ...kit.dontRules] };
}

/** Problems with a stored brief's kit lists (a hand edit can't drop a legal line). */
export function kitListProblems(brief: StoredBrief, kit: KitLists): string[] {
  const have = new Set(brief.mustInclude.map(normaliseKitText));
  return kit.legalLines.filter((l) => !have.has(normaliseKitText(l))).map((l) => `the legal line "${l}" is missing`);
}
