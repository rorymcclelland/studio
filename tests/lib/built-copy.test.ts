// U10-1 #5 (BUG-14, rule 1): the welcome page and the test plan's note no
// longer say that built features are coming. The welcome page is rendered as
// a visitor gets it; the test plan's note (PLAN_NOTE) is the sentence the
// campaign page and the approvals inbox show under every test plan.
//
// The check: no sentence that speaks of the future ("coming next", "comes
// next", "will", "not built yet", "later", "soon") names a feature that is
// built, and nothing under a "Coming next" heading names one either. The list
// of built features is Studio's state after Sprint 9; add to it as features
// ship, never remove from it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLAN_NOTE } from "@/app/(app)/campaigns/[id]/reviews-view";
import WelcomePage from "@/app/welcome/page";

/** Built by the end of Sprint 9, with the words a sentence would name each by. */
const BUILT:{ feature: string; sprint: number; words: RegExp }[] = [
  { feature: "market notes (the Market agent)", sprint: 4, words: /\bmarket notes?\b|\bmarket agent\b/i },
  { feature: "personas and the test plan", sprint: 4, words: /\bpersonas?\b|\btest plans?\b/i },
  { feature: "the Creative squad's ads", sprint: 5, words: /\bcreative squad\b|\bimagery agent\b|\bcopy agent\b/i },
  { feature: "more sizes for each ad", sprint: 7, words: /\bsizes?\b/i },
  { feature: "languages (translation)", sprint: 7, words: /\blanguages?\b|\btranslat/i },
  { feature: "the launch pack", sprint: 7, words: /\blaunch pack\b/i },
  { feature: "compliance checks (the compliance agent)", sprint: 8, words: /\bcomplian/i },
  { feature: "the pre-test panel", sprint: 8, words: /\bpre-?test/i },
  { feature: "the Performance squad", sprint: 9, words: /\bperformance\b/i },
  { feature: "the campaign simulator", sprint: 9, words: /\bsimulator\b|\bsimulat(?:ed|ion) (?:launch|campaign)/i },
  { feature: "simulated launches", sprint: 9, words: /\blaunch(?:es|ed)?\b/i },
  { feature: "alerts and ask-your-data (the Monitor agent)", sprint: 9, words: /\balerts?\b|\bmonitor\b/i },
];

const FUTURE = /\b(coming next|comes? next|will|not (?:yet )?built|isn't built|is not built|not built yet|later|soon|to come|planned|on the way)\b/i;

/** Block-level text: every element boundary is a break, so headings and paragraphs never run together. */
function blocks(html: string): string[] {
  return html
    .replace(/<(h[1-6]|p|li|section|div|header|main|ol|ul)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const sentences = (text: string) => text.split(/(?<=[.!?:;])\s+/).map((s) => s.trim()).filter(Boolean);

/** Each sentence that speaks of the future and names a built feature, with the feature. */
function outOfDate(texts: string[]): string[] {
  const found: string[] = [];
  for (const s of texts.flatMap(sentences)) {
    if (!FUTURE.test(s)) continue;
    for (const b of BUILT) if (b.words.test(s)) found.push(`"${s}" says ${b.feature} is still to come (built in Sprint ${b.sprint})`);
  }
  return found;
}

/** Everything under a "Coming next" (or "Coming soon") heading, up to the next heading. */
function comingNextSection(html: string): string[] {
  const m = /<h[1-6][^>]*>\s*Coming (?:next|soon)\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6][^>]*>|$)/i.exec(html);
  return m ? blocks(m[1]) : [];
}

describe("U10-1 #5 copy says what is built", () => {
  it("the check finds the out-of-date sentences the audit found (BUG-14)", () => {
    expect(outOfDate(["More sizes for each ad, and a compliance agent that checks creative before it goes anywhere."])).toEqual([]);
    expect(outOfDate(["Then the Performance squad will watch how creative does and propose replacements, which a person approves."])).toHaveLength(1);
    expect(outOfDate(["The Strategy squad takes a campaign to a signed-off brief, and the Performance squad comes next."])).toHaveLength(1);
    expect(outOfDate(["The plan has no sample sizes or run lengths on purpose: they will come from the campaign simulator, which is not built yet."]).length).toBeGreaterThan(0);
    expect(
      comingNextSection('<h2 id="next">Coming next</h2><p>More sizes for each ad, and a compliance agent.</p><h2>What to expect inside</h2><p>Simulated.</p>'),
    ).toEqual(["More sizes for each ad, and a compliance agent."]);
    // Sentences about what happens today pass.
    expect(outOfDate(["A person approves every consequential move.", "Code checks that every citation is real."])).toEqual([]);
  });

  it("the welcome page says no built feature is coming", () => {
    const html = renderToStaticMarkup(createElement(WelcomePage));
    const text = blocks(html);
    expect(text.join(" ")).toContain("A multi-agent campaign studio for marketing teams");
    expect(outOfDate(text)).toEqual([]);
    const next = comingNextSection(html);
    const named = next.flatMap((t) => BUILT.filter((b) => b.words.test(t)).map((b) => `"${t}" lists ${b.feature} under Coming next (built in Sprint ${b.sprint})`));
    expect(named).toEqual([]);
  });

  it("the test plan's note says no built feature is coming", () => {
    expect(PLAN_NOTE).not.toMatch(/not built yet/i);
    expect(outOfDate([PLAN_NOTE])).toEqual([]);
  });
});
