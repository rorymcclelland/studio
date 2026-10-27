-- S2-6 (F-2): Supabase performance advisor findings on the Sprint 1 schema.
-- 1. Covering indexes for every foreign key, so joins and cascading deletes
--    do not scan whole tables.
-- 2. Policies call auth.uid() once per statement via (select auth.uid()),
--    instead of once per row.

create index agent_runs_created_by_idx on public.agent_runs (created_by);
create index agent_steps_workspace_idx on public.agent_steps (workspace_id);
create index approvals_workspace_idx on public.approvals (workspace_id);
create index approvals_decided_by_idx on public.approvals (decided_by);
create index usage_ledger_workspace_idx on public.usage_ledger (workspace_id);
create index usage_ledger_run_idx on public.usage_ledger (run_id);
create index usage_ledger_step_idx on public.usage_ledger (step_id);
create index workspaces_created_by_idx on public.workspaces (created_by);

alter policy members_select on public.workspace_members
  using (user_id = (select auth.uid()) or public.is_member(workspace_id));

alter policy profiles_select on public.profiles
  using (user_id = (select auth.uid()));
alter policy profiles_update on public.profiles
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter policy runs_insert on public.agent_runs
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));
