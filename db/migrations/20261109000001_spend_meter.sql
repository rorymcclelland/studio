-- U10-1 (F-36, rule 1): the header's spend meter shows what has been charged
-- today, without the reservations of calls in flight, and says how many calls
-- are running. A reservation is an estimate, so it is never shown as spend; it
-- still counts against the cap (spend_today_pence and the rest are unchanged).
--
-- The owner's meter covers the whole app, so this returns app-wide figures:
-- charged today, the mock models' part of it, and the number of live
-- reservations (under 10 minutes old, as the cap counts them). Like
-- spend_today_pence it returns totals only, never row data. A workspace's own
-- figures are read through row-level security. Adds only.

create function public.spend_meter_today(tz text default 'Europe/London')
returns table (charged_pence numeric, simulated_pence numeric, calls_running integer)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select sum(l.cost_pence) from public.usage_ledger l
              where l.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz)), 0),
    coalesce((select sum(l.cost_pence) from public.usage_ledger l
              where l.provider = 'mock'
                and l.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz)), 0),
    (select count(*)::integer from public.spend_reservations r
     where r.created_at > now() - interval '10 minutes')
$$;

revoke all on function public.spend_meter_today(text) from public, anon;
grant execute on function public.spend_meter_today(text) to authenticated;
