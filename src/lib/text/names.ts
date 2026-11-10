// Capitalised words that look like names (S4-3), shared by the Market agent's
// notes, the copy checks and, from Sprint 10b (review fix B1), the campaign
// line's checks. Pure, with no imports, so any check may use it.

/** The words a text may capitalise as the brand's own. */
export type NameOwners = { brandName: string; category: string; products: string[]; places: string[] };

// Capitalised words that are not company names: dates, holidays, places, common abbreviations.
const COMMON = new Set(
  (
    "january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday " +
    "spring summer autumn winter christmas easter boxing day new year year's eve black friday cyber monday bank holiday valentine's halloween bonfire night " +
    "uk u.k gb britain british great england english scotland scottish wales welsh ireland irish northern london europe european eu " +
    "north south east west midlands yorkshire humber highlands lake district peak dales cornwall devon cumbria snowdonia " +
    "vat gdp ons ai app apps i a an the this that these those it its our we they " +
    "aer apr isa isas lisa sipp pension energy price cap autumn budget spring statement britons brits brit"
  ).split(" "),
);

// QA, Sprint 10b: ordinary capitalised words for each region set other than
// the UK's (whose words are in COMMON, unchanged), allowed when the brand's
// places are in that set, so a brand with customers in Japan's regions may say
// "Japan", "Japanese" or "Tokyo" without it reading as another brand.
/** Japan's regions, as the simulated-data profile names them (src/lib/demo/profile.ts; a test holds the two lists together). */
export const JAPAN_REGIONS = ["Hokkaido", "Tohoku", "Kanto", "Chubu", "Kansai", "Chugoku", "Shikoku", "Kyushu-Okinawa"] as const;
const REGION_WORDS: { regions: readonly string[]; words: string[] }[] = [
  {
    regions: JAPAN_REGIONS,
    words: [
      ..."japan japanese tokyo osaka kyoto yokohama nagoya sapporo fukuoka kobe hiroshima sendai okinawa".split(" "),
      ...JAPAN_REGIONS.flatMap((r) => [r.toLowerCase(), ...r.toLowerCase().split("-")]),
    ],
  },
];

/** The ordinary words of every region set the brand's places are in. */
export function regionWords(places: readonly string[]): Set<string> {
  const mine = new Set(places.map((p) => p.trim().toLowerCase()));
  return new Set(REGION_WORDS.filter((r) => r.regions.some((x) => mine.has(x.toLowerCase()))).flatMap((r) => r.words));
}

// Ordinary words that open a sentence before a capitalised word.
const STARTERS = new Set(
  (
    "among according after before in on at for with by from since while as across unlike like despite during over under " +
    "some many both each every all one two few several other new its their his her this that these those the a an " +
    "when where if although though but and or so yet meanwhile separately also still recently today last next only even " +
    "more fewer most less nearly almost about around over"
  ).split(" "),
);

/** Proper names in a note (capitalised words not at a sentence start) that are not declared, common or the brand's own words. */
export function undeclaredNames(text: string, declared: string[], input: NameOwners): string[] {
  const own = new Set(
    [input.brandName, input.category, ...input.products, ...input.places]
      .join(" ")
      .toLowerCase()
      .match(/[a-z0-9']+/g) ?? [],
  );
  const places = regionWords(input.places);
  // A hyphenated word ("Kyushu-Okinawa", "North-East") is known when it is, whole, or when each of its parts is:
  // the own words are split at hyphens, so the text's words are judged the same way.
  const knownWord = (w: string) => COMMON.has(w) || own.has(w) || places.has(w);
  const known = (word: string) => {
    const w = word.toLowerCase();
    return knownWord(w) || (w.includes("-") && w.split("-").every((p) => p.length > 0 && knownWord(p)));
  };
  const declaredWords = new Set(declared.join(" ").toLowerCase().match(/[a-z0-9'.&-]+/g) ?? []);
  const out = new Set<string>();
  const capital = (w: string) => /^[A-Z][A-Za-z0-9'.&-]*[A-Za-z0-9]$|^[A-Z]{2,}$/.test(w);
  // Runs of capitalised words are name candidates. A single capitalised word at
  // the start of a sentence is ordinary English; a run of two or more is not.
  for (const sentence of text.split(/(?<=[.!?:;])\s+|\n+/)) {
    // Possessives and hyphenated words are judged by their stem: "YouGov's" is YouGov, "UK-focused" is UK.
    const words = sentence
      .split(/\s+/)
      .filter(Boolean)
      .map((raw) => raw.replace(/^[("'‘“]+|[)"'’”.,!?;:]+$/g, "").replace(/['’]s$/i, "").replace(/-[a-z].*$/, ""));
    let i = 0;
    while (i < words.length) {
      if (!capital(words[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < words.length && capital(words[j + 1])) j++;
      const run = words.slice(i, j + 1);
      // The first word of a sentence is capitalised anyway: alone it is never a name, and an
      // ordinary opening word ("Among UK budgeters") is not part of one.
      const candidate = i === 0 ? (run.length === 1 || STARTERS.has(run[0].toLowerCase()) ? run.slice(1) : run) : run;
      const unexplained = candidate.filter((w) => !known(w));
      const covered = run.some((w) => declaredWords.has(w.toLowerCase()));
      if (unexplained.length > 0 && !covered) out.add(candidate.join(" "));
      i = j + 1;
    }
  }
  return [...out];
}
