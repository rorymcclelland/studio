-- Sprint 5 fresh-eyes review fixes. Adds only: no drops, no data changes.

-- Finding 4 (rule 1): today's simulated spend (usage_ledger rows from the mock
-- models), across the whole app, so the owner's spend meter can say how much
-- of it was simulated. Like spend_today_pence it returns a single number and
-- no row data. A workspace's own figure is read through row-level security.
create function public.simulated_spend_today_pence(tz text default 'Europe/London')
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.cost_pence), 0)
  from public.usage_ledger l
  where l.provider = 'mock'
    and l.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz)
$$;

revoke all on function public.simulated_spend_today_pence(text) from public, anon;
grant execute on function public.simulated_spend_today_pence(text) to authenticated;

-- Finding 5: one active creative run per campaign (Make creative) and per ad
-- (New picture), held by the database. The app checks first and says why;
-- these indexes make two starts at once (two tabs) record one run, not two
-- that both draw and pay. Active means queued, running or awaiting approval,
-- as everywhere else (src/components/status-badge.tsx).
create unique index agent_runs_one_active_make
  on public.agent_runs (workspace_id, (input ->> 'campaignId'))
  where agent = 'creative' and input ->> 'mode' = 'make' and status in ('queued', 'running', 'awaiting_approval');

create unique index agent_runs_one_active_picture
  on public.agent_runs (workspace_id, (input ->> 'variantId'))
  where agent = 'creative' and input ->> 'mode' = 'picture' and status in ('queued', 'running', 'awaiting_approval');
