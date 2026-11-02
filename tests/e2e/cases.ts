// Every agreed test case, sprint by sprint, with how it is checked (decision
// 0021). Rory signs a sprint off from the demo page (scripts/demo-page.mjs),
// which reads this list and the CI run's results:
//
// - browser: a Playwright test that shows the case. The test carries the
//   annotation { type: "case", description: "<case id>" }, and the demo page
//   shows Passed or Failed only from that test's result in the run.
// - ci: a Vitest test (file, and a test or describe title in it) or another
//   CI job. The demo page shows its result only if the run recorded one.
// - hand: checked by a person, with the reason it can't be automated.
//
// A case may have several checks: a browser test for what a person sees, a
// Vitest test for the parts the browser can't reach (another workspace, a
// forced failure), and a hand check for what needs real AI output. Keep the
// words short; the full case is in docs/refinement/sprint-<N>.md.
//
// Plain TypeScript with no imports, so node runs it directly
// (scripts/demo-page.mjs) as well as Vitest (tests/lib/cases.test.ts).
// Later sprints add their stories and cases below with their own sprint number.

export type BrowserCheck = {
  kind: "browser";
  /** File in tests/e2e. */
  spec: string;
  /** The test's title, exactly. */
  title: string;
  /** What this test does not show of the case, said plainly on the demo page. */
  note?: string;
};

export type CiCheck =
  | {
      kind: "ci";
      /** A Vitest file, from the repository root. */
      file: string;
      /** A test title in it, or a describe title (every test under it). */
      test: string;
      note?: string;
    }
  | {
      kind: "ci";
      /** A job in .github/workflows/ci.yml, by its name. */
      job: string;
      note?: string;
    };

export type HandCheck = { kind: "hand"; why: string };

export type Check = BrowserCheck | CiCheck | HandCheck;

export type Story = { sprint: number; id: string; title: string };

export type Case = {
  /** "<story>.<number>", for example "C7-1.3". */
  id: string;
  sprint: number;
  story: string;
  /** The case in a few words. */
  words: string;
  /** In order of weight: browser tests first, then CI, then by hand. */
  checks: Check[];
};

export const STORIES: Story[] = [
  { sprint: 7, id: "C7-1", title: "Sizes: every ad in every size a channel needs" },
  { sprint: 7, id: "C7-2", title: "Languages: the words in three more languages" },
  { sprint: 7, id: "C7-3", title: "Launch pack: a zip per channel with a manifest" },
  { sprint: 7, id: "F-27", title: "Several audiences" },
  { sprint: 7, id: "F-26", title: "Redraw with the current kit" },
  { sprint: 7, id: "F-28", title: "The database-driver patch: report and watch" },
  { sprint: 7, id: "N-7a", title: "Remove the cutover pieces and Supabase" },
];

const SIZES_SPEC = "sizes.spec.ts";
const SIZES_SOCIAL_DISPLAY = "C7-1 #1, #2, #5, #7: Sizes on a social ad and a display ad, every size listed with its checks and drawn full size";
const SIZES_REFUSED = "C7-1 #4: a size the legal lines don't fit is left out with the reason, and the other sizes still draw";
const LANGUAGES = "C7-2: the demo brand's languages, Translate on a picked ad, machine-translation badges and the German ad in every size";
const PACK = "C7-3: the launch pack of four picked social ads in four languages downloads as one zip of 64 ads with its manifests";
const AUDIENCES = "F-27 #1 and #2: a brief with two audiences gets 24 social ads grouped by audience, and New words on the second redraws only its ads";
const REDRAW = "F-26 #1 to #4: ads made with an older kit say so; Redraw with current kit redraws one or all at no AI cost, with undo";

const AD_SIZES = "tests/db/ad-sizes.test.ts";
const RENDER_SIZES = "tests/lib/render-sizes.test.ts";
const LOCALISE = "tests/agents/localise.test.ts";
const PACK_DB = "tests/db/pack.test.ts";
const CREATIVE = "tests/agents/creative.test.ts";

const REAL_AI =
  "CI runs the mock model and has no real keys, so this needs real model output: checked by hand on production after the deploy (test pack).";

