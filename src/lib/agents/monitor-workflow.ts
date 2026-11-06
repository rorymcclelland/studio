import { asUser } from "@/lib/db/scoped";
import { CapExceededError } from "@/lib/models/generate";
import { runPlan } from "@/lib/performance/ask";
import { CANNOT_ANSWER, type AnswerablePlan, type QueryResult } from "@/lib/performance/ask-rules";
import { launchAdsFor, type LaunchAd } from "@/lib/performance/launch";
import { AgentOutputError, runModelStep, type StepContext } from "./model-step";
import { describePlan, monitorAnswerAgent, monitorPlanAgent, monitorStart, type MonitorPlanInput, type MonitorPlanOutput } from "./monitor";
import { setRun, type StepTools } from "./workflow";

// P9-4: Ask about this campaign, as one run. The question is read again
// through asUser() (a question that isn't this run's workspace's fails the
// run, untouched), then:
//   1. Plan the query (model, monitorPlan): a closed schema, checked in code.
//   2. Run the query (system): code runs the plan over the campaign's own rows.
//   3. Write the answer (model, monitorAnswer): every figure checked against
//      the result, with one repair.
// The question's row is filled in as it goes. An unanswerable question gets
// the fixed reply and runs no query. Nothing here acts on the campaign: it
// reads and answers (rule 3). Both model steps go through runModelStep and
// generate() (rules 4 and 5).

const PREFIX = "The question wasn't answered: ";
const REFUSED_MAX = 500;

type Prepared =
  | { ok: true; questionId: string; question: string; launchId: string; campaignId: string; input: MonitorPlanInput }
  | { ok: false; message: string };

type ModelOutcome<T> = { ok: true; output: T } | { ok: false; cap: boolean; message: string };

const cut = (s: string) => (s.length > REFUSED_MAX ? `${s.slice(0, REFUSED_MAX - 1)}…` : s);

function failure(err: unknown, what: "plan" | "answer"): { ok: false; cap: boolean; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof CapExceededError) return { ok: false, cap: true, message: `${PREFIX}the daily AI cap was reached.` };
  if (err instanceof AgentOutputError) {
    const problems = message.replace(/^The agent's reply (failed its checks|did not match the expected format): /, "");
    return { ok: false, cap: false, message: cut(`${PREFIX}the AI's ${what} still broke a rule after one repair (${problems}).`) };
  }
  return { ok: false, cap: false, message: cut(`${PREFIX}the model call failed (${message}).`) };
}

async function prepare(ctx: StepContext): Promise<Prepared> {
  const read = await asUser(ctx.userId, async (tx) => {
    const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
    const start = monitorStart.safeParse(run?.input);
    if (!start.success) return { ok: false as const, message: `${PREFIX}the run doesn't name a question.` };
    const [q] = await tx`
      select q.id, q.question, q.run_id, q.answer, q.refused, l.id as launch_id, l.campaign_id, l.ads, l.sim_day, l.days,
        to_char(l.starts_on, 'YYYY-MM-DD') as starts_on
      from public.performance_questions q join public.launches l on l.id = q.launch_id
      where q.id = ${start.data.questionId} and q.workspace_id = ${ctx.workspaceId}`;
    if (!q) return { ok: false as const, message: `${PREFIX}the question isn't in this workspace.` };
    if ((q.run_id && q.run_id !== ctx.runId) || q.answer !== null || q.refused !== null) {
      return { ok: false as const, message: `${PREFIX}it belongs to another run.` };
    }
    if (!q.run_id) await tx`update public.performance_questions set run_id = ${ctx.runId} where id = ${q.id} and run_id is null`;
    return {
      ok: true as const,
      questionId: q.id as string,
      question: q.question as string,
      launchId: q.launch_id as string,
      campaignId: q.campaign_id as string,
      ads: q.ads as LaunchAd[],
      simDay: q.sim_day as number,
      days: q.days as number,
      startsOn: q.starts_on as string,
    };
  });
  if (!read.ok) return read;
  if (read.simDay < 1) return { ok: false, message: `${PREFIX}there are no simulated results yet.` };
  const views = await launchAdsFor(ctx.userId, read.campaignId, read.ads);
  return {
    ok: true,
    questionId: read.questionId,
    question: read.question,
    launchId: read.launchId,
    campaignId: read.campaignId,
    input: {
      question: read.question,
      simDay: read.simDay,
      days: read.days,
      startsOn: read.startsOn,
      ads: views.map((v) => ({ adNumber: v.adNumber, headline: v.headline.slice(0, 200) })),
    },
  };
}

