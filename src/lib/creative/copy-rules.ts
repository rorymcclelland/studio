import { z } from "zod";
import { containsTerm, figuresIn, figureSupported, quantityInWords, type Figure } from "@/lib/brief/checks";
import { undeclaredNames } from "@/lib/agents/market";
import { normaliseKitText } from "@/lib/context/keys";

// S5-2: what a copy set is, the channel limits, and the checks in code that
// every set passes, whether the Copy agent wrote it (one repair) or a person
// edited it (the same checks, except that a person may type a figure).

/** The channels the Copy agent writes for. Out-of-home is a brief channel it skips (with a note). */
export const COPY_CHANNELS = ["paid social", "display", "search", "email", "app push"] as const;
export type CopyChannel = (typeof COPY_CHANNELS)[number];

/** Character limits per channel and field, as agreed in the Sprint 5 refinement. */
export const CHANNEL_LIMITS = {
  "paid social": { headline: 40, body: 125, cta: 20 },
  // The refinement gives display a headline and body; its call to action follows paid social's.
  display: { headline: 30, body: 60, cta: 20 },
  search: { headline: 30, description: 90 },
  email: { subject: 60, preview: 90 },
  "app push": { title: 40, body: 110 },
} as const satisfies Record<CopyChannel, Record<string, number>>;

/** Alternatives per audience: paid social and display get three, the rest one set. */
export const SETS_PER_AUDIENCE: Record<CopyChannel, number> = { "paid social": 3, display: 3, search: 1, email: 1, "app push": 1 };
export const SEARCH_HEADLINES = 3;
export const SEARCH_DESCRIPTIONS = 2;

// The model's strings may run long so the checks can name the overrun; hand edits get the real limit.
const SLACK = 400;
const text = (max: number) => z.string().trim().min(2, "This can't be empty.").max(max, `Keep this to ${max} characters or fewer.`);

function shapes(strict: boolean) {
  const t = (field: number) => text(strict ? field : SLACK);
  const ad = (l: { headline: number; body: number; cta: number }) => z.object({ headline: t(l.headline), body: t(l.body), cta: t(l.cta) }).strict();
  return {
    "paid social": ad(CHANNEL_LIMITS["paid social"]),
    display: ad(CHANNEL_LIMITS.display),
    search: z
      .object({
        headlines: z.array(t(CHANNEL_LIMITS.search.headline)).length(SEARCH_HEADLINES, `Write ${SEARCH_HEADLINES} headlines.`),
        descriptions: z.array(t(CHANNEL_LIMITS.search.description)).length(SEARCH_DESCRIPTIONS, `Write ${SEARCH_DESCRIPTIONS} descriptions.`),
      })
      .strict(),
    email: z.object({ subject: t(CHANNEL_LIMITS.email.subject), preview: t(CHANNEL_LIMITS.email.preview) }).strict(),
    "app push": z.object({ title: t(CHANNEL_LIMITS["app push"].title), body: t(CHANNEL_LIMITS["app push"].body) }).strict(),
  };
}

/** The model's copy shapes (loose lengths; the checks enforce the limits with named problems). */
export const MODEL_COPY = shapes(false);
/** A person's copy shapes, with the real limits, for field-by-field errors in the editor. */
export const EDIT_COPY = shapes(true);

export type AdCopy = z.infer<(typeof MODEL_COPY)["paid social"]>;
export type SearchCopy = z.infer<(typeof MODEL_COPY)["search"]>;
export type EmailCopy = z.infer<(typeof MODEL_COPY)["email"]>;
export type PushCopy = z.infer<(typeof MODEL_COPY)["app push"]>;
export type CopyByChannel = { "paid social": AdCopy; display: AdCopy; search: SearchCopy; email: EmailCopy; "app push": PushCopy };
export type AnyCopy = CopyByChannel[CopyChannel];

export type CopyField = { field: string; label: string; text: string; limit: number; cta: boolean };

