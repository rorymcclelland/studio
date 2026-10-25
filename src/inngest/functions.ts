import { RUN_REQUESTED } from "@/lib/agents/runs";
import "@/lib/agents/registry";
import type { StepTools } from "@/lib/agents/workflow";
import { executeRun } from "@/lib/agents/workflows";
import { inngest } from "./client";

type RunEventData = { runId: string; workspaceId: string; userId: string; agent: string };

/** One durable function for every agent (F-4); the workflow is picked by the event's agent key. */
export const agentRun = inngest.createFunction(
  {
    id: "agent-run",
    name: "Agent run",
    triggers: [{ event: RUN_REQUESTED }],
    retries: 3,
  },
  async ({ event, step }) => {
    const data = event.data as RunEventData;
    const tools: StepTools = {
      run: (id, fn) => step.run(id, fn) as never,
      waitForEvent: (id, opts) => step.waitForEvent(id, opts) as never,
    };
    return executeRun(data.agent, { runId: data.runId, workspaceId: data.workspaceId, userId: data.userId }, tools);
  },
);

export const functions = [agentRun];
