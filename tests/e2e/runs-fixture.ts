// A browser-test fixture, not an app route: U10-8's runs and (answer B1)
// campaigns, written straight to the database as the tables' owner (CI's and
// local e2e's DATABASE_URL), in a new invitee's own workspace, so the runs
// list and the campaigns list show exactly this and nothing other specs make
// in the dev workspace while this runs.
//
// - Two simulated brands, Fernhollow Outfitters and Quillmoor Money (fictional),
//   and 25 campaigns across them, a minute apart (newest first: campaign 01),
//   each a draft, waiting for sign-off or signed off, with version 1 titled
//   "<tag> campaign NN". None is being written, so neither list refreshes itself.
// - 60 finished runs, a second apart (newest first), the 50th and 51st at the
//   same moment, so the first page's boundary is a tie only the id breaks:
//   the newest is a tagline run (No campaign); the second a Brief run whose
//   input names the dev workspace's hidden campaign (rule 7: it must say No
//   campaign); the third an Imagery run on campaign 02 whose trail's steps are
//   recorded at seq 1, 2, 3, 5 and 7 (as Imagery's reserved slots leave them);
//   every fifth after that a tagline run, the rest Brief, Copy and Imagery runs
//   on campaigns 02 and 03, a quarter of them failed. Each has a simulated cost
//   (a mock-model ledger row dated three days ago, so today's spend and the
//   daily cap are untouched).
// - In the dev workspace (another workspace from the invitee's): the hidden
//   campaign, and one old fixture run, whose id is a cursor from another
//   workspace.
// removeRunsFixture deletes the dev workspace's rows and the invitee's whole
// workspace, with everything in it.
import type postgres from "postgres";
import type { FixtureMember } from "./home-fixture";
import { devMember } from "./status-fixture";

type Tx = postgres.TransactionSql;

export const RUNS = 60;
export const CAMPAIGNS = 25;
export type CampaignState = "draft" | "waiting" | "signedOff";
export const STATE_LABELS: Record<CampaignState, string> = { draft: "Draft", waiting: "Waiting for sign-off", signedOff: "Signed off" };
const STATES: CampaignState[] = ["draft", "waiting", "signedOff"];

export type FixtureRun = {
  id: string;
  /** The agent's key, and the name the list shows for it (agentDisplayName). */
  agent: string;
  agentName: string;
  status: "completed" | "failed";
  /** The campaign the list must name, or null for No campaign. */
  campaign: { id: string; name: string } | null;
  /** Its cost, all simulated (one mock-model ledger row). */
  pence: number;
  at: Date;
};

export type FixtureCampaign = { id: string; name: string; brand: "Fernhollow Outfitters" | "Quillmoor Money"; brandId: string; state: CampaignState; at: Date };

export type RunsFixture = {
  brands: { fernhollow: string; quillmoor: string };
  /** Newest first, by updated_at then id, as the campaigns list must show them. */
  campaigns: FixtureCampaign[];
  /** Newest first, by created_at then id, as the runs list must show them. */
  runs: FixtureRun[];
  /** The two campaigns the runs name. */
  named: { first: FixtureCampaign; second: FixtureCampaign };
  /** The run whose trail skips seq 4 and 6, with its steps' names in seq order. */
  trail: { runId: string; seqs: number[]; names: string[] };
  /** The tagline run (newest) and the run naming the hidden campaign. */
  tagline: string;
  hostile: string;
  /** The dev workspace's campaign and run (another workspace's ids). */
  hidden: { campaignId: string; name: string; runId: string };
};

const AGENT_NAMES: Record<string, string> = { tagline: "Tagline agent", brief: "Brief agent", copy: "Copy agent", imagery: "Imagery agent" };
const TRAIL = [
  { seq: 1, name: "Plan the pictures" },
  { seq: 2, name: "Read the brand kit" },
  { seq: 3, name: "Draw picture 1" },
  { seq: 5, name: "Check picture 1 for text" },
  { seq: 7, name: "Draw picture 2" },
];

const pad = (n: number) => String(n).padStart(2, "0");