/** A set's text fields with their limits, in display order ("headlines.0" for the first search headline). */
export function fieldsOf(channel: CopyChannel, copy: AnyCopy): CopyField[] {
  const f = (field: string, label: string, value: string, limit: number, cta = false): CopyField => ({ field, label, text: value, limit, cta });
  switch (channel) {
    case "paid social":
    case "display": {
      const c = copy as AdCopy;
      const l = CHANNEL_LIMITS[channel];
      return [f("headline", "headline", c.headline, l.headline), f("body", "body", c.body, l.body), f("cta", "call to action", c.cta, l.cta, true)];
    }
    case "search": {
      const c = copy as SearchCopy;
      return [
        ...c.headlines.map((h, i) => f(`headlines.${i}`, `headline ${i + 1}`, h, CHANNEL_LIMITS.search.headline)),
        ...c.descriptions.map((d, i) => f(`descriptions.${i}`, `description ${i + 1}`, d, CHANNEL_LIMITS.search.description)),
      ];
    }
    case "email": {
      const c = copy as EmailCopy;
      return [f("subject", "subject", c.subject, CHANNEL_LIMITS.email.subject), f("preview", "preview text", c.preview, CHANNEL_LIMITS.email.preview)];
    }
    case "app push": {
      const c = copy as PushCopy;
      return [f("title", "title", c.title, CHANNEL_LIMITS["app push"].title), f("body", "body", c.body, CHANNEL_LIMITS["app push"].body)];
    }
  }
}

/** What the checks need to know about the brand and the brief. */
export type CopyRules = {
  brandName: string;
  products: string[];
  places: string[];
  bannedTerms: string[];
  evidenceClaims: string[];
  /** Real companies the brand's market notes name (S4-3, rule 2). */
  realNames: string[];
  legalLines: string[];
  /** Figures in the brief's cited items (its insights' sources and its audiences' segments). */
  pool: Figure[];
};

/** The text a brief's evidence pool is built from: each cited item's title and text. */
export function evidencePool(items: { title: string; text: string }[]): Figure[] {
  return items.flatMap((i) => figuresIn(`${i.title}. ${i.text}`));
}

const showFigure = (f: Figure) => (f.unit === "£" ? `£${f.value}` : f.unit === "%" ? `${f.value}%` : f.value);

/** Figures in a text that the pool doesn't hold, as written for people ("20%", "£45"). */
export function unsupportedFigures(text: string, pool: Figure[]): string[] {
  return figuresIn(text).filter((f) => !figureSupported(f, pool)).map(showFigure);
}

