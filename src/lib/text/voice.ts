// Copy's voice check (S5-2, Q8), shared by the copy checks and, from Sprint
// 10b (review fix B1), the campaign line's checks. Pure, with no imports.

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
