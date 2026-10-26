import { mockBehaviour } from "@/lib/models/mock";
import type { AgentDefinition } from "./contract";
import { audienceAgent } from "./audience";
import { briefAgent } from "./brief";
import { marketAgent } from "./market";
import { personaAgent } from "./persona";
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
} as const;

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
  for (const agent of Object.values(AGENTS)) {
    const answer = (agent as AgentDefinition<unknown, unknown>).mockAnswer;
    if (answer) mockBehaviour.respondWith((p) => answer(p) ?? "");
  }
}
