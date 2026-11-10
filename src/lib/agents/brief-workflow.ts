import { z } from "zod";
import { kitListsFor } from "@/lib/brief/checks";
import { gatherContext, type GatheredItem } from "@/lib/brief/gather";
import { addVersion, StaleBriefError } from "@/lib/brief/versions";
import { storedBrief, type BriefCore, type StoredBrief } from "@/lib/brief/schema";
import { asUser } from "@/lib/db/scoped";
import { CapExceededError } from "@/lib/models/generate";
import { briefAgent, briefStart, type BriefInput } from "./brief";
import { runModelStep, type StepContext } from "./model-step";
import { setRun, type StepTools } from "./workflow";

type Start = z.infer<typeof briefStart>;

type Prepared =
  | {
      ok: true;
      start: Start;
      campaignId: string;
      brandId: string;
      baseVersion: number;
      /** D-4: the base version's campaign line, kept in a revision (the Brief agent never writes one). */
      line: string | null;
      input: BriefInput;
      /** Tag to context item id. */
      refs: Record<string, string>;
    }
  | { ok: false; message: string };

type Written = { ok: true; output: BriefCore } | { ok: false; reason: "cap" | "error"; message: string };

const describe = (s: Start) => (s.mode === "draft" ? "Write the brief" : `Revise the brief${s.section ? ` (${s.section})` : ""}`);

/** Maps a stored brief's item ids to prompt tags, adding any cited item the gather left out. */
function toTags(brief: StoredBrief, items: GatheredItem[], extra: GatheredItem[]): BriefCore {
  const all = [...items, ...extra];
  const tag = (id: string) => all.find((i) => i.id === id)?.ref ?? id;
  return {
    title: brief.title,
    summary: brief.summary,
    story: brief.story,
    insights: brief.insights.map((i) => ({ text: i.text, cites: i.cites.map(tag) })),
    audiences: brief.audiences.map((a) => ({ segmentRef: tag(a.segmentRef), why: a.why })),
    channels: brief.channels,
    kpi: brief.kpi,
  };
}

/** Maps a reply's tags back to item ids and adds the kit's lists (S3-2). */
export function toStored(core: BriefCore, refs: Record<string, string>, kit: BriefInput["kit"]): StoredBrief {
  const id = (t: string) => refs[t] ?? t;
  return storedBrief.parse({
    ...core,
    insights: core.insights.map((i) => ({ text: i.text, cites: [...new Set(i.cites.map(id))] })),
    audiences: core.audiences.map((a) => ({ segmentRef: id(a.segmentRef), why: a.why })),
    ...kitListsFor(kit),
  });
}

/**
 * S3-2 and S3-3: gather context (system step), write or revise the brief
 * (model step, with the evidence checks and one repair), then save version 1
 * or hold the revision as a proposal for a person to accept or discard.
 */
