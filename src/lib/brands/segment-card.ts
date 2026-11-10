// U10-7: a segment card shows its name, size and one-line definition; the
// rest of what the store holds waits until the card is opened. A segment's
// body is one string (the Audience agent's description, the counted facts,
// "As of", and the badge sentences; or the customer summary's sentence), so
// this splits it into those parts. Pure, for the page and its tests.

export type SegmentCardParts = {
  /** "1,234 of 5,000 customers (24.7%)" or "1,234 customers (24.7%)"; null when the body has no count. */
  size: string | null;
  /** One sentence saying who is in the segment. */
  definition: string;
  /** The Audience agent's own words about the segment, when it wrote any. */
  description: string | null;
  /** The counted facts after the definition: regions, age bands, categories, median order, consent. */
  facts: string[];
  /** "8 November 2026", when the body says when the data is from. */
  asOf: string | null;
};

const FACT_STARTS = [/^Top regions:/, /^Main age bands:/, /^Most-bought categories:/, /^Median order/, /^[\d.]+% have agreed to marketing\./];
const BADGES = /\s*(Proposed by the Audience agent\.|Simulated data\.)/g;
const AS_OF = /\s*As of ([^.]+)\./;

/** Splits text into sentences at ". " before a capital letter or a digit, keeping the full stops. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9£])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function segmentCardParts(body: string): SegmentCardParts {
  let text = body.replace(BADGES, "").trim();
  const asOfMatch = text.match(AS_OF);
  const asOf = asOfMatch ? asOfMatch[1].trim() : null;
  if (asOfMatch) text = text.replace(AS_OF, "").trim();

  // The Audience agent: "<description> <n> of <m> customers (<p>). <definition> <facts>".
  const counted = text.match(/(\d[\d,]*) of (\d[\d,]*) customers \(([\d.]+%)\)\.\s*/);
  if (counted && counted.index !== undefined) {
    const rest = sentences(text.slice(counted.index + counted[0].length));
    const firstFact = rest.findIndex((s) => FACT_STARTS.some((f) => f.test(s)));
    const defParts = firstFact === -1 ? rest : rest.slice(0, firstFact);
    const facts = firstFact === -1 ? [] : rest.slice(firstFact);
    const definition = defParts.join(" ") || "Customers counted from the customer data.";
    // The card says the definition once, so it leaves the agent's words if they repeat it.
    const description =
      sentences(text.slice(0, counted.index))
        .filter((s) => s !== definition)
        .join(" ") || null;
    return {
      size: `${counted[1]} of ${counted[2]} customers (${counted[3]})`,
      definition,
      description,
      facts,
      asOf,
    };
  }

  // The customer summary: "<n> of <m> customers (<p>) have …" or "<n> customers (<p>) have …".
  const summary = text.match(/^(\d[\d,]* (?:of \d[\d,]* )?customers \([\d.]+%\))\s+([\s\S]*)$/);
  if (summary) {
    const [first, ...others] = sentences(summary[2]);
    return {
      size: summary[1],
      definition: `Customers who ${first ?? ""}`.trim(),
      description: null,
      facts: others,
      asOf,
    };
  }

  // Anything else: its first sentence is the definition.
  const [first, ...others] = sentences(text);
  return { size: null, definition: capitalise(first ?? ""), description: null, facts: others, asOf };
}
