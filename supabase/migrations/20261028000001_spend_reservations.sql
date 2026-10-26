-- F-21: reserve spend before a call. A paid call first reserves its estimate,
-- in the same transaction as the cap check and under an advisory lock, so two
-- calls started together can't both pass a cap that only one fits. After the
-- call the real cost goes in usage_ledger and the reservation is deleted. A
-- reservation left by a crashed call stops counting after 10 minutes.

-- Steps can be referenced by (id, workspace_id), so a reservation (and, later,
-- anything else) can only point at a step in its own workspace.
alter table public.agent_steps add constraint agent_steps_id_workspace_key unique (id, workspace_id);

create table public.spend_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id uuid,
  step_id uuid,
  pence numeric(12, 4) not null check (pence >= 0),
  created_at timestamptz not null default now(),
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete cascade,
  foreign key (step_id, workspace_id) references public.agent_steps (id, workspace_id) on delete cascade
);

create index spend_reservations_workspace_created_idx on public.spend_reservations (workspace_id, created_at);
create index spend_reservations_created_idx on public.spend_reservations (created_at);
create index spend_reservations_run_idx on public.spend_reservations (run_id, workspace_id);
create index spend_reservations_step_idx on public.spend_reservations (step_id, workspace_id);

alter table public.spend_reservations enable row level security;

-- Members read, add and remove their own workspace's reservations; nobody changes one.
create policy spend_reservations_select on public.spend_reservations for select to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy spend_reservations_insert on public.spend_reservations for insert to authenticated
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy spend_reservations_delete on public.spend_reservations for delete to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));

revoke all on public.spend_reservations from anon;
revoke update, truncate on public.spend_reservations from authenticated;

-- Spent today now means charged today plus live reservations (under 10
-- minutes old). A live reservation counts whatever day it was made on: it is
-- money about to be charged.

create or replace function public.spend_today_pence(tz text default 'Europe/London')
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(l.cost_pence) from public.usage_ledger l
                   where l.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz)), 0)
       + coalesce((select sum(r.pence) from public.spend_reservations r
                   where r.created_at > now() - interval '10 minutes'), 0)
$$;

create or replace function public.workspace_spend_today_pence(p_workspace uuid, tz text default 'Europe/London') returns numeric
language sql stable set search_path = '' as $$
  select coalesce((select sum(l.cost_pence) from public.usage_ledger l
                   where l.workspace_id = p_workspace
                     and l.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz)), 0)
       + coalesce((select sum(r.pence) from public.spend_reservations r
                   where r.workspace_id = p_workspace and r.created_at > now() - interval '10 minutes'), 0)
$$;

create or replace function public.spend_split_today(p_owner_email text, tz text default 'Europe/London')
returns table (owner_pence numeric, total_pence numeric)
language sql stable security definer set search_path = '' as $$
  with today as (
    select l.workspace_id, l.cost_pence as pence from public.usage_ledger l
    where l.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz)
    union all
    select r.workspace_id, r.pence from public.spend_reservations r
    where r.created_at > now() - interval '10 minutes'
  ), owner_ws as (
    select w.id from public.workspaces w join auth.users u on u.id = w.created_by
    where lower(u.email::text) = lower(btrim(coalesce(p_owner_email, '')))
  )
  select coalesce(sum(t.pence) filter (where t.workspace_id in (select id from owner_ws)), 0),
         coalesce(sum(t.pence), 0)
  from today t
$$;
