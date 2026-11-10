import { asUser } from "@/lib/db/scoped";
import { CapExceededError } from "@/lib/models/generate";
import { runModelStep, type StepContext } from "./model-step";
import { APPROVAL_DECIDED } from "./runs";
import { taglineAgent, type taglineInput } from "./tagline";
import type { z } from "zod";

/**
 * The subset of Inngest's step tools the workflows use. Keeping workflows to
 * this interface means they can be tested with a plain fake (tests/agents)
 * as well as run durably on Inngest (src/inngest).
 */
export type StepTools = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: string; if: string },
  ) => Promise<{ data: Record<string, unknown> } | null>;
};

/** How long an approval stays open. APPROVAL_TIMEOUT overrides (tests use "1m"). */
export function approvalTimeout(): string {
  return process.env.APPROVAL_TIMEOUT || "7d";
}

function timeoutToInterval(t: string): string {
  const m = /^(\d+)\s*([smhd])$/.exec(t.trim());
  if (!m) throw new Error(`APPROVAL_TIMEOUT must look like "7d", "12h", "30m" or "45s"`);
  const unit = { s: "seconds", m: "minutes", h: "hours", d: "days" }[m[2] as "s" | "m" | "h" | "d"];
  return `${m[1]} ${unit}`;
}

export async function setRun(ctx: StepContext, status: string, fields: { output?: unknown; error?: string } = {}) {
  const terminal = ["completed", "rejected", "expired", "failed", "stopped_cap"].includes(status);
  await asUser(ctx.userId, (tx) => tx`
    update public.agent_runs set status = ${status}::public.run_status,
      output = coalesce(${fields.output === undefined ? null : tx.json(fields.output as never)}, output),
      error = coalesce(${fields.error ?? null}, error),
      completed_at = ${terminal ? new Date() : null}
    where id = ${ctx.runId}`);
}

type ProposeResult =
  | { ok: true; taglines: string[]; /** D-4: Suggest lines, for this campaign and brief version. */ campaign?: { campaignId: string; version: number } }
  | { ok: false; reason: "cap" | "error"; message: string };

/**
 * Hello-world workflow: propose three taglines, wait for a person to pick
 * one (rule 3), then finish. Every step is recorded (rule 4).
 *
 * D-4 Suggest lines (a campaign in the input): one model step, "Suggest lines",
 * then the run completes with the three lines and no approval step. Nothing is
 * saved to the brief: a person picks a line on the Brief stage, which is a
 * brief edit, a new version signed off with the brief (rule 3).
 */
export async function executeTaglineRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));

  // Errors are caught inside the step and returned, so the durable runtime
  // does not retry a step whose failure is final (cap, bad output).
  const proposed = await step.run("propose-taglines", async (): Promise<ProposeResult> => {
    const input = await asUser(ctx.userId, async (tx) => {
      const [r] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
      return r.input as z.infer<typeof taglineInput>;
    });
    try {
      const campaign = input.campaign ? { campaignId: input.campaign.campaignId, version: input.campaign.version } : undefined;
      const { output } = await runModelStep(ctx, taglineAgent, input, 1, campaign ? "Suggest lines" : "Propose taglines");
      return { ok: true, taglines: output.taglines, ...(campaign ? { campaign } : {}) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: err instanceof CapExceededError ? "cap" : "error", message };
    }
  });

  if (!proposed.ok) {
    await step.run("stop", () =>
      setRun(ctx, proposed.reason === "cap" ? "stopped_cap" : "failed", { error: proposed.message }),
    );
    return proposed.reason === "cap" ? "stopped_cap" : "failed";
  }

  if (proposed.campaign) {
    const { campaignId, version } = proposed.campaign;
    await step.run("finish", () =>
      setRun(ctx, "completed", {
        output: {
          taglines: proposed.taglines,
          campaignId,
          version,
          summary: `Three lines for version ${version}: ${proposed.taglines.join("; ")}. Pick one on the Brief stage.`,
          href: `/campaigns/${campaignId}/brief`,
          hrefLabel: "Pick a line on the brief",
        },
      }),
    );
    return "completed";
  }

  const timeout = approvalTimeout();
  const approvalId = await step.run("request-approval", async () => {
    return asUser(ctx.userId, async (tx) => {
      const [s] = await tx`
        insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input)
        values (${ctx.runId}, ${ctx.workspaceId}, 2, 'Approval', 'approval', 'running',
                ${tx.json({ options: proposed.taglines })})
        on conflict (run_id, seq) do nothing
        returning id`;
      const [existing] = await tx`select id from public.approvals where run_id = ${ctx.runId} limit 1`;
      if (existing) return existing.id as string;
      const [a] = await tx`
        insert into public.approvals (run_id, workspace_id, question, options, expires_at)
        values (${ctx.runId}, ${ctx.workspaceId}, 'Which tagline should we use?',
                ${tx.json(proposed.taglines)}, now() + ${timeoutToInterval(timeout)}::interval)
        returning id`;
      await tx`update public.agent_runs set status = 'awaiting_approval' where id = ${ctx.runId}`;
      void s;
      return a.id as string;
    });
  });

  const decided = await step.waitForEvent("await-approval", {
    event: APPROVAL_DECIDED,
    timeout,
    if: `async.data.approvalId == "${approvalId}"`,
  });

  return step.run("finish", async () => {
    return asUser(ctx.userId, async (tx) => {
      const [a] = await tx`select * from public.approvals where id = ${approvalId} for update`;
      let status: string;
      if (!decided || a.status === "expired" || (a.status === "pending" && new Date(a.expires_at) <= new Date())) {
        await tx`update public.approvals set status = 'expired' where id = ${approvalId} and status = 'pending'`;
        await tx`update public.agent_steps set status = 'failed', error = 'No decision before the approval expired',
                   finished_at = now() where run_id = ${ctx.runId} and seq = 2`;
        status = "expired";
        await tx`update public.agent_runs set status = 'expired', completed_at = now(),
                   error = 'No decision before the approval expired' where id = ${ctx.runId}`;
        return status;
      }
      if (a.status === "pending") {
        // The event arrived before the decision committed; let the runtime retry.
        throw new Error("Approval still pending");
      }
      const options = a.options as string[];
      await tx`update public.agent_steps set status = 'succeeded',
                 output = ${tx.json({ decision: a.status, choice: a.choice, reason: a.reason })},
                 duration_ms = (extract(epoch from (now() - started_at)) * 1000)::int,
                 finished_at = now() where run_id = ${ctx.runId} and seq = 2`;
      if (a.status === "approved") {
        await tx`update public.agent_runs set status = 'completed', completed_at = now(),
                   output = ${tx.json({ tagline: options[a.choice] })} where id = ${ctx.runId}`;
        status = "completed";
      } else {
        await tx`update public.agent_runs set status = 'rejected', completed_at = now(),
                   error = ${a.reason ? `Rejected: ${a.reason}` : "Rejected"} where id = ${ctx.runId}`;
        status = "rejected";
      }
      return status;
    });
  });
}
