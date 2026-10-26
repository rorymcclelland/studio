import { asUser } from "@/lib/db/scoped";
import { CapExceededError, type WebSource } from "@/lib/models/generate";
import { marketAgent, marketStart, type MarketInput, type MarketOutput } from "./market";
import { runModelStep, type StepContext } from "./model-step";
import { setRun, type StepTools } from "./workflow";

type Prepared = { ok: true; brandId: string; isSimulated: boolean; input: MarketInput } | { ok: false; message: string };
type Found = { ok: true; output: MarketOutput; sources: WebSource[] } | { ok: false; reason: "cap" | "error"; message: string };

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/**
 * S4-3: read the brand (system step), search and write notes (model step with
 * web search and the source checks), then replace the brand's market notes.
 */
export async function executeMarketRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  const prepared = await step.run("read-brand", async (): Promise<Prepared> => {
    return asUser(ctx.userId, async (tx) => {
      const started = Date.now();
      const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
      const start = marketStart.safeParse(run?.input);
      const [b] = start.success ? await tx`select id, name, category, description, banned_terms, is_simulated from public.brands where id = ${start.data.brandId}` : [];
      const products = b ? await tx`select name, category from public.products where brand_id = ${b.id} and active order by name limit 30` : [];
      const result: Prepared = b
        ? {
            ok: true,
            brandId: b.id,
            isSimulated: b.is_simulated,
            input: {
              brandName: b.name,
              category: b.category || "general retail",
              description: b.description,
              products: products.map((p) => `${p.name} (${p.category})`),
              bannedTerms: b.banned_terms,
              month: new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" }),
            },
          }
        : { ok: false, message: "The brand no longer exists, or isn't in this workspace." };
      await tx`
        insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
        values (${ctx.runId}, ${ctx.workspaceId}, 1, 'Read the brand', 'system', ${result.ok ? "succeeded" : "failed"},
                ${tx.json((run?.input ?? {}) as never)}, ${result.ok ? tx.json({ category: result.input.category, products: result.input.products.length } as never) : null},
                ${result.ok ? null : result.message}, ${Date.now() - started}, now())
        on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error, finished_at = now()`;
      return result;
    });
  });
  if (!prepared.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: prepared.message }));
    return "failed";
  }

  const found = await step.run("search-and-write", async (): Promise<Found> => {
    try {
      const { output, sources } = await runModelStep(ctx, marketAgent, prepared.input, 2, "Search the web and write market notes");
      return { ok: true, output, sources };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const noPages = /search returned no pages/.test(message);
      return { ok: false, reason: err instanceof CapExceededError ? "cap" : "error", message: noPages ? "No market notes found: the web search returned no pages. Nothing was saved." : message };
    }
  });
  if (!found.ok) {
    await step.run("stop", () => setRun(ctx, found.reason === "cap" ? "stopped_cap" : "failed", { error: found.message }));
    return found.reason === "cap" ? "stopped_cap" : "failed";
  }

  return step.run("save-notes", async () => {
    const checkedAt = new Date();
    const day = checkedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
    const byUrl = new Map(found.sources.map((s) => [s.url.replace(/#.*$/, "").replace(/\/$/, "").toLowerCase(), s]));
    const saved = await asUser(ctx.userId, async (tx) => {
      const refs: string[] = [];
      for (const [i, n] of found.output.notes.entries()) {
        const ref = `market:${i + 1}`;
        refs.push(ref);
        const sources = n.sources.map((u) => {
          const s = byUrl.get(u.replace(/#.*$/, "").replace(/\/$/, "").toLowerCase());
          return { url: s?.url ?? u, title: s?.title ?? null, citedText: (s?.citedText ?? []).slice(0, 3).map((t) => t.slice(0, 500)) };
        });
        const body =
          `${n.text} Sources: ${sources.map((s) => `${s.title ?? host(s.url)} (${host(s.url)})`).join("; ")}. ` +
          `From the web via the Market agent, checked ${day}.`;
        await tx`
          insert into public.context_items (workspace_id, brand_id, kind, title, body, source, source_ref, tags, created_by_kind, meta)
          values (${ctx.workspaceId}, ${prepared.brandId}, 'result', ${n.title}, ${body.slice(0, 4000)}, 'Market agent', ${ref},
                  ${["market", n.kind]}, 'agent', ${tx.json({ kind: n.kind, sources, names: n.names, checkedAt: checkedAt.toISOString(), runId: ctx.runId } as never)})
          on conflict (brand_id, source_ref) do update set title = excluded.title, body = excluded.body, tags = excluded.tags,
            meta = excluded.meta, created_by_kind = 'agent', source = excluded.source`;
      }
      await tx`delete from public.context_items where brand_id = ${prepared.brandId} and kind = 'result' and created_by_kind = 'agent'
                 and source_ref like 'market:%' and not (source_ref = any(${refs}))`;
      return refs.length;
    });
    await setRun(ctx, "completed", {
      output: {
        summary: `${saved} market notes saved from ${found.sources.length} pages, checked ${day}.`,
        sources: found.sources.map((s) => s.url),
        href: `/brands/${prepared.brandId}#market`,
        hrefLabel: "See the market notes",
      },
    });
    return "completed";
  });
}
