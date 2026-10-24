import { RUN_REQUESTED } from "@/lib/agents/runs";
import "@/lib/agents/registry";
import { executeTaglineRun, type StepTools } from "@/lib/agents/workflow";
import { inngest } from "./client";

type RunEventData = { runId: string; workspaceId: string; userId: string; agent: string };

export const taglineRun = inngest.createFunction(
  {
    id: "tagline-run",
    name: "Tagline agent run",
    triggers: [{ event: RUN_REQUESTED, if: "event.data.agent == 'tagline'" }],
    retries: 3,
  },
  async ({ event, step }) => {
    const data = event.data as RunEventData;
    const tools: StepTools = {
      run: (id, fn) => step.run(id, fn) as never,
      waitForEvent: (id, opts) => step.waitForEvent(id, opts) as never,
    };
    return executeTaglineRun(
      { runId: data.runId, workspaceId: data.workspaceId, userId: data.userId },
      tools,
    );
  },
);

export const functions = [taglineRun];
