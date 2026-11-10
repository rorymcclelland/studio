// Sprint 10b (D-4): a Copy agent input for the fictional Quillmoor demo brand,
// with one audience and paid social, display and search to write, and an
// optional campaign line. Shared by tests/lib/campaign-line.test.ts and
// tests/agents/campaign-line.test.ts.
import { copyAgent, copyInput, type CopyInput, type CopyOutput } from "@/lib/agents/copy";
import { QUILLMOOR } from "@/lib/demo/briefs";
import { OTHER_COMPANY } from "../fixtures/new-brand";

export const LAPSED = "Lapsed customers (no order in 12 months)";
export const LAPSED_FACTS = "1,234 of 5,000 customers have not ordered in 12 months.";

export function quillmoorCopyInput(line: string | null): CopyInput {
  return copyInput.parse({
    brandName: QUILLMOOR.kit.name,
    voice: `Tone: ${QUILLMOOR.kit.toneWords.join(", ")}. ${QUILLMOOR.kit.voiceNotes}`,
    doRules: QUILLMOOR.kit.doRules,
    dontRules: QUILLMOOR.kit.dontRules,
    bannedTerms: QUILLMOOR.kit.bannedTerms,
    evidenceClaims: QUILLMOOR.kit.evidenceClaims,
    realNames: [OTHER_COMPANY],
    products: [],
    places: [],
    legalLines: QUILLMOOR.kit.legalLines,
    brief: {
      title: "Back to saving in January",
      summary: "We bring lapsed savers back with one calm step in January.",
      story: "A saver opens the app on a quiet January evening and sets up one small pot.",
      insights: [{ text: "Lapsed savers have not opened the app in 12 months.", evidence: [{ title: LAPSED, text: LAPSED_FACTS }] }],
      audiences: [{ tag: "A1", segment: LAPSED, why: "They know the app already.", facts: LAPSED_FACTS }],
      channels: [
        { channel: "paid social", role: "Reach lapsed savers where they scroll." },
        { channel: "display", role: "Remind them on sites they read." },
        { channel: "search", role: "Catch people looking for a savings app." },
      ],
      kpi: "reactivation rate",
    },
    write: [
      { channel: "paid social", audience: "A1", sets: 3 },
      { channel: "display", audience: "A1", sets: 3 },
      { channel: "search", audience: "A1", sets: 1 },
    ],
    line,
  });
}

/** The mock Copy agent's answer for an input, as the model step would get it. */
export function mockCopyReply(input: CopyInput): CopyOutput {
  const answer = copyAgent.mockAnswer?.(copyAgent.buildPrompt(input));
  if (!answer) throw new Error("The mock Copy agent gave no answer for this input.");
  return JSON.parse(answer) as CopyOutput;
}
