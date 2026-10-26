import { AGENTS } from "./registry";
import { WORKFLOW_NAMES } from "./workflows";

/** The name people see for a run's agent: the model agent's name, a workflow's name ("Make creative"), or the key. */
export function agentDisplayName(agent: string): string {
  return (AGENTS as Record<string, { name: string }>)[agent]?.name ?? WORKFLOW_NAMES[agent] ?? agent;
}

/** The agent's name, or undefined when it has none (so run titles can fall back to their input). */
export function knownAgentName(agent: string): string | undefined {
  const name = agentDisplayName(agent);
  return name === agent ? undefined : name;
}
