// Sprint 10b, D-2 #3 through the real repo functions (QA finding 7): a real
// brand ("Tidewell Moments") whose own name is its parent's ("Brightwater"),
// with a market note naming Brightwater and another company. A brief edit and
// a copy edit that use "Brightwater" both pass; the other noted company is
// still refused (rule 2). The campaign line (review fix B1) may carry the
// brand's own name too, but no figure, quote or other company's name, even as
// a person's edit; and the copy checks hold the line's headline to the market
// notes after sign-off. Every name here is invented (rule 2).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrand } from "@/lib/brands/repo";
import { BriefEditError, createCampaign, getVersion, saveBriefEdit } from "@/lib/brief/repo";
import type { BriefCore } from "@/lib/brief/schema";
import { CopyEditError, saveCopyEdit } from "@/lib/creative/copy";
import { closeSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";
import { OTHER_COMPANY, TIDEWELL } from "../fixtures/new-brand";
import { createMember, truncateAll } from "../helpers/db";

type Member = { userId: string; workspaceId: string };
const noSend = async () => {};
const OWN = TIDEWELL.ownNames[0];
const LINE = `Weeknights with ${OWN}`;

let m: Member;
let brand: string;
let campaign: string;
let insights: string[];

const brief = (over: Partial<BriefCore> = {}): BriefCore => ({
  title: "Short videos for weeknights",
  line: LINE,
  summary: `Tidewell Moments, part of ${OWN}, meets home cooks on weeknights with short recipe videos.`,
  story: `A cook opens the app after work and finds a ten-minute supper from the ${OWN} kitchen.`,
  insights: insights.map((id, n) => ({ text: ["Home cooks look for quick weeknight suppers.", "Short videos are watched to the end.", `${OWN} publishes short recipe videos.`][n], cites: [id] })),
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach home cooks where they scroll." }],
  kpi: { metric: "conversions" },
  ...over,
});

async function refusal(p: Promise<unknown>): Promise<string[]> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return (err as BriefEditError | CopyEditError).problems;
}

describe("D-2 #3 own names through the brief and copy repos (QA finding 7)", () => {
  beforeAll(async () => {
    await truncateAll();
    m = await createMember();
    brand = await createBrand(m, {
      name: TIDEWELL.name, slug: TIDEWELL.slug, description: TIDEWELL.description, category: TIDEWELL.category, toneWords: ["warm"], voiceNotes: "",
      doRules: [], dontRules: [], palette: [], fontPrimary: "", fontSecondary: "", legalLines: [], bannedTerms: [], evidenceClaims: [], ownNames: [...TIDEWELL.ownNames],
    });
    insights = await asUser(m.userId, async (tx) => {
      const ids: string[] = [];
      for (const [n, [title, body]] of [
        ["Weeknight suppers", "Home cooks look for quick weeknight suppers."],
        ["Watching to the end", "Short videos are watched to the end."],
      ].entries()) {
        const [r] = await tx`insert into public.context_items (workspace_id, brand_id, kind, title, body, source, source_ref, created_by_kind)
          values (${m.workspaceId}, ${brand}, 'insight', ${title}, ${body}, 'Test', ${`insight:${n}`}, 'person') returning id`;
        ids.push(r.id as string);
      }
      const [note] = await tx`insert into public.context_items (workspace_id, brand_id, kind, title, body, source, source_ref, created_by_kind, meta)
        values (${m.workspaceId}, ${brand}, 'result', 'Short recipe videos', ${`${OWN} and ${OTHER_COMPANY} both publish short recipe videos.`},
                'Market agent', 'market:1', 'agent', ${tx.json({ kind: "rival_move", names: [OWN, OTHER_COMPANY] })})
        returning id`;
      ids.push(note.id as string);
      return ids;
    });
    campaign = await createCampaign(m, brand, "Reach home cooks on weeknights", noSend);
  });
  afterAll(closeSql);

  it("a brief edit using the brand's own name passes, its campaign line included; another noted company is refused", async () => {
    const v = await saveBriefEdit(m, campaign, 0, brief());
    expect(v).toBe(1);
    const saved = (await getVersion(m.userId, campaign, v))!;
    expect(saved.line).toBe(LINE);
    expect(saved.summary).toContain(OWN);

    const other = await refusal(saveBriefEdit(m, campaign, 1, brief({ story: `A cook compares ${OTHER_COMPANY} with the app after work.` })));
    expect(other).toEqual([expect.stringMatching(new RegExp(`^the story names ${OTHER_COMPANY}, a real company from the market notes`))]);
    const otherLine = await refusal(saveBriefEdit(m, campaign, 1, brief({ line: `Better than ${OTHER_COMPANY}` })));
    expect(otherLine).toEqual([expect.stringMatching(new RegExp(`^the campaign line names ${OTHER_COMPANY}, a real company from the market notes`))]);
  });

  it("D-4 #3 review fix B1: a person's line with a figure, or naming another company, is refused by saveBriefEdit, and no version is saved", async () => {
    for (const [line, problem] of [
      ["Loved by 10,000 cooks", "the campaign line says 10000; a campaign line can't carry a figure, so say it without one"],
      ["Tastier than Brackenfell", `the campaign line names "Brackenfell", which looks like another company; a campaign line can't carry another company's name (only ${TIDEWELL.name} or ${OWN})`],
    ]) {
      expect(await refusal(saveBriefEdit(m, campaign, 1, brief({ line })))).toEqual([problem]);
    }
    // A quote is refused (and "Ana" is a name too).
    expect(await refusal(saveBriefEdit(m, campaign, 1, brief({ line: "\u201cSo good\u201d, says Ana" })))).toContain(
      "the campaign line has quotation marks; copy may not quote anyone (no testimonials), so say it in the brand's own words; a campaign line can't carry a quote, a rating or anyone else's words",
    );
    const [c] = await asUser(m.userId, (tx) => tx`select current_version from public.campaigns where id = ${campaign}`);
    expect(c.current_version).toBe(1);
  });

  it("a copy edit using the brand's own name passes; another noted company is refused", async () => {
    const setId = await asUser(m.userId, async (tx) => {
      await tx`update public.campaigns set status = 'approved', approved_version = 1, approved_at = now(), approved_by = ${m.userId} where id = ${campaign}`;
      const [r] = await tx`insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
        values (${m.workspaceId}, 'copy', 1, ${tx.json({ mode: "all", campaignId: campaign })}, ${m.userId}) returning id`;
      const [s] = await tx`
        insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_ref, segment_title, set, legal_lines, source, created_by)
        values (${m.workspaceId}, ${campaign}, 1, ${r.id}, 'paid social', null, 'Everyone in the brief',
                ${tx.json({ headline: LINE, body: "A ten-minute supper, ready after work.", cta: "Watch now" })}, ${[]}, 'agent', ${m.userId})
        returning id`;
      return s.id as string;
    });
    const set = { headline: LINE, body: `A ten-minute supper from the ${OWN} kitchen.`, cta: "Watch now" };
    const other = await refusal(saveCopyEdit(m, setId, { ...set, body: `A ten-minute supper, quicker than ${OTHER_COMPANY}.` }));
    expect(other).toEqual([expect.stringMatching(new RegExp(`^the body names ${OTHER_COMPANY}, a real company from the market notes`))]);
    const saved = await saveCopyEdit(m, setId, set);
    const [row] = await asUser(m.userId, (tx) => tx`select set from public.copy_sets where id = ${saved}`);
    expect(row.set).toEqual(set);
  });
});