const brief = (title: string) => ({
  title,
  summary: "Bring walkers back for the autumn range before the first cold weekend.",
  story: "Walkers come back when the kit they bought lasts the season.",
  insights: [1, 2, 3].map((n) => ({ text: `Walkers say reason ${n} matters to them.`, cites: [`note-${n}`] })),
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach lapsed walkers." }],
  kpi: { metric: "reactivation rate" },
  mustInclude: [],
  avoid: [],
});

const newestFirst = <T extends { id: string; at: Date }>(rows: T[]) =>
  [...rows].sort((x, y) => y.at.getTime() - x.at.getTime() || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0));

const slug = (tag: string, brand: string) => `runs-${brand}-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 40).replace(/-$/, "");

async function campaign(tx: Tx, m: FixtureMember, brandId: string, name: string, state: CampaignState, at: Date): Promise<string> {
  const status = state === "draft" ? "draft" : state === "waiting" ? "awaiting_signoff" : "approved";
  const approved = status === "approved";
  // One insert with the final updated_at: the touch trigger fires only on update.
  const [c] = await tx`
    insert into public.campaigns (workspace_id, brand_id, objective, status, current_version, approved_version, approved_at, approved_by, created_by, created_at, updated_at)
    values (${m.workspaceId}, ${brandId}, ${`${name}: bring walkers back for the autumn range`}, ${status}, 1, ${approved ? 1 : null},
            ${approved ? at : null}, ${approved ? m.userId : null}, ${m.userId}, ${at}, ${at})
    returning id`;
  await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
    values (${m.workspaceId}, ${c.id}, 1, ${tx.json(brief(name))}, 'agent', ${m.userId})`;
  return c.id as string;
}

async function run(tx: Tx, m: FixtureMember, agent: string, input: Record<string, unknown>, status: string, at: Date, pence: number): Promise<string> {
  const [r] = await tx`
    insert into public.agent_runs (workspace_id, agent, agent_version, status, input, created_by, label, created_at, completed_at)
    values (${m.workspaceId}, ${agent}, 1, ${status}, ${tx.json(input as never)}, ${m.userId}, ${agent === "tagline" ? "Larkspur Mill" : null}, ${at}, ${at})
    returning id`;
  await tx`
    insert into public.usage_ledger (workspace_id, run_id, agent, provider, model, input_tokens, output_tokens, cost_pence, created_at)
    values (${m.workspaceId}, ${r.id}, ${agent}, 'mock', 'mock', 100, 50, ${pence}, now() - interval '3 days')`;
  return r.id as string;
}

