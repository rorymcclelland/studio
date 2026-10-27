-- S4-2 and S4-4: what the Persona agent and the test plan produce, per brief
-- version. Written by their runs, read by the campaign page and the sign-off
-- view. Append-only, like brief versions.

create table public.persona_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  brief_version integer not null check (brief_version >= 1),
  run_id uuid not null,
  review jsonb not null check (jsonb_typeof(review) = 'object' and octet_length(review::text) <= 40000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (run_id),
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete cascade
);

create table public.test_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  brief_version integer not null check (brief_version >= 1),
  run_id uuid not null,
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 40000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (run_id),
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete cascade
);

create index persona_reviews_campaign_idx on public.persona_reviews (campaign_id, workspace_id, brief_version);
create index persona_reviews_run_idx on public.persona_reviews (run_id, workspace_id);
create index persona_reviews_created_by_idx on public.persona_reviews (created_by);
create index test_plans_campaign_idx on public.test_plans (campaign_id, workspace_id, brief_version);
create index test_plans_run_idx on public.test_plans (run_id, workspace_id);
create index test_plans_created_by_idx on public.test_plans (created_by);

alter table public.persona_reviews enable row level security;
alter table public.test_plans enable row level security;

create policy persona_reviews_select on public.persona_reviews for select to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy persona_reviews_insert on public.persona_reviews for insert to authenticated
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid()))
              and created_by = (select auth.uid()));
create policy test_plans_select on public.test_plans for select to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy test_plans_insert on public.test_plans for insert to authenticated
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid()))
              and created_by = (select auth.uid()));

revoke all on public.persona_reviews, public.test_plans from anon;
revoke update, delete, truncate on public.persona_reviews, public.test_plans from authenticated;
