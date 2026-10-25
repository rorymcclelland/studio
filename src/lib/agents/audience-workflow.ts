import { asUser } from "@/lib/db/scoped";
import { candidateFacts, computeCandidates, MIN_SEGMENT_SIZE, type CandidateSet } from "@/lib/audience/candidates";
import { CapExceededError } from "@/lib/models/generate";
import { audienceAgent, type AudienceOutput } from "./audience";
import { runModelStep, type StepContext } from "./model-step";
import { setRun, type StepTools } from "./workflow";

type Found =
  | { ok: true; set: CandidateSet; brandName: string; voice: string; bannedTerms: string[]; isSimulated: boolean }
  | { ok: false; message: string };

type Named = { ok: true; output: AudienceOutput } | { ok: false; reason: "cap" | "error"; message: string };

/**
 * S3-1: count candidate segments in code (a system step), have the model name
 * them, then save them to the brand's context store as agent items. Saving to
 * the store spends and publishes nothing, so no approval (Sprint 3, Q1).
 */
export async function executeAudienceRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  const found = await step.run("find-candidates", async (): Promise<Found> => {
    return asUser(ctx.userId, async (tx) => {
      const started = Date.now();
      const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
      const brandId = String(run.input.brandId ?? "");
      const [brand] = await tx`select id, name, tone_words, voice_notes, banned_terms, is_simulated from public.brands where id = ${brandId}`;
      const set = brand ? await computeCandidates(tx, brandId) : null;
      const message = !brand
        ? "The brand no longer exists, or isn't in this workspace."
        : !set || set.customers === 0
          ? "This brand has no customer data to find segments in."
          : set.candidates.length === 0
            ? `Every candidate segment is too small to target (under ${MIN_SEGMENT_SIZE} customers).`
            : null;
      await tx`
        insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
        values (${ctx.runId}, ${ctx.workspaceId}, 1, 'Count candidate segments', 'system', ${message ? "failed" : "succeeded"},
                ${tx.json({ brandId })}, ${set ? tx.json(set as never) : null}, ${message}, ${Date.now() - started}, now())
        on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
          duration_ms = excluded.duration_ms, finished_at = now()`;
      if (message || !set) return { ok: false, message: message ?? "No candidates." };
      const voice = [(brand.tone_words as string[]).join(", "), brand.voice_notes as string].filter(Boolean).join(". ").slice(0, 2500);
      return { ok: true, set, brandName: brand.name as string, voice, bannedTerms: brand.banned_terms as string[], isSimulated: brand.is_simulated as boolean };
    });
  });
  if (!found.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: found.message }));
    return "failed";
  }

  const named = await step.run("name-segments", async (): Promise<Named> => {
    try {
      const { output } = await runModelStep(
        ctx,
        audienceAgent,
        { brandId: found.set.brandId, brandName: found.brandName, voice: found.voice, bannedTerms: found.bannedTerms, candidates: found.set.candidates },
        2,
        "Name and describe segments",
      );
      return { ok: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: err instanceof CapExceededError ? "cap" : "error", message };
    }
  });
  if (!named.ok) {
    await step.run("stop", () => setRun(ctx, named.reason === "cap" ? "stopped_cap" : "failed", { error: named.message }));
    return named.reason === "cap" ? "stopped_cap" : "failed";
  }

  return step.run("save-segments", async () => {
    const saved = await saveSegments(ctx, found.set, named.output, found.isSimulated);
    await setRun(ctx, "completed", {
      output: {
        summary: `${saved} segments saved to ${found.brandName}'s context${found.set.tooSmall.length ? `; ${found.set.tooSmall.length} too small to target` : ""}.`,
        segments: named.output.segments.map((s) => s.key),
        tooSmall: found.set.tooSmall,
        href: `/brands/${found.set.brandId}#segments`,
        hrefLabel: "See the segments on the brand page",
      },
    });
    return "completed";
  });
}

async function saveSegments(ctx: StepContext, set: CandidateSet, output: AudienceOutput, isSimulated: boolean): Promise<number> {
  const byKey = new Map(set.candidates.map((c) => [c.key, c]));
  const asOf = new Date(set.asOf).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return asUser(ctx.userId, async (tx) => {
    const refs: string[] = [];
    for (const s of output.segments) {
      const c = byKey.get(s.key);
      if (!c) continue;
      const ref = `audience:${s.key}`;
      refs.push(ref);
      const body =
        `${s.description} ${candidateFacts(c, set.customers)} As of ${asOf}. ` +
        `Proposed by the Audience agent.${isSimulated ? " Simulated data." : ""}`;
      await tx`
        insert into public.context_items (workspace_id, brand_id, kind, title, body, source, source_ref, tags, created_by_kind)
        values (${ctx.workspaceId}, ${set.brandId}, 'segment', ${s.name}, ${body.slice(0, 4000)}, 'Audience agent', ${ref},
                ${[s.use, s.key]}, 'agent')
        on conflict (brand_id, source_ref) do update set title = excluded.title, body = excluded.body, tags = excluded.tags,
          created_by_kind = 'agent', source = excluded.source`;
    }
    // A re-run replaces the agent's segments; system and person items are untouched.
    await tx`
      delete from public.context_items
      where brand_id = ${set.brandId} and created_by_kind = 'agent' and source_ref like 'audience:%'
        and not (source_ref = any(${refs}))`;
    return refs.length;
  });
}
