import { mockBehaviour } from "@/lib/models/mock";
import type { AgentDefinition } from "./contract";
import { audienceAgent } from "./audience";
import { briefAgent } from "./brief";
import { copyAgent } from "./copy";
import { imageCheckAgent, imageryAgent } from "./imagery";
import { localiseAgent } from "./localise";
import { marketAgent } from "./market";
import { monitorAnswerAgent, monitorPlanAgent } from "./monitor";
import { personaAgent } from "./persona";
import { pretestAgent } from "./pretest";
import { readAdAgent } from "./read-ad";
import { testPlanAgent } from "./testplan";
import { taglineAgent } from "./tagline";

// Every product agent, by key. The add-an-agent skill appends here.
export const AGENTS = {
  tagline: taglineAgent,
  audience: audienceAgent,
  brief: briefAgent,
  persona: personaAgent,
  testPlan: testPlanAgent,
  market: marketAgent,
  copy: copyAgent,
  imagery: imageryAgent,
  localise: localiseAgent,
  pretest: pretestAgent,
  readAd: readAdAgent,
  // P9-4: Ask about this campaign (the Monitor's plan step starts the run; its answer step runs inside it).
  monitorPlan: monitorPlanAgent,
} as const;

// Definitions that run inside another agent's workflow, never as runs of their own (S5-1: the picture check; P9-4: the Monitor's answer).
const INNER_AGENTS = [imageCheckAgent, monitorAnswerAgent] as unknown as AgentDefinition<unknown, unknown>[];

export type RegisteredAgent = keyof typeof AGENTS;

export function getAgent(key: string): AgentDefinition<unknown, unknown> | null {
  return (AGENTS as Record<string, AgentDefinition<unknown, unknown>>)[key] ?? null;
}

// Offline answers for the mock model.
declare global {
  var __csMockRegistered: boolean | undefined;
}
if (!globalThis.__csMockRegistered) {
  globalThis.__csMockRegistered = true;
  for (const agent of [...Object.values(AGENTS), ...INNER_AGENTS]) {
    const answer = (agent as AgentDefinition<unknown, unknown>).mockAnswer;
    if (answer) mockBehaviour.respondWith((p) => answer(p) ?? "");
  }
}
