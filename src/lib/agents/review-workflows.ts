import { storedBrief, type StoredBrief } from "@/lib/brief/schema";
import { asUser, type Tx } from "@/lib/db/scoped";
import { CapExceededError } from "@/lib/models/generate";
import { runModelStep, type StepContext } from "./model-step";
import { personaAgent, personaStart, type PersonaInput, type PersonaOutput } from "./persona";
import { testPlanAgent, testPlanStart, type TestPlanInput, type TestPlanOutput } from "./testplan";
import { setRun, type StepTools } from "./workflow";

// S4-2 and S4-4: the Persona agent and the test plan, each about one brief version.

type Loaded = {
  campaignId: string;
  version: number;
  brandId: string;
  brandName: string;
  voice: string;
  isSimulated: boolean;
  brief: StoredBrief;
  /** Context items by id, for segment titles and facts. */
  items: Record<string, { kind: string; title: string; body: string }>;
};

async function loadVersion(tx: Tx, campaignId: string, version: number): Promise<Loaded | null> {
  const [c] = await tx`
    select c.id, c.brand_id, b.name, b.tone_words, b.voice_notes, b.is_simulated, v.brief
    from public.campaigns c join public.brands b on b.id = c.brand_id
    join public.brief_versions v on v.campaign_id = c.id and v.version = ${version}
    where c.id = ${campaignId}`;
  if (!c) return null;
  const rows = await tx`select id, kind, title, body from public.context_items where brand_id = ${c.brand_id} and kind in ('segment', 'insight', 'product', 'result')`;
  return {
    campaignId: c.id,
    version,
    brandId: c.brand_id,
    brandName: c.name,
    voice: [(c.tone_words as string[]).join(", "), c.voice_notes as string].filter(Boolean).join(". ").slice(0, 2500),
    isSimulated: c.is_simulated,
    brief: storedBrief.parse(c.brief),
    items: Object.fromEntries(rows.map((r) => [r.id as string, { kind: r.kind as string, title: r.title as string, body: r.body as string }])),
  };
}

/** Segment size from its text ("415 of 2,000 customers", "1,303 customers"), for ordering. */
export function segmentSize(body: string): number {
  const m = /([\d,]+) (?:of [\d,]+ )?customers/.exec(body);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

/** Up to four segments: the brief's audiences first, then the largest others (S4-2). */
export function segmentIds(l: Loaded): string[] {
  const chosen = l.brief.audiences.map((a) => a.segmentRef).filter((id) => l.items[id]?.kind === "segment");
  const others = Object.entries(l.items)
    .filter(([id, i]) => i.kind === "segment" && !chosen.includes(id))
    .sort((a, b) => segmentSize(b[1].body) - segmentSize(a[1].body) || a[1].title.localeCompare(b[1].title))
    .map(([id]) => id);
  return [...new Set([...chosen, ...others])].slice(0, 4);
}

export function pickSegments(l: Loaded): PersonaInput["segments"] {
  return segmentIds(l).map((id, n) => ({ key: `P${n + 1}`, title: l.items[id].title, facts: l.items[id].body.slice(0, 800) }));
}

function reviewBrief(l: Loaded): PersonaInput["brief"] {
  return {
    title: l.brief.title,
    summary: l.brief.summary,
    story: l.brief.story,
    insights: l.brief.insights.map((i) => i.text),
    audiences: l.brief.audiences.map((a) => ({ segment: l.items[a.segmentRef]?.title ?? "A segment", why: a.why })),
    channels: l.brief.channels,
    kpi: `${l.brief.kpi.metric}${l.brief.kpi.target ? ` (${l.brief.kpi.target})` : ""}`,
  };
}

type Prepared<I> = { ok: true; loaded: Loaded; input: I } | { ok: false; message: string };
type Modelled<O> = { ok: true; output: O } | { ok: false; reason: "cap" | "error"; message: string };

async function systemStep(ctx: StepContext, name: string, input: unknown, output: unknown, error: string | null, started: number) {
  await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
    values (${ctx.runId}, ${ctx.workspaceId}, 1, ${name}, 'system', ${error ? "failed" : "succeeded"},
            ${tx.json(input as never)}, ${output === null ? null : tx.json(output as never)}, ${error}, ${Date.now() - started}, now())
    on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
      duration_ms = excluded.duration_ms, finished_at = now()`);
}

async function stop(ctx: StepContext, step: StepTools, r: { reason?: "cap" | "error"; message: string }) {
  const status = r.reason === "cap" ? "stopped_cap" : "failed";
  await step.run("stop", () => setRun(ctx, status, { error: r.message }));
  return status;
}

export async function executePersonaRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));
  const prepared = await step.run("pick-segments", async (): Promise<Prepared<PersonaInput>> => {
    const started = Date.now();
    const res = await asUser(ctx.userId, async (tx): Promise<Prepared<PersonaInput> & { raw: unknown }> => {
      const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
      const start = personaStart.safeParse(run?.input);
      if (!start.success) return { ok: false, message: "The run's input is not a persona review request.", raw: run?.input ?? {} };
      const l = await loadVersion(tx, start.data.campaignId, start.data.version);
      if (!l) return { ok: false, message: "The campaign or brief version no longer exists, or isn't in this workspace.", raw: start.data };
      const segments = pickSegments(l);
      if (segments.length === 0) return { ok: false, message: "No segments to build personas from. Run Find audiences on the brand first.", raw: start.data };
      return { ok: true, loaded: l, input: { brandName: l.brandName, voice: l.voice, brief: reviewBrief(l), segments }, raw: start.data };
    });
    await systemStep(ctx, "Pick segments", res.raw, res.ok ? { segments: res.input.segments.map((s) => s.title) } : null, res.ok ? null : res.message, started);
    const { raw: _raw, ...rest } = res;
    void _raw;
    return rest;
  });
  if (!prepared.ok) return stop(ctx, step, prepared);

  const written = await step.run("review", async (): Promise<Modelled<PersonaOutput>> => {
    try {
      return { ok: true, output: (await runModelStep(ctx, personaAgent, prepared.input, 2, "Personas review the brief")).output };
    } catch (err) {
      return { ok: false, reason: err instanceof CapExceededError ? "cap" : "error", message: err instanceof Error ? err.message : String(err) };
    }
  });
  if (!written.ok) return stop(ctx, step, written);

  return step.run("save", async () => {
    const l = prepared.loaded;
    const ids = segmentIds(l);
    const personas = written.output.personas.map((p) => {
      const n = Number(p.key.slice(1)) - 1;
      const seg = prepared.input.segments[n];
      return { ...p, segment: { id: ids[n] ?? null, title: seg.title, facts: seg.facts } };
    });
    const crit = ["relevance", "clarity", "credibility", "brandFit"] as const;
    const avg = (xs: number[]) => Math.round((10 * xs.reduce((s, x) => s + x, 0)) / xs.length) / 10;
    const averages = Object.fromEntries(crit.map((k) => [k, avg(personas.map((p) => p.scores[k]))])) as Record<(typeof crit)[number], number>;
    const overall = avg(crit.map((k) => averages[k]));
    const review = { personas, averages, overall, synthetic: true, simulatedData: l.isSimulated };
    await asUser(ctx.userId, (tx) => tx`
      insert into public.persona_reviews (workspace_id, campaign_id, brief_version, run_id, review, created_by)
      values (${ctx.workspaceId}, ${l.campaignId}, ${l.version}, ${ctx.runId}, ${tx.json(review as never)}, ${ctx.userId})
      on conflict (run_id) do nothing`);
    await setRun(ctx, "completed", {
      output: { summary: `${personas.length} synthetic personas scored version ${l.version}: ${overall} out of 5 overall.`, href: `/campaigns/${l.campaignId}#personas`, hrefLabel: "See the persona review" },
    });
    return "completed";
  });
}

