import { asUser } from "@/lib/db/scoped";
import type { StepContext } from "./model-step";
import { executeAudienceRun } from "./audience-workflow";
import { executeBriefRun } from "./brief-workflow";
import { executeCopyRun } from "./copy-workflow";
import { executeCreativeRun } from "./creative-workflow";
import { executeImageryRun } from "./imagery-workflow";
import { executeLocaliseRun } from "./localise-workflow";
import { executeMarketRun } from "./market-workflow";
import { executePersonaRun, executeTestPlanRun } from "./review-workflows";
import { executeTaglineRun, type StepTools } from "./workflow";

/**
 * Every agent's workflow, by agent key (F-4). One Inngest function looks the
 * workflow up here, so adding an agent never touches the run plumbing.
 */
export type Workflow = (ctx: StepContext, step: StepTools) => Promise<string>;

export const WORKFLOWS: Record<string, Workflow> = {
  tagline: executeTaglineRun,
  audience: executeAudienceRun,
  brief: executeBriefRun,
  persona: executePersonaRun,
  testPlan: executeTestPlanRun,
  market: executeMarketRun,
  copy: executeCopyRun,
  imagery: executeImageryRun,
  // C7-2: Translate (the Localise agent, with the fit check in every size).
  localise: executeLocaliseRun,
  // S5-4: not a model agent of its own; runs the Imagery and Copy workflows, then composes ads in code.
  creative: executeCreativeRun,
};

/** Names for workflows that aren't model agents (run lists fall back to these). */
export const WORKFLOW_NAMES: Record<string, string> = { creative: "Make creative" };

/** Runs the workflow for an agent; an agent without one fails its run instead of leaving it queued. */
export async function executeRun(agent: string, ctx: StepContext, step: StepTools): Promise<string> {
  const workflow = Object.hasOwn(WORKFLOWS, agent) ? WORKFLOWS[agent] : undefined;
  if (!workflow) {
    await step.run("no-workflow", () =>
      asUser(ctx.userId, (tx) => tx`
        update public.agent_runs set status = 'failed', completed_at = now(),
          error = ${`No workflow for agent "${agent}".`}
        where id = ${ctx.runId}`),
    );
    return "failed";
  }
  return workflow(ctx, step);
}
