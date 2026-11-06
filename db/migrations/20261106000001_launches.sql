-- P9-1: launch a simulated campaign. A signed-off campaign's picked, compliant
-- ads (the launch pack's rule, src/lib/performance/launch.ts) launch into a
-- simulation with a daily budget, a length, a start date and one KPI
-- threshold. Nothing real is spent or published, but a person still approves
-- it in the inbox (rule 3, Q1): an approval of the new kind 'launch', about
-- the campaign. The link is approvals.campaign_id plus launches.approval_id.
--
-- Once approved (or refused), a launch's ads, budget, length, start, threshold
-- and seed never change, for any role (the guard trigger, like
-- approvals_guard). Only its status moves on: live to ended.
--
-- Rule 7: workspace_id with row-level security, every parent referenced by
-- (id, workspace_id). Everything here runs as the tables' owner, so it needs
-- no superuser (Neon).

-- The launch's approval is referenced by (id, workspace_id), as the other parents are.
alter table public.approvals add constraint approvals_id_workspace_key unique (id, workspace_id);

-- A third kind: a launch, about a campaign and nothing else.
alter table public.approvals drop constraint approvals_kind_check;
alter table public.approvals add constraint approvals_kind_check check (kind in ('run_choice', 'brief_signoff', 'launch'));
alter table public.approvals drop constraint approvals_subject;
alter table public.approvals add constraint approvals_subject check (
  (kind = 'run_choice' and run_id is not null and campaign_id is null)
  or (kind = 'brief_signoff' and campaign_id is not null and brief_version is not null)
  or (kind = 'launch' and campaign_id is not null and run_id is null and brief_version is null)
);
-- One open launch request per campaign, as one open sign-off.
create unique index approvals_one_open_launch on public.approvals (campaign_id) where kind = 'launch' and status = 'pending';

create table public.launches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null,
  -- The ads that launch, as the pack holds them: [{variantId, sizes[], langs[]}], at least one.
  ads jsonb not null check (jsonb_typeof(ads) = 'array' and jsonb_array_length(ads) > 0 and octet_length(ads::text) <= 16000),
  -- Simulated money: £5 to £500 a day, in whole pence.
  daily_budget_pence integer not null check (daily_budget_pence between 500 and 50000),
  days integer not null check (days between 7 and 60),
  starts_on date not null check (starts_on between date '2026-01-01' and date '2027-12-31'),
  -- One threshold for every ad: rates are percentages (at most 100), cpa simulated pounds, roas a ratio.
  kpi_measure text not null check (kpi_measure in ('ctr', 'conversion_rate', 'cpa', 'roas')),
  kpi_value numeric not null check (kpi_value > 0 and (kpi_measure not in ('ctr', 'conversion_rate') or kpi_value <= 100)),
  -- The simulator's seed (P9-2): the same launch always gives the same month.
  seed bigint not null check (seed > 0),
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval', 'live', 'ended', 'refused')),
  approval_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  -- Who decided and who ended it, by email at the time (auth.users isn't readable by the app's role).
  decided_by_name text check (decided_by_name is null or char_length(decided_by_name) between 1 and 320),
  ended_by uuid references auth.users (id),
  ended_by_name text check (ended_by_name is null or char_length(ended_by_name) between 1 and 320),
  ended_at timestamptz,
  check ((status in ('live', 'ended')) = (approved_at is not null)),
  check ((status = 'ended') = (ended_at is not null)),
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (approval_id, workspace_id) references public.approvals (id, workspace_id) on delete cascade
);

-- One launch per approval (and the approval's foreign key's index).
create unique index launches_approval_idx on public.launches (approval_id, workspace_id);
create index launches_workspace_idx on public.launches (workspace_id, created_at desc);
create index launches_campaign_idx on public.launches (campaign_id, workspace_id, created_at desc);
create index launches_created_by_idx on public.launches (created_by);
create index launches_ended_by_idx on public.launches (ended_by);
-- One open launch request and one live launch per campaign.
create unique index launches_one_open on public.launches (campaign_id) where status = 'awaiting_approval';
create unique index launches_one_live on public.launches (campaign_id) where status = 'live';

-- A launch's approval must be a launch approval about the same campaign. An
-- approval the inserter can't see is left to the foreign key to refuse.
create function public.launches_approval() returns trigger
language plpgsql set search_path = '' as $$
declare a record;
begin
  select kind, campaign_id into a from public.approvals where id = new.approval_id;
  if a is not null and (a.kind <> 'launch' or a.campaign_id <> new.campaign_id) then
    raise exception 'A launch''s approval must be a launch approval about the same campaign' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger launches_approval before insert on public.launches
for each row execute function public.launches_approval();

-- Once decided, a launch's terms are fixed, for every role, the owner too; only
-- its status moves on (waiting to live or refused, live to ended).
create function public.launches_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.campaign_id is distinct from old.campaign_id
     or new.approval_id is distinct from old.approval_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A launch''s campaign and approval cannot be changed' using errcode = '42501';
  end if;
  if old.status <> 'awaiting_approval' and (new.ads, new.daily_budget_pence, new.days, new.starts_on, new.kpi_measure, new.kpi_value, new.seed)
       is distinct from (old.ads, old.daily_budget_pence, old.days, old.starts_on, old.kpi_measure, old.kpi_value, old.seed) then
    raise exception 'A launch''s ads, budget, length, start and threshold can''t change once it is approved' using errcode = '42501';
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
  return new;
end
$$;

create trigger launches_guard before update on public.launches
for each row execute function public.launches_guard();

-- Who decided and who ended a launch come from the session, whatever the
-- statement says, with the person's email for the page. Runs after the guard
-- (triggers fire in name order: guard, then stamp).
create function public.launches_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  email text;
  approval_status text;
begin
  if who is null then
    return new;
  end if;
  select u.email::text into email from auth.users u where u.id = who;
  email := coalesce(nullif(email, ''), 'a member of this workspace');
  if tg_op = 'INSERT' then
    if new.status <> 'awaiting_approval' then new.decided_by_name := email; end if;
    if new.status = 'ended' then new.ended_by := who; new.ended_by_name := email; end if;
    return new;
  end if;
  -- A request that expired was decided by nobody, whoever's page closed it.
  select a.status into approval_status from public.approvals a where a.id = new.approval_id;
  if old.status = 'awaiting_approval' and new.status in ('live', 'refused') and approval_status is distinct from 'expired' then
    new.decided_by_name := email;
  end if;
  if old.status = 'live' and new.status = 'ended' then
    new.ended_by := who;
    new.ended_by_name := email;
  end if;
  return new;
end
$$;

revoke all on function public.launches_stamp() from public;

create trigger launches_stamp before insert or update on public.launches
for each row execute function public.launches_stamp();

alter table public.launches enable row level security;

create policy launches_select on public.launches for select to authenticated using (public.is_member(workspace_id));
create policy launches_insert on public.launches for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));
create policy launches_update on public.launches for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

revoke all on public.launches from anon;
-- Nobody deletes a launch through the app: an ended or refused one stays in the history.
revoke delete, truncate, references, trigger on public.launches from authenticated;
