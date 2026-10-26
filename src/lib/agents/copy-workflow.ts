import { COPY_CHANNELS, SETS_PER_AUDIENCE, type CopyChannel } from "@/lib/creative/copy-rules";
import { insightsWithEvidence, loadCopyContext, NOT_SIGNED_OFF, taggedAudiences } from "@/lib/creative/copy-context";
import { asUser } from "@/lib/db/scoped";
import { CapExceededError } from "@/lib/models/generate";
import { copyAgent, copyStart, type CopyInput, type CopyOutput, type CopyStart } from "./copy";
import { runModelStep, type StepContext } from "./model-step";
import { setRun, type StepTools } from "./workflow";

// S5-2: read the signed-off brief (system step), write the copy (model step,
// with the checks and one repair), then save the sets with the kit's legal
// lines. Nothing here spends ad money, publishes or replaces creative: new
// words wait beside the set they would replace until a person keeps one
// (rule 3).

export const OUT_OF_HOME_NOTE = "Out-of-home was skipped: the Copy agent doesn't write poster copy yet.";

type Prepared =
  | {
      ok: true;
      start: CopyStart;
      campaignId: string;
      version: number;
      input: CopyInput;
      /** Audience tag to the brief's segment. */
      audiences: Record<string, { segmentRef: string | null; title: string }>;
      legalLines: string[];
      notes: string[];
    }
  | { ok: false; message: string };

type Written = { ok: true; output: CopyOutput } | { ok: false; reason: "cap" | "error"; message: string };

async function prepare(ctx: StepContext): Promise<{ result: Prepared; raw: unknown }> {
  return asUser(ctx.userId, async (tx) => {
    const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
    const parsed = copyStart.safeParse(run?.input);
    if (!parsed.success) return { result: { ok: false, message: "The run's input is not a copy request." }, raw: run?.input ?? {} };
    const start = parsed.data;
    const raw = start;
    const [c] = await tx`select status, approved_version from public.campaigns where id = ${start.campaignId}`;
    if (!c) return { result: { ok: false, message: "The campaign no longer exists, or isn't in this workspace." }, raw };
    // The gate (rule 3, S4-1): creative starts only from a signed-off brief.
    if (c.status !== "approved" || !c.approved_version) return { result: { ok: false, message: NOT_SIGNED_OFF }, raw };
    const context = await loadCopyContext(tx, start.campaignId);
    if (!context) return { result: { ok: false, message: "The signed-off brief version no longer exists." }, raw };
    const tagged = taggedAudiences(context);
    const audiences = Object.fromEntries(tagged.map((a) => [a.tag, { segmentRef: a.segmentRef, title: a.segment }]));

    let write: CopyInput["write"];
    let replace: CopyInput["replace"];
    const notes: string[] = [];
    if (start.mode === "replace") {
      const [s] = await tx`select channel, segment_ref, brief_version, set, discarded_at from public.copy_sets where id = ${start.setId} and campaign_id = ${start.campaignId}`;
      if (!s) return { result: { ok: false, message: "That copy set no longer exists, or isn't in this workspace." }, raw };
      if (s.discarded_at) return { result: { ok: false, message: "That copy set was discarded, so there is nothing to replace." }, raw };
      if (s.brief_version !== context.version) {
        return { result: { ok: false, message: `That set was written for version ${s.brief_version}; the signed-off brief is now version ${context.version}.` }, raw };
      }
      const a = tagged.find((x) => x.segmentRef === (s.segment_ref ?? null));
      if (!a) return { result: { ok: false, message: "That set's audience is no longer in the signed-off brief." }, raw };
      write = [{ channel: s.channel as CopyChannel, audience: a.tag, sets: 1 }];
      replace = { channel: s.channel as CopyChannel, audience: a.tag, copy: s.set as Record<string, unknown> };
    } else {
      const channels = context.brief.channels.map((x) => x.channel);
      const writable = channels.filter((x): x is CopyChannel => (COPY_CHANNELS as readonly string[]).includes(x));
      if (channels.includes("out-of-home")) notes.push(OUT_OF_HOME_NOTE);
      if (writable.length === 0) return { result: { ok: false, message: `${OUT_OF_HOME_NOTE} The brief has no other channel to write for.` }, raw };
      write = writable.flatMap((channel) => tagged.map((a) => ({ channel, audience: a.tag, sets: SETS_PER_AUDIENCE[channel] })));
    }

    const b = context.brief;
    const input: CopyInput = {
      brandName: context.brandName,
      voice: context.voice,
      doRules: context.doRules,
      dontRules: context.kit.dontRules,
      bannedTerms: context.kit.bannedTerms,
      evidenceClaims: context.kit.evidenceClaims,
      realNames: context.kit.realNames,
      products: context.products,
      places: context.places,
      legalLines: context.kit.legalLines,
      brief: {
        title: b.title,
        summary: b.summary,
        story: b.story,
        insights: insightsWithEvidence(context),
        audiences: tagged.map(({ tag, segment, why, facts }) => ({ tag, segment, why, facts })),
        channels: b.channels,
        kpi: `${b.kpi.metric}${b.kpi.target ? ` (${b.kpi.target})` : ""}`,
      },
      write,
      replace,
    };
    return {
      result: { ok: true, start, campaignId: start.campaignId, version: context.version, input, audiences, legalLines: context.kit.legalLines, notes },
      raw,
    };
  });
}