export async function executeBriefRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  const prepared = await step.run("gather-context", async (): Promise<Prepared> => {
    return asUser(ctx.userId, async (tx) => {
      const started = Date.now();
      const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
      const parsed = briefStart.safeParse(run?.input);
      let result: Prepared;
      if (!parsed.success) result = { ok: false, message: "The run's input is not a brief request." };
      else {
        const start = parsed.data;
        const [c] = await tx`select id, brand_id, objective, current_version from public.campaigns where id = ${start.campaignId}`;
        const gathered = c ? await gatherContext(tx, c.brand_id, c.objective) : null;
        if (!c || !gathered) result = { ok: false, message: "The campaign no longer exists, or isn't in this workspace." };
        else if (start.mode === "revise" && start.baseVersion !== c.current_version) {
          result = { ok: false, message: "This brief changed since the revision was asked for. Open the latest version and ask again." };
        } else {
          let revise: BriefInput["revise"];
          let line: string | null = null;
          const extra: GatheredItem[] = [];
          if (start.mode === "revise") {
            const [v] = await tx`select brief from public.brief_versions where campaign_id = ${c.id} and version = ${start.baseVersion}`;
            const current = storedBrief.parse(v.brief);
            line = current.line ?? null;
            // Items the current brief cites that the gather did not pick still go in the prompt.
            const known = new Set(gathered.items.map((i) => i.id));
            const missing = [...new Set([...current.insights.flatMap((i) => i.cites), ...current.audiences.map((a) => a.segmentRef)])].filter((id) => !known.has(id));
            if (missing.length) {
              const rows = await tx`select id, kind, title, body from public.context_items where id = any(${missing}) and brand_id = ${c.brand_id}`;
              rows.forEach((r, n) => extra.push({ ref: `C${gathered.items.length + n + 1}`, id: r.id, kind: r.kind, title: r.title, text: (r.body as string).slice(0, 600) }));
            }
            revise = { current: toTags(current, gathered.items, extra), section: start.section, instruction: start.instruction };
          }
          const items = [...gathered.items, ...extra];
          result = {
            ok: true,
            start,
            campaignId: c.id,
            brandId: c.brand_id,
            baseVersion: c.current_version,
            line,
            refs: Object.fromEntries(items.map((i) => [i.ref, i.id])),
            input: {
              brandName: gathered.brand.name,
              objective: c.objective,
              voice: gathered.brand.voice,
              doRules: gathered.brand.doRules,
              kit: gathered.kit,
              context: items.map((i) => ({ tag: i.ref, kind: i.kind, title: i.title, text: i.text })),
              revise,
            },
          };
        }
      }
      await tx`
        insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
        values (${ctx.runId}, ${ctx.workspaceId}, 1, 'Gather context', 'system', ${result.ok ? "succeeded" : "failed"},
                ${tx.json((run?.input ?? {}) as never)},
                ${result.ok ? tx.json({ items: result.input.context.length, refs: result.refs } as never) : null},
                ${result.ok ? null : result.message}, ${Date.now() - started}, now())
        on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
          duration_ms = excluded.duration_ms, finished_at = now()`;
      return result;
    });
  });
  if (!prepared.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: prepared.message }));
    return "failed";
  }

  const written = await step.run("write-brief", async (): Promise<Written> => {
    try {
      const { output } = await runModelStep(ctx, briefAgent, prepared.input, 2, describe(prepared.start));
      return { ok: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: err instanceof CapExceededError ? "cap" : "error", message };
    }
  });
  if (!written.ok) {
    await step.run("stop", () => setRun(ctx, written.reason === "cap" ? "stopped_cap" : "failed", { error: written.message }));
    return written.reason === "cap" ? "stopped_cap" : "failed";
  }

  return step.run("save", async () => {
    const { line: _dropped, ...core } = written.output;
    void _dropped;
    const brief = toStored({ ...core, ...(prepared.line ? { line: prepared.line } : {}) }, prepared.refs, prepared.input.kit);
    const href = `/campaigns/${prepared.campaignId}`;
    if (prepared.start.mode === "draft") {
      try {
        const version = await asUser(ctx.userId, async (tx) => {
          // A retried step finds the version it already wrote (one per run, enforced by an index).
          const [done] = await tx`select version from public.brief_versions where run_id = ${ctx.runId}`;
          if (done) return done.version as number;
          return addVersion(tx, { userId: ctx.userId, workspaceId: ctx.workspaceId }, prepared.campaignId, prepared.baseVersion, brief, "agent", { runId: ctx.runId });
        });
        await setRun(ctx, "completed", { output: { summary: `Version ${version}: ${brief.title}`, version, href, hrefLabel: "Open the brief" } });
        return "completed";
      } catch (err) {
        if (err instanceof StaleBriefError) {
          await setRun(ctx, "failed", { error: err.message });
          return "failed";
        }
        throw err;
      }
    }
    await setRun(ctx, "completed", {
      output: {
        summary: `Proposed revision of version ${prepared.baseVersion}${prepared.start.section ? ` (${prepared.start.section})` : ""}: waiting for you to use or discard it.`,
        proposal: brief,
        baseVersion: prepared.baseVersion,
        section: prepared.start.section,
        instruction: prepared.start.instruction,
        resolution: null,
        href,
        hrefLabel: "Compare it with the current brief",
      },
    });
    return "completed";
  });
}
