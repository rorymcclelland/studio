# 0002 Inngest for agent workflows

**Date:** 24 October 2026. **Status:** accepted (Rory, Q8).

**Context.** Agent runs take seconds to minutes and must pause for human approval for up to days (rule 3). Vercel functions are short-lived.

**Decision.** Inngest on its free tier (50,000 runs a month). Each run is an Inngest function, each agent call a step, each approval a `waitForEvent` step with a timeout. Workflow logic lives in `src/lib/agents/workflow.ts` against a small `StepTools` interface, so it is tested with a fake runner and not tied to Inngest.

**Fallback.** If the free tier proves unworkable, implement `StepTools` over a Postgres-backed step table and a scheduled worker (about two days).
