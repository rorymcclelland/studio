# 0004 Tenancy from day one

**Date:** 24 October 2026. **Status:** accepted.

**Decision.** Every business table carries `workspace_id` and row-level security that limits members to their own workspaces. App code reaches the database only through `asUser()` in `src/lib/db/scoped.ts`, which runs each query as the `authenticated` role with the user's ID set, so the policies apply even though the app connects with one database login. A workspace and an owner membership are created on first sign-in. Sign-in is a Supabase magic link limited to `ALLOWED_EMAILS`.

**Consequences.** Adding teams, invites and client workspaces later needs new screens, not a rebuild. Each new table needs a cross-workspace test.