// Q8, testimonials refused. Copy may not present anyone's words as a quote:
//  1. No quotation marks: straight or curly double quotes, low and angle quotes,
//     or single quotes used as quotation marks (an opening ' or ‘ at the start
//     of a word, closed later). Apostrophes ("don't", "savers' pots") are fine.
//  2. No first-person singular voice (I, I'm, I've, I'd, I'll, me, my, mine,
//     myself): the brand speaks as "we" to "you", so "I" reads as a customer's
//     own words. A call to action is the reader's own button, so "Start my
//     plan" and "Show me how" are allowed there.
//  3. No words attributed to a person: a dash and a name at the end ("— Priya,
//     Leeds"), a person or customer who says, said or told us something
//     ("Priya says", "our customers say", "one saver told us"), or star ratings.
//     The brand's own name after a dash is a sign-off, not an attribution.
const DOUBLE_QUOTES = /["“”„‟«»‹›]/;
const SINGLE_QUOTED = /(?:^|[\s([{–—-])['‘](?=[^\s'‘’])[\s\S]*?[^\s]['’](?=$|[\s.,!?;:)\]}–—-])/;
// Word edges by Unicode letters, not ASCII \b: the same check runs on translations (C7-2), where "même" or
// "cómeme" end in "me" after an accented letter that \b counts as a gap (found by the C7-3 demo pack).
const FIRST_PERSON = /(?<![\p{L}\p{M}\p{N}_])(?:I(?:['’](?:m|ve|d|ll))?|me|my|mine|myself)(?![\p{L}\p{M}\p{N}_])/iu;
const ATTRIBUTION = /(?:^|\s)(?:—|–|-{1,2}|~)\s*([A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*)?)(?:\s*,\s*[\p{L}\d][\p{L}\d\s]*)?\s*$/u;
const SPEAKER = /\b(customers?|members?|users?|walkers?|savers?|shoppers?|reviewers?|buyers?|parents?|people|someone|everyone|one of (?:you|them|us)|[A-Z][\p{L}'’-]+)\s+(?:(?:have|has|all|often|always|keep|kept)\s+)?(?:say|says|said|tell us|tells us|told us|write|writes|wrote|swear by|swears by|rave about|raves about)\b/gu;
// After a dash, a month or day is a date, not a person ("Come back - January").
const CALENDAR = "january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday today tomorrow".split(" ");
const STARS = /[★☆⭐]|\b(?:five|four|5|4)[- ]stars?\b/i;

export function voiceProblem(textValue: string, opts: { cta: boolean; own: string[] }): string | null {
  if (DOUBLE_QUOTES.test(textValue) || SINGLE_QUOTED.test(textValue)) {
    return "has quotation marks; copy may not quote anyone (no testimonials), so say it in the brand's own words";
  }
  if (!opts.cta) {
    const m = FIRST_PERSON.exec(textValue);
    if (m) return `reads as a customer's own words ("${m[0]}"); copy speaks as the brand to "you", and never invents a customer's voice`;
  }
  const own = new Set([...opts.own, ...CALENDAR].map((w) => w.toLowerCase()));
  const isOwn = (name: string) => name.split(/\s+/).every((w) => own.has(w.toLowerCase().replace(/['’]s$/, "")));
  const a = ATTRIBUTION.exec(textValue);
  if (a && !isOwn(a[1])) return `attributes words to a person ("${a[0].trim()}"); no testimonials`;
  for (const s of textValue.matchAll(SPEAKER)) {
    if (!isOwn(s[1])) return `reports what someone said ("${s[0]}"); no testimonials or customer quotes`;
  }
  if (STARS.test(textValue)) return "shows a rating; no reviews or testimonials";
  return null;
}

const plural = (label: string) => (label === "call to action" ? "calls to action" : label === "preview text" ? "preview texts" : `${label}s`);

const flat = (s: string) => normaliseKitText(s).toLowerCase().replace(/[.\s]+$/, "");

/**
 * Problems with one set's words. `where` begins each problem ("paid social set
 * 2 for A1"). A person's edit passes allowFigures: a typed figure is kept and
 * marked as added by a person instead.
 */
export function setProblems(channel: CopyChannel, copy: AnyCopy, rules: CopyRules, opts: { where: string; allowFigures?: boolean }): string[] {
  const problems: string[] = [];
  const own = [rules.brandName, ...rules.products, ...rules.places].join(" ").match(/[\p{L}0-9']+/gu) ?? [];
  for (const f of fieldsOf(channel, copy)) {
    const at = `${opts.where} ${f.label}`;
    if (f.text.length > f.limit) problems.push(`${at} is ${f.text.length} characters; ${channel} ${plural(f.label.replace(/ \d$/, ""))} are at most ${f.limit}`);
    if (!opts.allowFigures) {
      for (const n of unsupportedFigures(f.text, rules.pool)) {
        problems.push(`${at} says ${n}, which none of the brief's cited items contains; use only figures from the brief's evidence, written as they are there`);
      }
    }
    const q = quantityInWords(f.text);
    if (q) problems.push(`${at} says "${q}"; quantities in words can't be checked, so use only figures from the brief's evidence${opts.allowFigures ? " (a figure you type is marked as added by a person)" : ""}`);
    for (const t of rules.bannedTerms) if (containsTerm(f.text, t)) problems.push(`${at} uses the banned term "${t}"`);
    for (const c of rules.evidenceClaims) if (containsTerm(f.text, c)) problems.push(`${at} claims "${c}", which needs evidence the brief does not hold`);
    for (const n of rules.realNames) {
      if (containsTerm(f.text, n)) problems.push(`${at} names ${n}, a real company from the market notes; name no other company`);
    }
    for (const n of undeclaredNames(f.text, rules.realNames, { brandName: rules.brandName, category: "", products: rules.products, places: rules.places })) {
      problems.push(`${at} names "${n}", which looks like another brand; name only ${rules.brandName} and its products, and write in sentence case`);
    }
    const v = voiceProblem(f.text, { cta: f.cta, own });
    if (v) problems.push(`${at} ${v}`);
    for (const l of rules.legalLines) {
      if (flat(l).length >= 12 && flat(f.text).includes(flat(l))) problems.push(`${at} repeats a legal line; code adds the legal lines under every set, so leave them out`);
    }
  }
  if (channel === "search") {
    const c = copy as SearchCopy;
    if (new Set(c.headlines.map(flat)).size < c.headlines.length) problems.push(`${opts.where} repeats a headline; write ${SEARCH_HEADLINES} different ones`);
    if (new Set(c.descriptions.map(flat)).size < c.descriptions.length) problems.push(`${opts.where} repeats a description; write ${SEARCH_DESCRIPTIONS} different ones`);
  }
  return problems;
}

/** The figures a person typed that the brief's evidence doesn't hold, by field, so the page can mark them. */
export function figuresAddedByPerson(channel: CopyChannel, copy: AnyCopy, pool: Figure[]): { field: string; figure: string }[] {
  return fieldsOf(channel, copy).flatMap((f) => unsupportedFigures(f.text, pool).map((figure) => ({ field: f.field, figure })));
}

// C7-2: checks for a translation (the Localise agent's words, one repair).
// The same rules as English words where they carry over: the channel limits
// in characters (a soft hyphen is a break point, not a character), figures
// only as the English words have them, the banned terms for the language and
// the English ones (a phrase left in English is still banned), the claims
// that need evidence, real company names from the market notes, no
// quotation marks or customer's voice (first person in the language too), and
// no legal line repeated. The patterns for attributions, quantities in words
// and capitalised names were written for English and catch less in other
// languages (stated in the "Machine translation" badge); capitalised names are
// not checked in German, where every noun has a capital.

const SHY_CHAR = "­";
const visible = (s: string) => s.split(SHY_CHAR).join("");

/** Folds accents and ß so terms match whatever the keyboard ("Rücksendung", "rucksendung"). */
export function foldText(s: string): string {
  return visible(s).normalize("NFD").replace(/\p{M}+/gu, "").replace(/ß/g, "ss").replace(/[’‘]/g, "'");
}

// Word edges are Unicode letters (commit 34ad87a), so "même" isn't "me". French
// elides je and me before a vowel ("J'ai", "m'a"), with a straight or curly
// apostrophe: the elided form is followed by a letter, not a word edge.
const FIRST_PERSON_BY_LANG: Record<string, RegExp> = {
  "fr-FR": /(?:^|[^\p{L}])(?:(?:je|moi|mon|ma|mes|me)(?=[^\p{L}]|$)|[jm]['’](?=\p{L}))/iu,
  "de-DE": /(?:^|[^\p{L}])(?:ich|mich|mir|mein|meine|meinen|meinem|meiner|meines|meins)(?=[^\p{L}]|$)/iu,
  "es-ES": /(?:^|[^\p{L}])(?:yo|mí|mi|mis|me|conmigo|mío|mía|míos|mías)(?=[^\p{L}]|$)/iu,
};

export type TranslationRules = {
  lang: string;
  /** "German", for problems ("the German headline ..."). */
  langName: string;
  brandName: string;
  products: string[];
  places: string[];
  /** The language's banned terms (from the kit, written by a person) and the English ones. */
  bannedTerms: string[];
  evidenceClaims: string[];
  realNames: string[];
  /** The language's legal lines: code attaches them, the words never repeat them. */
  legalLines: string[];
  /** Figures in the English words: a translation keeps the same figures and adds none. */
  pool: Figure[];
};

/** Problems with one translated set's words. `where` names the set ("the German paid-social set"). */
export function translationProblems(channel: CopyChannel, copy: AnyCopy, rules: TranslationRules, opts: { where: string }): string[] {
  const problems: string[] = [];
  const own = [rules.brandName, ...rules.products, ...rules.places].join(" ").match(/[\p{L}0-9']+/gu) ?? [];
  for (const f of fieldsOf(channel, copy)) {
    const text = visible(f.text);
    const folded = foldText(f.text);
    const at = `${opts.where} ${f.label}`;
    if (text.length > f.limit) problems.push(`${at} is ${text.length} characters; ${channel} ${plural(f.label.replace(/ \d$/, ""))} are at most ${f.limit}`);
    // Values only: the unit is a word in another language ("12 Monaten" for "12 months").
    for (const fig of figuresIn(text)) {
      if (!rules.pool.some((p) => p.value === fig.value)) {
        problems.push(`${at} says ${fig.value}, which the English words don't; keep the English figures as they are and add none`);
      }
    }
    for (const t of rules.bannedTerms) if (containsTerm(folded, foldText(t))) problems.push(`${at} uses the banned term "${t}"`);
    for (const c of rules.evidenceClaims) if (containsTerm(folded, foldText(c))) problems.push(`${at} claims "${c}", which needs evidence the brief does not hold`);
    for (const n of rules.realNames) {
      if (containsTerm(folded, foldText(n))) problems.push(`${at} names ${n}, a real company from the market notes; name no other company`);
    }
    if (rules.lang !== "de-DE") {
      for (const n of undeclaredNames(text, rules.realNames, { brandName: rules.brandName, category: "", products: rules.products, places: rules.places })) {
        problems.push(`${at} names "${n}", which looks like another brand; name only ${rules.brandName} and its products, and write in sentence case`);
      }
    }
    const v = voiceProblem(text, { cta: f.cta, own });
    if (v) problems.push(`${at} ${v}`);
    const mine = FIRST_PERSON_BY_LANG[rules.lang];
    if (!v && !f.cta && mine) {
      const m = mine.exec(text);
      if (m) problems.push(`${at} reads as a customer's own words ("${m[0].trim()}"); copy speaks as the brand to the reader, and never invents a customer's voice`);
    }
    for (const l of rules.legalLines) {
      if (flat(l).length >= 12 && flat(foldText(f.text)).includes(flat(foldText(l)))) problems.push(`${at} repeats a legal line; code adds the legal lines under every set, so leave them out`);
    }
  }
  return problems;
}
