# 0004 Tenancy from day one

**Date:** 24 October 2026. **Status:** accepted.

**Decision.** Every business table carries `workspace_id` and row-level security that limits members to their own workspaces. App code reaches the database only through `asUser()` in `src/lib/db/scoped.ts`, which runs each query as the `authenticated` role with the user's ID set, so the policies apply even though the app connects with one database login. A workspace and an owner membership are created on first sign-in. Sign-in is a Supabase magic link limited to `ALLOWED_EMAILS`.

**Consequences.** Adding teams, invites and client workspaces later needs new screens, not a rebuild. Each new table needs a cross-workspace test.

**Advisor review (25 October 2026, hosted project).** Supabase's security advisor flags `is_member()`, `ensure_workspace()` and `spend_today_pence()` as security-definer functions that signed-in users can call through the Data API. Accepted: the app calls all three as the signed-in user, each acts only on the caller's own membership or returns a single total, and sign-up is closed. The mutable search path on `touch_updated_at()` was fixed in migration `20261025000001`. Performance suggestions (covering indexes on foreign keys; `(select auth.uid())` in policies) are logged for Sprint 2.
