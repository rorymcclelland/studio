-- P9-2: the simulator's daily results. A live launch has a simulated clock
-- (launches.sim_day, the last simulated day written; 0 before the first), and
-- each step writes that day's results for every launched ad into sim_daily:
-- impressions, clicks, conversions, spend and revenue, all simulated, with the
-- day's events. The numbers come from pure code (src/lib/performance/simulate.ts);
-- nothing here calls a model.
--
-- A day is written once and never rewritten: unique per launch, ad and day,
-- and append-only for every role. The clock only moves forward, only while the
-- launch is live, and never past its days.
--
-- Rule 7: workspace_id with row-level security, every parent referenced by
-- (id, workspace_id). Everything here runs as the tables' owner, so it needs
-- no superuser (Neon).

alter table public.launches add column sim_day integer not null default 0;
alter table public.launches add constraint launches_sim_day_check check (sim_day between 0 and days);
-- Only a launch that has gone live has simulated days.
alter table public.launches add constraint launches_sim_day_live check (sim_day = 0 or status in ('live', 'ended'));
-- sim_daily's foreign key references a launch by (id, workspace_id), as the other parents are.
alter table public.launches add constraint launches_id_workspace_key unique (id, workspace_id);

-- A launch starts before its first simulated day.
create function public.launches_sim_start() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.sim_day <> 0 then
    raise exception 'A launch starts before its first simulated day' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger launches_sim_start before insert on public.launches
for each row execute function public.launches_sim_start();

-- P9-1's guard, with the clock: sim_day moves only forward, and only while the
-- launch is live, for every role, the owner too. The rest is as P9-1 wrote it
-- (the terms are launches_terms, the approval launches_live_check).
create or replace function public.launches_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.campaign_id is distinct from old.campaign_id
     or new.approval_id is distinct from old.approval_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A launch''s campaign and approval cannot be changed' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'awaiting_approval' and new.status in ('live', 'refused')) or (old.status = 'live' and new.status = 'ended')) then
    raise exception 'A launch can only go from waiting to live or refused, and from live to ended' using errcode = '42501';
  end if;
  if old.status in ('ended', 'refused')
     and (new.approved_at, new.decided_by_name, new.ended_by, new.ended_by_name, new.ended_at)
       is distinct from (old.approved_at, old.decided_by_name, old.ended_by, old.ended_by_name, old.ended_at) then
    raise exception 'An ended or refused launch cannot be changed' using errcode = '42501';
  end if;
  if new.sim_day is distinct from old.sim_day
     and not (old.status = 'live' and new.status = 'live' and new.sim_day > old.sim_day) then
    raise exception 'A launch''s simulated clock only moves forward, while it is live' using errcode = '42501';
  end if;
  return new;
end
$$;

create table public.sim_daily (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  launch_id uuid not null,
  variant_id uuid not null,
  day integer not null check (day between 1 and 60),
  date date not null,
  impressions integer not null check (impressions >= 0),
  clicks integer not null check (clicks >= 0),
  conversions integer not null check (conversions >= 0),
  spend_pence integer not null check (spend_pence >= 0),
  revenue_pence integer not null check (revenue_pence >= 0),
  -- "Weekend", a bank holiday's name, "Black Friday", "Cyber Monday".
  events text[] not null default '{}' check (cardinality(events) <= 8),
  created_at timestamptz not null default now(),
  check (conversions <= clicks and clicks <= impressions),
  unique (launch_id, variant_id, day),
  foreign key (launch_id, workspace_id) references public.launches (id, workspace_id) on delete cascade,
  foreign key (variant_id, workspace_id) references public.ad_variants (id, workspace_id) on delete cascade
);

create index sim_daily_workspace_idx on public.sim_daily (workspace_id);
create index sim_daily_launch_idx on public.sim_daily (launch_id, workspace_id, day);
create index sim_daily_variant_idx on public.sim_daily (variant_id, workspace_id);

-- A row must be one of a live launch's days and ads: its day within the
-- launch's length, its date the day's, its ad one the launch holds. Security
-- definer, so the launch is read whoever inserts; row-level security still
-- decides whether the inserter may write into that workspace.
create function public.sim_daily_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  select status, days, starts_on, ads, workspace_id into l from public.launches where id = new.launch_id;
  -- Another workspace's launch is refused as the foreign key would refuse it, before anything about it is told.
  if l is not null and l.workspace_id <> new.workspace_id then
    raise exception 'The simulated results'' launch isn''t in their workspace' using errcode = '23503';
  end if;
  if l is null or l.status <> 'live' then
    raise exception 'Simulated results are written only for a live launch' using errcode = '23514';
  end if;
  if new.day > l.days or new.date <> l.starts_on + (new.day - 1) then
    raise exception 'A simulated day must be within the launch, on its own date' using errcode = '23514';
  end if;
  if not l.ads @> jsonb_build_array(jsonb_build_object('variantId', new.variant_id::text)) then
    raise exception 'Simulated results are written only for the launch''s own ads' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function public.sim_daily_check() from public;

create trigger sim_daily_check before insert on public.sim_daily
for each row execute function public.sim_daily_check();

-- Append-only, for every role, the owner too: a day is never rewritten. A
-- delete is allowed only as a cascade (from deleting the launch's campaign,
-- brand, ad or workspace), which runs inside the foreign key's own trigger.
create function public.sim_daily_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Simulated results are never changed or removed' using errcode = '42501';
end
$$;

create trigger sim_daily_append_only before update or delete on public.sim_daily
for each row execute function public.sim_daily_append_only();

alter table public.sim_daily enable row level security;

create policy sim_daily_select on public.sim_daily for select to authenticated using (public.is_member(workspace_id));
create policy sim_daily_insert on public.sim_daily for insert to authenticated with check (public.is_member(workspace_id));

revoke all on public.sim_daily from anon;
revoke update, delete, truncate, references, trigger on public.sim_daily from authenticated;