export const CASES: Case[] = [
  // C7-1 Sizes
  {
    id: "C7-1.1",
    sprint: 7,
    story: "C7-1",
    words: "A picked paid-social ad renders in all four social sizes, keeping every part, passing contrast and fit.",
    checks: [
      { kind: "browser", spec: SIZES_SPEC, title: SIZES_SOCIAL_DISPLAY },
      { kind: "ci", file: RENDER_SIZES, test: "C7-1 #1: a paid-social ad renders in all four social sizes with every part, passing contrast and fit" },
      { kind: "ci", file: AD_SIZES, test: "#1 a paid-social ad is served in each social size, each with its own ETag (the square's is the ad's own)" },
    ],
  },
  {
    id: "C7-1.2",
    sprint: 7,
    story: "C7-1",
    words: "A display ad renders in the three banner sizes with headline, button, logo and legal lines.",
    checks: [
      { kind: "browser", spec: SIZES_SPEC, title: SIZES_SOCIAL_DISPLAY },
      { kind: "ci", file: RENDER_SIZES, test: "C7-1 #2: a display ad renders in the banner sizes with headline, button, logo and legal lines (no body)" },
      { kind: "ci", file: AD_SIZES, test: "#2 a display ad is served in the three banner sizes" },
    ],
  },
  {
    id: "C7-1.3",
    sprint: 7,
    story: "C7-1",
    words: "Full bleed at 9:16 crops around the picture's subject, never stretches; split and card keep the square picture whole.",
    checks: [
      { kind: "ci", file: RENDER_SIZES, test: "C7-1 #3: the picture is fitted, never stretched", note: "On a made-up picture with one clear subject." },
      { kind: "hand", why: `How well the crop keeps the subject of real 2K pictures. ${REAL_AI}` },
    ],
  },
  {
    id: "C7-1.4",
    sprint: 7,
    story: "C7-1",
    words: "A size that can't hold the words at the smallest step is refused with the reason; the other sizes still render.",
    checks: [
      { kind: "browser", spec: SIZES_SPEC, title: SIZES_REFUSED },
      { kind: "ci", file: RENDER_SIZES, test: "C7-1 #4: a size whose box can't hold the words at the smallest step is refused with the reason" },
      { kind: "ci", file: AD_SIZES, test: "#4 a size the legal lines don't fit is a 422 with the reason; the other sizes still render" },
    ],
  },
  {
    id: "C7-1.5",
    sprint: 7,
    story: "C7-1",
    words: "A simulated picture carries its \"Simulated image\" label in every size, including the smallest banner.",
    checks: [
      { kind: "browser", spec: SIZES_SPEC, title: SIZES_SOCIAL_DISPLAY, note: "Shows the badge on every size; that the label is drawn into the pixels is the CI test." },
      { kind: "ci", file: RENDER_SIZES, test: "C7-1 #5 (rule 1): a simulated picture carries its label in every size, including 728 × 90" },
    ],
  },
  {
    id: "C7-1.6",
    sprint: 7,
    story: "C7-1",
    words: "The 1080 square is pixel-identical to the ad drawn before sizes.",
    checks: [{ kind: "ci", file: "tests/lib/render-golden.test.ts", test: "C7-1 #6: the 1080 square is pixel-identical to today's ad" }],
  },
  {
    id: "C7-1.7",
    sprint: 7,
    story: "C7-1",
    words: "Hostile: an unknown size, or another channel's size, is a 404; another workspace's ad is a 404 in every size.",
    checks: [
      { kind: "browser", spec: SIZES_SPEC, title: SIZES_SOCIAL_DISPLAY, note: "Unknown and other-channel sizes only; another workspace's ad is the CI test." },
      { kind: "ci", file: AD_SIZES, test: "#7 hostile: unknown sizes, the other channel's sizes, another workspace's ad, no session and malformed ids are all 404" },
    ],
  },
  {
    id: "C7-1.8",
    sprint: 7,
    story: "C7-1",
    words: "A 1K picture (made before this sprint) renders in every size, noted as \"upscaled from a 1K picture\".",
    checks: [
      { kind: "ci", file: AD_SIZES, test: "#5 and #8: a simulated 1K picture is labelled in every size, and noted as upscaled where it is enlarged" },
      { kind: "ci", file: RENDER_SIZES, test: "C7-1 #8: a 1K picture still renders in every size; the enlargement is recorded" },
    ],
  },

  // C7-2 Languages
  {
    id: "C7-2.1",
    sprint: 7,
    story: "C7-2",
    words: "Translating a paid-social set into French, German and Spanish makes three linked sets, within limits, with each language's legal lines.",
    checks: [
      { kind: "browser", spec: "languages.spec.ts", title: LANGUAGES, note: "Shows the three translations and the German legal lines; the limits and links are the CI test." },
      { kind: "ci", file: LOCALISE, test: "#1 translating a paid-social set into French, German and Spanish makes three sets linked to the English one, within the limits, with the kit's legal lines for each language" },
      { kind: "hand", why: `Translation quality and tone. ${REAL_AI}` },
    ],
  },
  {
    id: "C7-2.2",
    sprint: 7,
    story: "C7-2",
    words: "Each translated ad renders in every size of its channel and passes fit and contrast, or is left out with the reason.",
    checks: [
      { kind: "browser", spec: "languages.spec.ts", title: LANGUAGES },
      { kind: "ci", file: LOCALISE, test: "#2 each translated ad renders in every size of its channel and passes fit and contrast, or is left out with the reason" },
    ],
  },
  {
    id: "C7-2.3",
    sprint: 7,
    story: "C7-2",
    words: "A German headline that overflows 4:5 gets one repair and then fits; one that still overflows is left out of that size only.",
    checks: [
      { kind: "ci", file: LOCALISE, test: "#3 a German headline too long for a size gets one repair naming the field and size, and then fits" },
      { kind: "ci", file: LOCALISE, test: "#3 words that still overflow after the repair are left out of that size only, with the reason" },
    ],
  },
  {
    id: "C7-2.4",
    sprint: 7,
    story: "C7-2",
    words: "A translation with a banned term for that language is repaired once, then refused.",
    checks: [{ kind: "ci", file: LOCALISE, test: "#4 a translation with a banned term for that language is repaired once, then refused" }],
  },
  {
    id: "C7-2.5",
    sprint: 7,
    story: "C7-2",
    words: "A brand with no German legal lines can't translate into German; the button explains why.",
    checks: [{ kind: "ci", file: LOCALISE, test: "#5 a brand with no German legal lines can't translate into German: the button explains why" }],
  },
  {
    id: "C7-2.6",
    sprint: 7,
    story: "C7-2",
    words: "Every translated ad shows \"Machine translation\" in the gallery and the manifest.",
    checks: [
      { kind: "browser", spec: "languages.spec.ts", title: LANGUAGES, note: "The gallery and the Sizes view." },
      { kind: "browser", spec: "launch-pack.spec.ts", title: PACK, note: "The manifest." },
      { kind: "ci", file: LOCALISE, test: "#6 every translated ad says 'Machine translation' in the gallery and the Sizes view (rule 1), simulated when the mock wrote it" },
    ],
  },
  {
    id: "C7-2.7",
    sprint: 7,
    story: "C7-2",
    words: "Hostile: an instruction hidden in the English words is translated as words, and the testimonial check still refuses a quote.",
    checks: [
      { kind: "ci", file: LOCALISE, test: "#7 hostile: an instruction in the English words is translated as words, and the testimonial check still refuses a first-person quote" },
      { kind: "ci", file: "tests/lib/translation-first-person.test.ts", test: "first person in a translation" },
    ],
  },
  {
    id: "C7-2.8",
    sprint: 7,
    story: "C7-2",
    words: "The mock model returns fixed translations, labelled simulated, so previews spend nothing.",
    checks: [
      { kind: "browser", spec: "languages.spec.ts", title: LANGUAGES, note: "Shows the \"(simulated)\" label; that nothing is spent is the CI test." },
      { kind: "ci", file: LOCALISE, test: "#8 the mock model returns fixed translations, labelled simulated, so previews spend nothing real" },
    ],
  },

  // C7-3 Launch pack
  {
    id: "C7-3.1",
    sprint: 7,
    story: "C7-3",
    words: "Picked ads in three languages give a zip with every size and language that passed, in channel and language folders; the count matches the gallery's.",
    checks: [
      { kind: "browser", spec: "launch-pack.spec.ts", title: PACK, note: "Four picked social ads (the sprint demo); the mix of two social and one display ad is the CI test." },
      { kind: "ci", file: PACK_DB, test: "#1 holds every picked ad in every size and language that passed, in channel and language folders, and the count matches the gallery's" },
    ],
  },
  {
    id: "C7-3.2",
    sprint: 7,
    story: "C7-3",
    words: "The manifest lists every file with its words, checks and provenance, and every left-out size or language with its reason.",
    checks: [
      { kind: "browser", spec: "launch-pack.spec.ts", title: PACK, note: "Nothing is left out in the demo pack; a left-out size with its reason is the CI test." },
      { kind: "ci", file: PACK_DB, test: "#2 the manifests list every file with its words, checks and provenance, and every left-out size or language with its reason" },
    ],
  },
  {
    id: "C7-3.3",
    sprint: 7,
    story: "C7-3",
    words: "An unpicked or discarded ad, or one from an earlier brief version, is not in the pack.",
    checks: [{ kind: "ci", file: PACK_DB, test: "#3 unpicked, discarded and earlier-version ads are not in the pack" }],
  },
  {
    id: "C7-3.4",
    sprint: 7,
    story: "C7-3",
    words: "A brief not signed off, or nothing picked, shows why there's no pack and offers no download.",
    checks: [
      { kind: "browser", spec: "launch-pack.spec.ts", title: PACK, note: "Nothing picked; a brief that isn't signed off is the CI test." },
      { kind: "ci", file: PACK_DB, test: "#4 no sign-off, or nothing picked: a refusal with the reason, never an empty zip; the gallery offers no download" },
    ],
  },
  {
    id: "C7-3.5",
    sprint: 7,
    story: "C7-3",
    words: "A 60-file pack downloads completely (time and size measured).",
    checks: [{ kind: "browser", spec: "launch-pack.spec.ts", title: PACK, note: "64 ads; the time and size are printed in the test's output." }],
  },
  {
    id: "C7-3.6",
    sprint: 7,
    story: "C7-3",
    words: "Simulated pictures and machine translations are labelled in the manifest and README.",
    checks: [
      { kind: "browser", spec: "launch-pack.spec.ts", title: PACK },
      { kind: "ci", file: PACK_DB, test: "#6 rule 1: simulated pictures and machine translations are labelled in both manifests and the README" },
    ],
  },
  {
    id: "C7-3.7",
    sprint: 7,
    story: "C7-3",
    words: "Hostile: another workspace's campaign is a 404; a crafted file name in the words can't escape the zip's folders.",
    checks: [
      { kind: "ci", file: PACK_DB, test: "#7 hostile: another workspace's campaign, no session and malformed ids are the same 404" },
      { kind: "ci", file: PACK_DB, test: "#7 hostile: words like ../../x can't leave the zip's folders, and the CSV defuses formulas" },
      { kind: "ci", file: "tests/lib/pack-names.test.ts", test: "C7-3 pack file names" },
    ],
  },

  // F-27 Several audiences
  {
    id: "F-27.1",
    sprint: 7,
    story: "F-27",
    words: "A brief with two audiences gets 24 social ads (12 each), grouped by audience in the gallery.",
    checks: [
      { kind: "browser", spec: "several-audiences.spec.ts", title: AUDIENCES },
      { kind: "ci", file: CREATIVE, test: "#1 two audiences get 24 social ads (12 each) and 24 display ads, grouped by audience in the brief's order" },
    ],
  },
  {
    id: "F-27.2",
    sprint: 7,
    story: "F-27",
    words: "New words works on the second audience's words and redraws only its ads.",
    checks: [
      { kind: "browser", spec: "several-audiences.spec.ts", title: AUDIENCES },
      { kind: "ci", file: CREATIVE, test: "#2 New words on the second audience's words redraws only that audience's ads on those words" },
    ],
  },
  {
    id: "F-27.3",
    sprint: 7,
    story: "F-27",
    words: "A brief with no named audience works as today (\"all\").",
    checks: [{ kind: "ci", file: CREATIVE, test: "F-27 #3: a brief with no named audience works as today: 12 ads for everyone, in one group" }],
  },
  {
    id: "F-27.4",
    sprint: 7,
    story: "F-27",
    words: "The cost shown before Make creative is unchanged.",
    checks: [{ kind: "ci", file: CREATIVE, test: "#4 the cost shown before Make creative is the same as for one audience (pictures are shared, the words are one Copy run)" }],
  },

  // F-26 Redraw with the current kit
  {
    id: "F-26.1",
    sprint: 7,
    story: "F-26",
    words: "After a palette change the button appears on older ads; redrawing makes new ads in the new colours and discards the old.",
    checks: [
      { kind: "browser", spec: "creative.spec.ts", title: REDRAW },
      {
        kind: "ci",
        file: CREATIVE,
        test: "#1 and #4 after a palette change: the older ads say so; a redraw makes a new ad in the new colours (same picture, words and layout, the pick carried over) and discards the old one, at no AI cost",
      },
    ],
  },
  {
    id: "F-26.2",
    sprint: 7,
    story: "F-26",
    words: "Undo restores the old ads.",
    checks: [
      { kind: "browser", spec: "creative.spec.ts", title: REDRAW },
      { kind: "ci", file: CREATIVE, test: "#2 undo: restoring the old ad brings it back with its pick and discards the redrawn one" },
    ],
  },
  {
    id: "F-26.3",
    sprint: 7,
    story: "F-26",
    words: "An ad already on the current kit has no button.",
    checks: [
      { kind: "browser", spec: "creative.spec.ts", title: REDRAW },
      { kind: "ci", file: CREATIVE, test: "#3 an ad already on the current kit has no button, and a redraw is refused" },
    ],
  },
  {
    id: "F-26.4",
    sprint: 7,
    story: "F-26",
    words: "Picks carry over to the redrawn ad.",
    checks: [
      { kind: "browser", spec: "creative.spec.ts", title: REDRAW },
      {
        kind: "ci",
        file: CREATIVE,
        test: "#1 and #4 after a palette change: the older ads say so; a redraw makes a new ad in the new colours (same picture, words and layout, the pick carried over) and discards the old one, at no AI cost",
      },
    ],
  },

  // F-28 The database-driver patch
  {
    id: "F-28.1",
    sprint: 7,
    story: "F-28",
    words: "The upstream issue is filed, linked from decision 0016.",
    checks: [
      {
        kind: "hand",
        why: "Not code. Rory decided on 2 November not to post it (postgres.js 4.0.0 rewrote that code and similar issues are closed); trying 4.0.0 is F-31 in the backlog.",
      },
    ],
  },
  {
    id: "F-28.2",
    sprint: 7,
    story: "F-28",
    words: "No \"Cannot read properties of null\" or CONNECT_TIMEOUT in a week of production logs, or each one explained.",
    checks: [{ kind: "hand", why: "Needs a week of production logs, which CI doesn't have: Claude reads them at the sprint's close." }],
  },

  // N-7a Remove the cutover pieces
  {
    id: "N-7a.1",
    sprint: 7,
    story: "N-7a",
    words: "grep -ri supabase finds only history.",
    checks: [{ kind: "hand", why: "The removal is not done before 12 November (Q7); checked then." }],
  },
  {
    id: "N-7a.2",
    sprint: 7,
    story: "N-7a",
    words: "CI and production are green after the removal.",
    checks: [{ kind: "hand", why: "After the removal on or after 12 November; production is checked on the live site." }],
  },
  {
    id: "N-7a.3",
    sprint: 7,
    story: "N-7a",
    words: "Rory confirms both Supabase projects are deleted.",
    checks: [{ kind: "hand", why: "Rory deletes them in Supabase's dashboard, on or after 12 November." }],
  },
];

/** The kind a case is counted under: browser if any browser test shows it, else ci, else hand. */
export function caseKind(c: Case): Check["kind"] {
  if (c.checks.some((x) => x.kind === "browser")) return "browser";
  if (c.checks.some((x) => x.kind === "ci")) return "ci";
  return "hand";
}