export async function executeCopyRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  const prepared = await step.run("read-brief", async (): Promise<Prepared> => {
    const started = Date.now();
    const { result, raw } = await prepare(ctx);
    await asUser(ctx.userId, (tx) => tx`
      insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
      values (${ctx.runId}, ${ctx.workspaceId}, 1, 'Read the signed-off brief', 'system', ${result.ok ? "succeeded" : "failed"},
              ${tx.json(raw as never)},
              ${result.ok ? tx.json({ version: result.version, write: result.input.write, audiences: result.audiences, notes: result.notes } as never) : null},
              ${result.ok ? null : result.message}, ${Date.now() - started}, now())
      on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
        duration_ms = excluded.duration_ms, finished_at = now()`);
    return result;
  });
  if (!prepared.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: prepared.message }));
    return "failed";
  }

  const replacing = prepared.start.mode === "replace";
  const written = await step.run("write-copy", async (): Promise<Written> => {
    try {
      const { output } = await runModelStep(ctx, copyAgent, prepared.input, 2, replacing ? "Write new words" : "Write the copy");
      return { ok: true, output };
    } catch (err) {
      return { ok: false, reason: err instanceof CapExceededError ? "cap" : "error", message: err instanceof Error ? err.message : String(err) };
    }
  });
  if (!written.ok) {
    await step.run("stop", () => setRun(ctx, written.reason === "cap" ? "stopped_cap" : "failed", { error: written.message }));
    return written.reason === "cap" ? "stopped_cap" : "failed";
  }

  return step.run("save", async () => {
    const basedOn = prepared.start.mode === "replace" ? prepared.start.setId : null;
    const saved = await asUser(ctx.userId, async (tx) => {
      // A retried step finds the sets it already wrote.
      const [done] = await tx`select count(*)::int as n from public.copy_sets where run_id = ${ctx.runId}`;
      if (done.n > 0) return done.n as number;
      for (const s of written.output.sets) {
        const a = prepared.audiences[s.audience];
        // clock_timestamp keeps the sets in the order they were written.
        await tx`
          insert into public.copy_sets (workspace_id, campaign_id, brief_version, run_id, channel, segment_ref, segment_title, set, legal_lines, source, based_on, created_by, created_at)
          values (${ctx.workspaceId}, ${prepared.campaignId}, ${prepared.version}, ${ctx.runId}, ${s.channel}, ${a.segmentRef}, ${a.title},
                  ${tx.json(s.copy as never)}, ${prepared.legalLines}, 'agent', ${basedOn}, ${ctx.userId}, clock_timestamp())`;
      }
      return written.output.sets.length;
    });
    const counts = new Map<string, number>();
    for (const s of written.output.sets) counts.set(s.channel, (counts.get(s.channel) ?? 0) + 1);
    const breakdown = [...counts].map(([c, n]) => `${c} ${n}`).join(", ");
    const first = written.output.sets[0];
    const summary = replacing
      ? `New words for one ${first.channel} set (${prepared.audiences[first.audience].title}), waiting beside the set they would replace.`
      : `${saved} copy sets for version ${prepared.version} (${breakdown}).${prepared.notes.length ? ` ${prepared.notes.join(" ")}` : ""}`;
    await setRun(ctx, "completed", {
      output: { summary, version: prepared.version, sets: saved, notes: prepared.notes, href: `/campaigns/${prepared.campaignId}#copy`, hrefLabel: "See the copy" },
    });
    return "completed";
  });
}
