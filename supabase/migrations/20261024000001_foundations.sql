-- Sprint 1 foundations: workspaces, agent runs, approvals and the usage ledger.
-- Rule 7: every business table carries workspace_id and is protected by
-- row-level security, even while there is a single user.

-- Workspaces and membership ------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

-- True when the signed-in user belongs to the workspace. Security definer so
-- that policies can call it without recursing through workspace_members' own
-- policy.
create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  )
$$;

-- Returns the signed-in user's workspace, creating it (with membership and
-- profile) on first sign-in. Serialised per user so two concurrent first
-- requests cannot create two workspaces.
create function public.ensure_workspace() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ws uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select m.workspace_id into ws
  from public.workspace_members m
  where m.user_id = uid
  order by m.created_at
  limit 1;

  if ws is not null then
    return ws;
  end if;

  insert into public.workspaces (name, created_by)
  values ('My workspace', uid)
  returning id into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, uid, 'owner');

  insert into public.profiles (user_id) values (uid)
  on conflict (user_id) do nothing;

  return ws;
end
$$;

-- Agent runs ----------------------------------------------------------------

create type public.run_status as enum (
  'queued', 'running', 'awaiting_approval', 'completed',
  'rejected', 'expired', 'failed', 'stopped_cap'
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent text not null,
  agent_version integer not null,
  status public.run_status not null default 'queued',
  input jsonb not null,
  output jsonb,
  error text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index agent_runs_workspace_created_idx on public.agent_runs (workspace_id, created_at desc);

create table public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  seq integer not null,
  name text not null,
  kind text not null check (kind in ('model', 'approval', 'system')),
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  input jsonb,
  output jsonb,
  raw_output text,
  provider text,
  model text,
  attempts integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_pence numeric(12, 4) not null default 0,
  duration_ms integer,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_id, seq)
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  question text not null,
  options jsonb not null,
  choice integer,
  reason text check (reason is null or char_length(reason) <= 500),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index approvals_run_idx on public.approvals (run_id);

-- Usage ledger: one row per model call that returned tokens (rule 4 and 5).
create table public.usage_ledger (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id uuid references public.agent_runs (id) on delete set null,
  step_id uuid references public.agent_steps (id) on delete set null,
  agent text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_pence numeric(12, 4) not null,
  created_at timestamptz not null default now()
);

create index usage_ledger_created_idx on public.usage_ledger (created_at);

-- Spend since midnight in the given time zone, across the whole app, in pence.
-- The cap protects the budget, which is shared by every workspace, so this
-- deliberately sums all rows; it returns a single number and no row data.
create function public.spend_today_pence(tz text default 'Europe/London')
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.cost_pence), 0)
  from public.usage_ledger l
  where l.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz)
$$;

-- Keep updated_at honest.
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger agent_runs_touch before update on public.agent_runs
for each row execute function public.touch_updated_at();

-- Row-level security ----------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.profiles enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.approvals enable row level security;
alter table public.usage_ledger enable row level security;

-- Workspaces are created only through ensure_workspace().
create policy workspaces_select on public.workspaces
  for select to authenticated using (public.is_member(id));

create policy members_select on public.workspace_members
  for select to authenticated using (user_id = auth.uid() or public.is_member(workspace_id));

create policy profiles_select on public.profiles
  for select to authenticated using (user_id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy runs_select on public.agent_runs
  for select to authenticated using (public.is_member(workspace_id));
create policy runs_insert on public.agent_runs
  for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = auth.uid());
create policy runs_update on public.agent_runs
  for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

create policy steps_select on public.agent_steps
  for select to authenticated using (public.is_member(workspace_id));
create policy steps_insert on public.agent_steps
  for insert to authenticated with check (public.is_member(workspace_id));
create policy steps_update on public.agent_steps
  for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

create policy approvals_select on public.approvals
  for select to authenticated using (public.is_member(workspace_id));
create policy approvals_insert on public.approvals
  for insert to authenticated with check (public.is_member(workspace_id));
create policy approvals_update on public.approvals
  for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

create policy ledger_select on public.usage_ledger
  for select to authenticated using (public.is_member(workspace_id));
create policy ledger_insert on public.usage_ledger
  for insert to authenticated with check (public.is_member(workspace_id));

-- Privileges: nothing for anon; functions only for signed-in users.
revoke all on all tables in schema public from anon;
revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.ensure_workspace() from public, anon;
revoke all on function public.spend_today_pence(text) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.ensure_workspace() to authenticated;
grant execute on function public.spend_today_pence(text) to authenticated;
