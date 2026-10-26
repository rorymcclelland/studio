-- Sprint 4 review fixes (finding 6): today's spend split into the owner's
-- workspaces and everything, so guests can't use up the part of the daily cap
-- the owner keeps for himself. Security definer: a guest's cap check needs the
-- app-wide figures but may not read other workspaces' ledger rows.
create function public.spend_split_today(p_owner_email text, tz text default 'Europe/London')
returns table (owner_pence numeric, total_pence numeric)
language sql stable security definer set search_path = '' as $$
  with today as (
    select l.workspace_id, l.cost_pence from public.usage_ledger l
    where l.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz)
  ), owner_ws as (
    select w.id from public.workspaces w join auth.users u on u.id = w.created_by
    where lower(u.email::text) = lower(btrim(coalesce(p_owner_email, '')))
  )
  select coalesce(sum(t.cost_pence) filter (where t.workspace_id in (select id from owner_ws)), 0),
         coalesce(sum(t.cost_pence), 0)
  from today t
$$;
revoke all on function public.spend_split_today(text, text) from public, anon;
grant execute on function public.spend_split_today(text, text) to authenticated;