export async function executeTestPlanRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));
  const prepared = await step.run("read-brief", async (): Promise<Prepared<TestPlanInput>> => {
    const started = Date.now();
    const res = await asUser(ctx.userId, async (tx): Promise<Prepared<TestPlanInput> & { raw: unknown }> => {
      const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
      const start = testPlanStart.safeParse(run?.input);
      if (!start.success) return { ok: false, message: "The run's input is not a test plan request.", raw: run?.input ?? {} };
      const l = await loadVersion(tx, start.data.campaignId, start.data.version);
      if (!l) return { ok: false, message: "The campaign or brief version no longer exists, or isn't in this workspace.", raw: start.data };
      return {
        ok: true,
        loaded: l,
        raw: start.data,
        input: {
          brandName: l.brandName,
          title: l.brief.title,
          summary: l.brief.summary,
          kpi: l.brief.kpi.metric,
          insights: l.brief.insights.map((i, n) => ({ tag: `I${n + 1}`, text: i.text })),
          audiences: l.brief.audiences.map((a, n) => ({ tag: `A${n + 1}`, segment: l.items[a.segmentRef]?.title ?? "A segment", why: a.why })),
          channels: l.brief.channels.map((c) => c.channel),
        },
      };
    });
    await systemStep(ctx, "Read the brief", res.raw, res.ok ? { insights: res.input.insights.length, audiences: res.input.audiences.length } : null, res.ok ? null : res.message, started);
    const { raw: _raw, ...rest } = res;
    void _raw;
    return rest;
  });
  if (!prepared.ok) return stop(ctx, step, prepared);

  const written = await step.run("plan", async (): Promise<Modelled<TestPlanOutput>> => {
    try {
      return { ok: true, output: (await runModelStep(ctx, testPlanAgent, prepared.input, 2, "Write the test plan")).output };
    } catch (err) {
      return { ok: false, reason: err instanceof CapExceededError ? "cap" : "error", message: err instanceof Error ? err.message : String(err) };
    }
  });
  if (!written.ok) return stop(ctx, step, written);

  return step.run("save", async () => {
    const l = prepared.loaded;
    const insight = (tag: string) => l.brief.insights[Number(tag.slice(1)) - 1];
    const audience = (tag: string) => (tag === "all" ? null : l.brief.audiences[Number(tag.slice(1)) - 1]);
    const plan = {
      hypotheses: written.output.hypotheses.map((h) => ({
        ...h,
        insight: insight(h.insightRef)?.text ?? null,
        audience: audience(h.audienceRef) ? { segmentRef: audience(h.audienceRef)!.segmentRef, title: l.items[audience(h.audienceRef)!.segmentRef]?.title ?? null } : null,
      })),
      note: "No sample sizes or run lengths: a launch in the campaign simulator has its own daily budget and length in days, which a person approves.",
    };
    await asUser(ctx.userId, (tx) => tx`
      insert into public.test_plans (workspace_id, campaign_id, brief_version, run_id, plan, created_by)
      values (${ctx.workspaceId}, ${l.campaignId}, ${l.version}, ${ctx.runId}, ${tx.json(plan as never)}, ${ctx.userId})
      on conflict (run_id) do nothing`);
    await setRun(ctx, "completed", {
      output: { summary: `${plan.hypotheses.length} hypotheses for version ${l.version}.`, href: `/campaigns/${l.campaignId}#test-plan`, hrefLabel: "See the test plan" },
    });
    return "completed";
  });
}
