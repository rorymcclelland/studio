-- Sprint 3 review fixes (findings 5, 6, 7 and 13).

-- 5. A run writes at most one brief version, so a retried save step can't add a second.
create unique index brief_versions_run_once on public.brief_versions (run_id) where run_id is not null;

-- 6. A run's agent, input and workspace never change, and once a run has
--    finished its output is fixed, except for the marks people add to it
--    (a proposal used or discarded, a failed revision dismissed).
create function public.agent_runs_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.agent is distinct from old.agent
     or new.input is distinct from old.input
     or new.created_by is distinct from old.created_by then
    raise exception 'A run''s workspace, agent, input and creator cannot be changed' using errcode = '42501';
  end if;
  if old.status in ('completed', 'rejected', 'expired', 'failed', 'stopped_cap')
     and (coalesce(new.output, '{}'::jsonb) - array['resolution', 'acceptedAs', 'dismissed'])
         is distinct from (coalesce(old.output, '{}'::jsonb) - array['resolution', 'acceptedAs', 'dismissed']) then
    raise exception 'A finished run''s output cannot be changed' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger agent_runs_guard before update on public.agent_runs
for each row execute function public.agent_runs_guard();

-- 7. Sprint 3 replaced the tagline-only workflow function with one for every
--    agent. A tagline run still waiting for approval under the old function
--    can never finish, so it is closed as expired, as an unanswered approval
--    would have been.
update public.approvals set status = 'expired'
where status = 'pending' and run_id in (select id from public.agent_runs where agent = 'tagline' and status = 'awaiting_approval');
update public.agent_runs set status = 'expired', completed_at = now(),
  error = 'Closed when the run framework changed (Sprint 3); no decision had been made'
where agent = 'tagline' and status = 'awaiting_approval';

-- 13. History is append-only: campaigns can't be deleted (which would take
--     their versions with them), and a version can only be the campaign's
--     current one, so none can be forged ahead of or behind it.
drop policy campaigns_delete on public.campaigns;
revoke delete, truncate on public.campaigns from authenticated;

create function public.brief_versions_in_order() returns trigger
language plpgsql set search_path = '' as $$
declare cur integer;
begin
  select current_version into cur from public.campaigns where id = new.campaign_id;
  if cur is distinct from new.version then
    raise exception 'A brief version must be the campaign''s current version' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger brief_versions_in_order before insert on public.brief_versions
for each row execute function public.brief_versions_in_order();
