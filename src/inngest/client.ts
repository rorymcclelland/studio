import { Inngest } from "inngest";

// Durable workflows (decision 0002). Locally, INNGEST_DEV=1 points this at the
// dev server (npm run inngest); on Vercel, INNGEST_EVENT_KEY and
// INNGEST_SIGNING_KEY come from the Inngest integration.
export const inngest = new Inngest({ id: "campaign-studio" });

export async function sendEvent(event: { name: string; data: Record<string, unknown> }) {
  await inngest.send(event);
}
