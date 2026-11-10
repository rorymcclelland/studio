import { refusableNames } from "@/lib/brands/own-names";
import { normaliseKitText } from "@/lib/context/keys";
import { undeclaredNames } from "@/lib/text/names";
import { voiceProblem } from "@/lib/text/voice";
import { BRIEF_SECTIONS, type BriefCore, type BriefSection, type StoredBrief } from "./schema";

// S3-2: the evidence checks, in code (rule 1). They run on every agent draft
// and revision (with one repair) and on every hand edit, accepted proposal
// and restore.

export type EvidenceItem = { ref: string; kind: string; title: string; text: string };

export type KitLists = {
  legalLines: string[];
  bannedTerms: string[];
  dontRules: string[];
  evidenceClaims: string[];
  /** S4-3: real companies named in the brand's market notes; they stay in the notes (rule 2). */
  realNames?: string[];
  /** D-2 (Sprint 10b): the brand's own names, such as a parent brand's; never refused as a real company. */
  ownNames?: string[];
  /** Review fix B1 (Sprint 10b): the brand's name, the one name (with its own names) a campaign line may carry. */
  brandName?: string;
};

// A figure with its unit: "£45", "45%", "12 month", "5116 customer", or a bare "37".
// Units matter: "45% of customers" is not supported by a £45.00 price, and
// "12% of lapsed customers" is not supported by "no order in 12 months".
// The unit is the first lower-case word after the figure; up to three capitalised
// words in between are skipped (if no lower-case word follows, the first word is the unit: "12 September"), so "2,000 Quillmoor Money customers" is in customers
// (production check, 26 Oct).
const FIGURE = /(£\s?)?(\d[\d,]*(?:\.\d+)?)(\s?(?:%|[Pp]er\s?cent\b))?(?:\s+(?:(?:[A-Z][\w'’&.-]*\s+){0,3}([a-z]+)|([A-Za-z]+)))?/g;
const STOP = new Set(["of", "in", "and", "or", "to", "the", "a", "an", "on", "at", "for", "by", "with", "from", "as", "is", "are", "was", "were", "have", "has", "than"]);

export type Figure = { value: string; unit: string };

/** A rough stem, the same on both sides: "returns" and "return", "guaranteed" and "guarantee", "months" and "month". */
const stem = (w: string) => {
  const x = w.toLowerCase();
  if (x.length <= 4) return x.replace(/s$/, "");
  return x.replace(/ies$/, "y").replace(/(ing|ed|es|s)$/, "").replace(/e+$/, "");
};

/** Figures in a text, with thousands separators and trailing zero decimals removed. */
export function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const value = m[2].replace(/,/g, "").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    const word = m[4] ?? m[5];
    const unit = m[1] ? "£" : m[3] ? "%" : word && !STOP.has(word.toLowerCase()) ? stem(word.toLowerCase()) : "";
    out.push({ value, unit });
  }
  return out;
}

/** Kept for callers that only need the numbers. */
export function numbersIn(text: string): string[] {
  return figuresIn(text).map((f) => f.value);
}

/** A figure is supported if the pool has the same value with the same unit; a bare figure needs a bare or worded one, never £ or %. */
export function figureSupported(f: Figure, pool: Figure[]): boolean {
  return supported(f, pool);
}

function supported(f: Figure, pool: Figure[]): boolean {
  return pool.some((p) => {
    if (p.value !== f.value) return false;
    if (f.unit === "£" || f.unit === "%" || p.unit === "£" || p.unit === "%") return p.unit === f.unit;
    return f.unit === "" || p.unit === "" || p.unit === f.unit;
  });
}

// Quantities written in words ("half of", "one in four", "twenty per cent") can't be checked, so model text may not use them.
const NUMBER_WORD =
  /\b(?:(?:a\s+)?(?:half|quarter|third)\s+of|(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+in\s+(?:every\s+)?(?:two|three|four|five|six|seven|eight|nine|ten)\b|(?:two|three)\s+(?:thirds|quarters)|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s+(?:per\s?cent|percent)|(?:twice|three times|four times)\s+(?:as|more)|(?:dozens|hundreds|thousands|millions)\s+of)\b/i;

/** A quantity written in words, if the text has one. */
// F-14: loose quantities used as claims ("most are", "the vast majority of
// lapsed customers", "many will"). Superlatives ("our most bought jacket"),
// time ("most of the season") and small amounts ("a few layers") are fine.
const PEOPLE = "customers|people|buyers|users|members|budgeters|britons|brits|borrowers|investors|renters|homeowners|walkers|shoppers|subscribers|households|parents|savers|adults|families|consumers|readers|visitors|clients|owners";
const VERBS = "are|were|have|had|will|would|want|wants|need|needs|buy|buys|bought|say|said|prefer|prefers|use|used|agree|agreed|come|came|return|returned|open|opened|own|live|lapse|lapsed";
const TIME = "season|year|day|week|month|winter|summer|spring|autumn|time|evening|morning|weekend|walk|way";
const QUANT = "most|many|the (?:vast |great |overwhelming )?majority|a (?:large |small |good |significant |growing )?(?:number|proportion|share|minority|majority)|the bulk|hardly any|(?:nearly|almost|virtually) (?:all|everyone|everybody|every customer)";
const QUANTITY_CLAIM = new RegExp(
  `(?<!\\b(?:the|our|their|its|your|his|her)\\s)\\b(?:${QUANT})(?!-)\\s+(?:(?:of\\s+(?!(?:the |this |that |our |its |their )?(?:${TIME})s?\\b))|(?:[a-z]+\\s+){0,2}(?:${PEOPLE})\\b|(?:${VERBS})\\b)` +
    `|\\b(?<!a\\s)few\\s+(?:(?:[a-z]+\\s+){0,2}(?:${PEOPLE})\\b|(?:${VERBS})\\b)` +
    `|\\b(?:lots|plenty|a lot) of\\s+(?:[a-z]+\\s+){0,2}(?:${PEOPLE})\\b` +
    `|\\b(?:nearly|almost|virtually) (?:all|everyone|everybody)\\b`,
  "i",
);

export function quantityInWords(text: string): string | null {
  const plain = text.replace(/\b(?:most|first) of all\b(?!\s+(?:customers|people|buyers|users|members|walkers|shoppers|subscribers|our|the|its|their))/gi, "");
  return NUMBER_WORD.exec(text)?.[0] ?? QUANTITY_CLAIM.exec(plain)?.[0] ?? null;
}

// BUG-4: the check refuses loose quantities about people (F-14, agreed in
// Sprint 4: "most of our lapsed customers" says how many, and nothing can hold
// it to the data), but the Brief agent's prompt named only "half of" and "one
// in four", so the real model kept writing "Many people" and "most of" and was
// refused twice (F-16a, 6 and 7 Nov). The prompt now shows the model these
// phrases and the way round them, from this one list, and a test holds every
// phrase to the check, so the prompt and the check can't drift apart again.
/** Phrases the check refuses, each with a sentence that uses it (the sentence is what the test checks). */
export const LOOSE_QUANTITIES: { phrase: string; sentence: string }[] = [
  { phrase: "most of", sentence: "Most of our lapsed customers stopped after one order." },
  { phrase: "many people", sentence: "Many people look at their money again in January." },
  { phrase: "many of", sentence: "Many of them still have the app installed." },
  { phrase: "a good share of", sentence: "A good share of younger customers budget on their phones." },
  { phrase: "plenty of customers", sentence: "Plenty of customers save a little each month." },
  { phrase: "the majority of", sentence: "The majority of savers use round-ups." },
  { phrase: "few customers", sentence: "Few customers use the Premium plan." },
  { phrase: "nearly all", sentence: "Nearly all of them signed up on the app." },
  { phrase: "half of", sentence: "Half of our walkers come back each winter." },
  { phrase: "one in four", sentence: "One in four customers buys a fleece." },
];

/** How to say it instead, as the prompt and the problem message put it. Each example passes the check. */
export const QUANTITY_INSTEAD = {
  advice: "name the group without saying how much of it there is, or use a figure from the context written as it is there",
  examples: ["Lapsed customers who stopped after one order", "People who look at their money again in January", "Customers aged 25 to 34 who budget on their phones"],
};

/** The problem a quantity in words raises, for the model's one repair. */
export function quantityProblem(where: string, found: string): string {
  return `${where} says "${found.trim()}"; quantities in words can't be checked, so ${QUANTITY_INSTEAD.advice} (for example "${QUANTITY_INSTEAD.examples[0]}")`;
}

type Field = { where: string; section: BriefSection; text: string; cites?: string[] };

function textFields(b: BriefCore): Field[] {
  return [
    { where: "the title", section: "title", text: b.title },
    // D-4: the campaign line, checked like any other words of the brief.
    ...(b.line ? [{ where: "the campaign line", section: "line" as const, text: b.line }] : []),
    { where: "the summary", section: "summary", text: b.summary },
    { where: "the story", section: "story", text: b.story },
    ...b.insights.map((i, n) => ({ where: `insight ${n + 1}`, section: "insights" as const, text: i.text, cites: i.cites })),
    ...b.audiences.map((a, n) => ({ where: `audience ${n + 1}`, section: "audiences" as const, text: a.why })),
    ...b.channels.map((c) => ({ where: `the ${c.channel} role`, section: "channels" as const, text: c.role })),
    { where: "the KPI target", section: "kpi", text: b.kpi.target ?? "" },
  ];
}

/** The brief's own words, for allowing figures a revision keeps. */
export function proseOf(b: BriefCore): string {
  return textFields(b).map((f) => f.text).join(" \n ");
}

const words = (s: string) => s.toLowerCase().replace(/[-‐‑–]/g, " ").match(/[a-z0-9']+/g) ?? [];

/**
 * A banned term matches its phrase with spaces or hyphens, with word endings
 * ("guaranteed return", "risk free"), and, for two- or three-word terms, the
 * same words close together in any order ("returns are guaranteed").
 */
export function containsTerm(text: string, term: string): boolean {
  const t = words(normaliseKitText(term)).map(stem);
  if (t.length === 0) return false;
  const w = words(text).map(stem);
  for (let i = 0; i + t.length <= w.length; i++) if (t.every((x, j) => w[i + j] === x)) return true;
  if (t.length >= 2 && t.length <= 3) {
    const window = t.length + 3;
    for (let i = 0; i < w.length; i++) {
      const slice = w.slice(i, i + window);
      if (t.every((x) => slice.includes(x))) return true;
    }
  }
  return false;
}

/**
 * Problems with a brief's evidence. `refs` are tags for a model reply or item
 * ids for a stored brief; figures in `allowedText` (the objective, and in a
 * revision the current brief's words) are allowed anywhere. Hand edits pass
 * allowUnsourcedNumbers: a person may type a figure, and the page marks it.
 * `sections` limits the checks to those parts (a section revision or edit).
 */
export function evidenceProblems(
  brief: BriefCore,
  context: EvidenceItem[],
  kit: KitLists,
  opts: { objective: string; allowUnsourcedNumbers?: boolean; sections?: BriefSection[] },
): string[] {
  const problems: string[] = [];
  const only = opts.sections ? new Set(opts.sections) : null;
  const checks = (s: BriefSection) => !only || only.has(s);
  const byRef = new Map(context.map((c) => [c.ref, c]));
  const segments = context.filter((c) => c.kind === "segment");

  if (checks("insights")) {
    brief.insights.forEach((ins, n) => {
      for (const c of ins.cites) if (!byRef.has(c)) problems.push(`insight ${n + 1} cites ${c}, which is not in the context`);
    });
  }
  if (checks("audiences")) {
    for (const [n, a] of brief.audiences.entries()) {
      const item = byRef.get(a.segmentRef);
      if (!item) problems.push(`audience ${n + 1} is ${a.segmentRef}, which is not in the context`);
      else if (item.kind !== "segment") problems.push(`audience ${n + 1} (${a.segmentRef}) is not a segment`);
    }
    if (segments.length > 0 && brief.audiences.length === 0) problems.push("choose at least one audience from the segments in the context");
    if (segments.length === 0 && brief.audiences.length > 0) problems.push("there are no segments in the context, so the brief can't name an audience");
  }

  const fields = textFields(brief).filter((f) => checks(f.section));
  if (!opts.allowUnsourcedNumbers) {
    for (const f of unsourcedNumbers(brief, context, opts.objective)) {
      // The campaign line is held to stricter checks below, whoever wrote it.
      if (!checks(f.section) || f.section === "line") continue;
      problems.push(`${f.where} says ${f.number}, which no ${f.cited ? "cited item" : "context item"} contains; use only figures from the context, written as they are there`);
    }
    for (const f of fields) {
      if (f.section === "line") continue;
      const m = quantityInWords(f.text);
      if (m) problems.push(quantityProblem(f.where, m));
    }
  }

  const line = fields.find((f) => f.section === "line");
  if (line) problems.push(...lineProblems(line.text, context, kit));

  for (const f of fields) {
    for (const term of kit.bannedTerms) if (containsTerm(f.text, term)) problems.push(`${f.where} uses the banned term "${term}"`);
    for (const name of refusableNames(kit.realNames ?? [], { name: "", ownNames: kit.ownNames ?? [] })) {
      if (containsTerm(f.text, name)) problems.push(`${f.where} names ${name}, a real company from the market notes; describe it instead ("a large outdoor chain")`);
    }
    for (const claim of kit.evidenceClaims) {
      if (containsTerm(f.text, claim)) problems.push(`${f.where} claims "${claim}", which needs evidence the context does not hold`);
    }
  }
  return problems;
}

/**
 * Review fix B1 (Sprint 10b): a campaign line is every paid-social and display
 * headline, and a person's figure in it would be unmarked in every ad, so it
 * is checked the same way whoever wrote it, even on a hand edit (rules 1 and
 * 2): no figure, even one from the context; no quantity in words; no quote,
 * rating or attribution; and no capitalised name but the brand's own names
 * and products. Banned terms, claims and the market notes' companies are
 * checked with the brief's other words.
 */
export function lineProblems(text: string, context: EvidenceItem[], kit: KitLists): string[] {
  const where = "the campaign line";
  const out: string[] = [];
  const brandNames = [kit.brandName ?? "", ...(kit.ownNames ?? [])].filter(Boolean);
  const products = context.filter((c) => c.kind === "product").map((c) => c.title);
  for (const f of figuresIn(text)) out.push(`${where} says ${show(f)}; a campaign line can't carry a figure, so say it without one`);
  const q = quantityInWords(text);
  if (q) out.push(`${where} says "${q.trim()}"; a campaign line can't carry a quantity, in figures or in words`);
  const own = [...brandNames, ...products].join(" ").match(/[\p{L}0-9']+/gu) ?? [];
  const v = voiceProblem(text, { cta: false, own });
  if (v) out.push(`${where} ${v}; a campaign line can't carry a quote, a rating or anyone else's words`);
  for (const n of undeclaredNames(text, kit.realNames ?? [], { brandName: brandNames.join(" "), category: "", products, places: [] })) {
    out.push(`${where} names "${n}", which looks like another company; a campaign line can't carry another company's name${brandNames.length ? ` (only ${brandNames.join(" or ")})` : ""}`);
  }
  return out;
}

const show = (f: Figure) => (f.unit === "£" ? `£${f.value}` : f.unit === "%" ? `${f.value}%` : f.value);

/** Figures in the brief that the context (or, for an insight, its cited items) does not contain, unit for unit. */
export function unsourcedNumbers(
  brief: BriefCore,
  context: EvidenceItem[],
  allowedText: string,
): { where: string; section: BriefSection; number: string; cited: boolean }[] {
  const byRef = new Map(context.map((c) => [c.ref, c]));
  const all = context.flatMap((c) => figuresIn(`${c.title}. ${c.text}`));
  const allowed = figuresIn(allowedText);
  const out: { where: string; section: BriefSection; number: string; cited: boolean }[] = [];
  for (const f of textFields(brief)) {
    const pool = f.cites ? f.cites.flatMap((c) => (byRef.get(c) ? figuresIn(`${byRef.get(c)!.title}. ${byRef.get(c)!.text}`) : [])) : all;
    for (const n of figuresIn(f.text)) {
      if (!supported(n, pool) && !supported(n, allowed)) out.push({ where: f.where, section: f.section, number: show(n), cited: !!f.cites });
    }
  }
  return out;
}

/** The sections of `next` that differ from `base`. */
export function changedSections(base: BriefCore, next: BriefCore): BriefSection[] {
  return BRIEF_SECTIONS.filter((s) => JSON.stringify(base[s]) !== JSON.stringify(next[s]));
}

/** The kit's lists a stored brief must carry: every legal line, and every banned term and don't rule to avoid. */
export function kitListsFor(kit: KitLists): Pick<StoredBrief, "mustInclude" | "avoid"> {
  return { mustInclude: [...kit.legalLines], avoid: [...kit.bannedTerms, ...kit.dontRules] };
}

/** Problems with a stored brief's kit lists. */
export function kitListProblems(brief: StoredBrief, kit: KitLists): string[] {
  const have = new Set(brief.mustInclude.map(normaliseKitText));
  return kit.legalLines.filter((l) => !have.has(normaliseKitText(l))).map((l) => `the legal line "${l}" is missing`);
}