/** Everything the runs and campaigns lists show, in `m`'s workspace, named with `tag`. */
export async function insertRunsFixture(sql: postgres.Sql, m: FixtureMember, tag: string): Promise<RunsFixture> {
  const dev = await devMember(sql);
  const hiddenName = `${tag} hidden: the owner's own campaign`;
  const [devBrand] = await sql`select id from public.brands where workspace_id = ${dev.workspaceId} order by created_at limit 1`;
  if (!devBrand) throw new Error("The dev workspace has no brand yet: the demo-brands setup project adds them");
  const [hidden] = await sql`
    insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
    values (${dev.workspaceId}, ${devBrand.id}, ${hiddenName}, ${dev.userId}, 1) returning id`;
  await sql`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
    values (${dev.workspaceId}, ${hidden.id}, 1, ${sql.json(brief(hiddenName))}, 'agent', ${dev.userId})`;
  // Old, so it sits far down the dev workspace's own list.
  const [devRun] = await sql`
    insert into public.agent_runs (workspace_id, agent, agent_version, status, input, error, created_by, label, created_at, completed_at)
    values (${dev.workspaceId}, 'tagline', 1, 'failed', ${sql.json({ brandName: "Larkspur Mill" })}, 'A fixture run for the runs list check: no model was called.',
            ${dev.userId}, ${`${tag}: another workspace's run`}, now() - interval '5 days', now() - interval '5 days')
    returning id`;

  return sql.begin(async (tx) => {
    const [f] = await tx`insert into public.brands (workspace_id, created_by, name, slug, is_simulated)
      values (${m.workspaceId}, ${m.userId}, 'Fernhollow Outfitters', ${slug(tag, "f")}, true) returning id`;
    const [q] = await tx`insert into public.brands (workspace_id, created_by, name, slug, is_simulated)
      values (${m.workspaceId}, ${m.userId}, 'Quillmoor Money', ${slug(tag, "q")}, true) returning id`;
    const now = Date.now();

    const made: FixtureCampaign[] = [];
    for (let i = 0; i < CAMPAIGNS; i++) {
      const brand = i % 2 ? "Quillmoor Money" : "Fernhollow Outfitters";
      const brandId = (i % 2 ? q.id : f.id) as string;
      const name = `${tag} campaign ${pad(i + 1)}`;
      const state = STATES[i % STATES.length];
      const at = new Date(now - (20 + i) * 60_000);
      made.push({ id: await campaign(tx, m, brandId, name, state, at), name, brand, brandId, state, at });
    }
    const named = { first: made[1], second: made[2] };

    const runs: FixtureRun[] = [];
    let tagline = "";
    let hostile = "";
    let trailRun = "";
    const agents = ["brief", "copy", "imagery"];
    for (let k = 0; k < RUNS; k++) {
      const seconds = k === 50 ? 49 : k;
      const at = new Date(now - 3_600_000 - seconds * 1000);
      const pence = 0.5 + k / 100;
      const status: FixtureRun["status"] = k > 2 && k % 4 === 3 ? "failed" : "completed";
      if (k === 0 || (k > 2 && k % 5 === 0)) {
        const id = await run(tx, m, "tagline", { brandName: "Larkspur Mill" }, status, at, pence);
        if (k === 0) tagline = id;
        runs.push({ id, agent: "tagline", agentName: AGENT_NAMES.tagline, status, campaign: null, pence, at });
      } else if (k === 1) {
        hostile = await run(tx, m, "brief", { mode: "draft", campaignId: hidden.id as string }, status, at, pence);
        runs.push({ id: hostile, agent: "brief", agentName: AGENT_NAMES.brief, status, campaign: null, pence, at });
      } else if (k === 2) {
        trailRun = await run(tx, m, "imagery", { campaignId: named.first.id, version: 1 }, status, at, pence);
        for (const s of TRAIL) {
          await tx`insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, duration_ms, started_at, finished_at)
            values (${trailRun}, ${m.workspaceId}, ${s.seq}, ${s.name}, 'system', 'succeeded', ${tx.json({ step: s.seq })}, ${tx.json({ ok: true })}, 1200, ${at}, ${at})`;
        }
        runs.push({ id: trailRun, agent: "imagery", agentName: AGENT_NAMES.imagery, status, campaign: { id: named.first.id, name: named.first.name }, pence, at });
      } else {
        const c = k % 2 ? named.first : named.second;
        const agent = agents[k % 3];
        const id = await run(tx, m, agent, { campaignId: c.id, version: 1 }, status, at, pence);
        runs.push({ id, agent, agentName: AGENT_NAMES[agent], status, campaign: { id: c.id, name: c.name }, pence, at });
      }
    }

    return {
      brands: { fernhollow: f.id as string, quillmoor: q.id as string },
      campaigns: newestFirst(made),
      runs: newestFirst(runs),
      named,
      trail: { runId: trailRun, seqs: TRAIL.map((s) => s.seq), names: TRAIL.map((s) => s.name) },
      tagline,
      hostile,
      hidden: { campaignId: hidden.id as string, name: hiddenName, runId: devRun.id as string },
    };
  }) as Promise<RunsFixture>;
}

/** Removes the dev workspace's hidden campaign and run, and the invitee's whole workspace, as the tables' owner. */
export async function removeRunsFixture(sql: postgres.Sql, m: FixtureMember | null, fx: RunsFixture | null): Promise<void> {
  if (fx) {
    await sql`delete from public.campaigns where id = ${fx.hidden.campaignId}`;
    await sql`delete from public.agent_runs where id = ${fx.hidden.runId}`;
  }
  if (m) await sql`delete from public.workspaces where id = ${m.workspaceId}`;
}