/** Fills in the question's row as the run goes. */
async function fill(ctx: StepContext, questionId: string, fields: { plan?: unknown; result?: unknown; answer?: string; refused?: string }) {
  await asUser(ctx.userId, async (tx) => {
    if (fields.plan !== undefined) await tx`update public.performance_questions set plan = ${tx.json(fields.plan as never)} where id = ${questionId}`;
    if (fields.result !== undefined) await tx`update public.performance_questions set result = ${tx.json(fields.result as never)} where id = ${questionId}`;
    if (fields.answer !== undefined || fields.refused !== undefined) {
      await tx`update public.performance_questions set answer = ${fields.answer ?? null}, refused = ${fields.refused ?? null} where id = ${questionId}`;
    }
  });
}

async function systemStep(ctx: StepContext, seq: number, name: string, input: unknown, output: unknown, error: string | null, started: number) {
  await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
    values (${ctx.runId}, ${ctx.workspaceId}, ${seq}, ${name}, 'system', ${error ? "failed" : "succeeded"},
            ${tx.json((input ?? {}) as never)}, ${output === null ? null : tx.json(output as never)}, ${error}, ${Date.now() - started}, now())
    on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
      duration_ms = excluded.duration_ms, finished_at = now()`);
}

export async function executeMonitorRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  const prepared = await step.run("read", () => prepare(ctx));
  if (!prepared.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: prepared.message }));
    return "failed";
  }
  const href = `/campaigns/${prepared.campaignId}/performance`;
  const stop = async (outcome: { cap: boolean; message: string }) => {
    await step.run("refuse", async () => {
      await fill(ctx, prepared.questionId, { refused: outcome.message });
      await setRun(ctx, outcome.cap ? "stopped_cap" : "failed", { output: { summary: outcome.message, href, hrefLabel: "See the answer" }, error: outcome.message });
    });
    return outcome.cap ? "stopped_cap" : "failed";
  };

  const planned = await step.run("plan", async (): Promise<ModelOutcome<MonitorPlanOutput>> => {
    try {
      const { output } = await runModelStep(ctx, monitorPlanAgent, prepared.input, 1, "Plan the query");
      await fill(ctx, prepared.questionId, { plan: output });
      return { ok: true, output };
    } catch (err) {
      return failure(err, "plan");
    }
  });
  if (!planned.ok) return stop(planned);

  const plan = planned.output;
  if (!plan.answerable) {
    // The fixed reply; the plan's reason is kept for the trail and never shown as the answer.
    return step.run("cannot-answer", async () => {
      await fill(ctx, prepared.questionId, { answer: CANNOT_ANSWER, refused: plan.reason.slice(0, REFUSED_MAX) });
      await setRun(ctx, "completed", { output: { summary: `${CANNOT_ANSWER}. ${describePlan(plan)}`, href, hrefLabel: "See the answer" } });
      return "completed";
    });
  }

  const queried = await step.run("query", async (): Promise<{ ok: true; result: QueryResult } | { ok: false; message: string }> => {
    const started = Date.now();
    const result = await runPlan(ctx.userId, prepared.launchId, plan as AnswerablePlan);
    if (!result) {
      const message = `${PREFIX}the campaign's launch is no longer there.`;
      await systemStep(ctx, 2, "Run the query", plan, null, message, started);
      return { ok: false, message };
    }
    await systemStep(ctx, 2, "Run the query", plan, { from: result.from, to: result.to, rows: result.rows.length, ads: result.ads }, null, started);
    await fill(ctx, prepared.questionId, { result });
    return { ok: true, result };
  });
  if (!queried.ok) return stop({ cap: false, message: queried.message });

  const answered = await step.run("answer", async (): Promise<ModelOutcome<{ answer: string }>> => {
    try {
      const { output } = await runModelStep(ctx, monitorAnswerAgent, { question: prepared.question, result: queried.result }, 3, "Write the answer");
      return { ok: true, output };
    } catch (err) {
      return failure(err, "answer");
    }
  });
  if (!answered.ok) return stop(answered);

  return step.run("finish", async () => {
    await fill(ctx, prepared.questionId, { answer: answered.output.answer });
    await setRun(ctx, "completed", { output: { summary: answered.output.answer, href, hrefLabel: "See the answer" } });
    return "completed";
  });
}
