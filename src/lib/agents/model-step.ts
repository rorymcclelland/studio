import type { z } from "zod";
import { asUser } from "@/lib/db/scoped";
import { generate, type WebSource } from "@/lib/models/generate";
import { cachedReader } from "@/lib/web/page-text";
import type { AgentDefinition } from "./contract";

export type StepContext = { runId: string; workspaceId: string; userId: string };

export class AgentOutputError extends Error {}

/** Pulls a JSON value out of a model reply: bare, fenced, or embedded. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const candidates = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) candidates.push(fence[1].trim());
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try the next shape
    }
  }
  return undefined;
}

function describeIssues(error: z.ZodError | null): string {
  if (!error) return "The reply was not valid JSON.";
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Runs one model step for an agent and records it in the decision trail:
 * the call, a schema check, and one repair attempt if the output is wrong
 * (S1-5 #4). Throws CapExceededError, ProviderError or AgentOutputError;
 * the step row records the outcome either way.
 */
export async function runModelStep<I, O>(
  ctx: StepContext,
  agent: AgentDefinition<I, O>,
  input: I,
  seq: number,
  name: string,
): Promise<{ output: O; stepId: string; sources: WebSource[]; leftOut: string[] }> {
  const prompt = agent.buildPrompt(input);
  const [step] = await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input)
    values (${ctx.runId}, ${ctx.workspaceId}, ${seq}, ${name}, 'model', 'running',
            ${tx.json({ prompt } as never)})
    on conflict (run_id, seq) do update set status = 'running', attempts = 0,
      input_tokens = 0, output_tokens = 0, cost_pence = 0, error = null, started_at = now()
    returning id`);
  const stepId = step.id as string;
  const started = Date.now();
  let attempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let provider: string | null = null;
  let model: string | null = null;
  let raw = "";
  const sources = new Map<string, WebSource>();
  const readPage = cachedReader();
  const log: { attempt: number; raw: string; truncated: boolean; problems: string[] }[] = [];
  const RAW_LIMIT = 8000;

  const finish = async (status: "succeeded" | "failed", output: unknown, error: string | null) => {
    await asUser(ctx.userId, (tx) => tx`
      update public.agent_steps set status = ${status}, output = ${output === null ? null : tx.json(output as never)},
        raw_output = ${raw}, attempt_log = ${tx.json(log as never)}, provider = ${provider}, model = ${model}, attempts = ${attempts},
        input_tokens = ${inputTokens}, output_tokens = ${outputTokens}, cost_pence = ${cost},
        duration_ms = ${Date.now() - started}, error = ${error}, finished_at = now()
      where id = ${stepId}`);
  };

  try {
    let currentPrompt = prompt;
    for (;;) {
      attempts += 1;
      const res = await generate({
        agent: agent.key,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        stepId,
        instructions: agent.instructions,
        prompt: currentPrompt,
        // Search only on the first attempt; a repair works from the pages already found.
        ...(agent.webSearch && attempts === 1 ? { webSearch: agent.webSearch } : {}),
      });
      for (const src of res.sources) {
        const had = sources.get(src.url);
        sources.set(src.url, had ? { ...had, citedText: [...new Set([...had.citedText, ...src.citedText])] } : src);
      }
      provider = res.provider;
      model = res.model;
      inputTokens += res.inputTokens;
      outputTokens += res.outputTokens;
      cost += res.costPence;
      raw = res.text;
      const json = extractJson(res.text);
      const parsed = json === undefined ? null : agent.output.safeParse(json);
      const extra = { sources: [...sources.values()], readPage };
      const problems = parsed?.success && agent.check ? await agent.check(input, parsed.data, extra) : [];
      if (parsed?.success && problems.length === 0) {
        log.push({ attempt: attempts, raw: res.text.slice(0, RAW_LIMIT), truncated: res.text.length > RAW_LIMIT, problems: [] });
        await finish("succeeded", parsed.data, null);
        return { output: parsed.data, stepId, sources: [...sources.values()], leftOut: [] };
      }
      const issues = parsed?.success ? problems.slice(0, 8).join("; ") : describeIssues(parsed ? parsed.error : null);
      log.push({
        attempt: attempts,
        raw: res.text.slice(0, RAW_LIMIT),
        truncated: res.text.length > RAW_LIMIT,
        problems: parsed?.success ? problems : [issues],
      });
      if (attempts >= 2) {
        const kept = parsed?.success && agent.salvage ? await agent.salvage(input, parsed.data, extra) : null;
        if (kept) {
          log[log.length - 1].problems = [...log[log.length - 1].problems, ...kept.leftOut.map((l) => `left out: ${l}`)];
          await finish("succeeded", kept.output, null);
          return { output: kept.output, stepId, sources: [...sources.values()], leftOut: kept.leftOut };
        }
        throw new AgentOutputError(
          parsed?.success
            ? `The agent's reply failed its checks: ${issues}`
            : `The agent's reply did not match the expected format: ${issues}`,
        );
      }
      currentPrompt = repairPrompt(prompt, issues, res.text, agent.webSearch ? [...sources.values()] : null);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish("failed", null, message);
    throw err;
  }
}

/**
 * The one repair attempt's prompt. An agent that searched can't search again,
 * so it is shown the pages its search found (production check, Sprint 4: the
 * repair otherwise tried to write a search instead of JSON).
 */
export function repairPrompt(prompt: string, issues: string, previous: string, pages: WebSource[] | null): string {
  const json = previous.indexOf("{");
  const reply = (json >= 0 ? previous.slice(json) : previous).slice(0, 12000);
  const parts = [prompt, "", `Your previous reply could not be used (${issues}).`, `Previous reply:\n${reply}`];
  if (pages) {
    const listed = pages.slice(0, 20).map((p) =>
      [`- ${p.url}${p.title ? ` (${p.title.slice(0, 120)})` : ""}`, ...p.citedText.slice(0, 4).map((t) => `  passage: ${JSON.stringify(t.slice(0, 400))}`)].join("\n"),
    );
    parts.push(
      "",
      "Searching is finished and no tools are available. Fix the reply using only these pages your searches found, and cite only these URLs:",
      listed.length ? listed.join("\n") : "(none)",
    );
  }
  parts.push("", "Reply again with JSON only, in the required shape. Do not write any tool calls or other text.");
  return parts.join("\n");
}
