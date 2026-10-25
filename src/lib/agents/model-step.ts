import type { z } from "zod";
import { asUser } from "@/lib/db/scoped";
import { generate } from "@/lib/models/generate";
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
): Promise<{ output: O; stepId: string }> {
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

  const finish = async (status: "succeeded" | "failed", output: unknown, error: string | null) => {
    await asUser(ctx.userId, (tx) => tx`
      update public.agent_steps set status = ${status}, output = ${output === null ? null : tx.json(output as never)},
        raw_output = ${raw}, provider = ${provider}, model = ${model}, attempts = ${attempts},
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
      });
      provider = res.provider;
      model = res.model;
      inputTokens += res.inputTokens;
      outputTokens += res.outputTokens;
      cost += res.costPence;
      raw = res.text;
      const json = extractJson(res.text);
      const parsed = json === undefined ? null : agent.output.safeParse(json);
      const problems = parsed?.success && agent.check ? agent.check(input, parsed.data) : [];
      if (parsed?.success && problems.length === 0) {
        await finish("succeeded", parsed.data, null);
        return { output: parsed.data, stepId };
      }
      const issues = parsed?.success ? problems.slice(0, 8).join("; ") : describeIssues(parsed ? parsed.error : null);
      if (attempts >= 2) {
        throw new AgentOutputError(
          parsed?.success
            ? `The agent's reply failed its checks: ${issues}`
            : `The agent's reply did not match the expected format: ${issues}`,
        );
      }
      currentPrompt =
        `${prompt}\n\nYour previous reply could not be used (${issues}).\n` +
        `Previous reply:\n${res.text.slice(0, 2000)}\n\nReply again with JSON only, in the required shape.`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish("failed", null, message);
    throw err;
  }
}
