-- Sprint 3 review fixes (findings 5, 6 and 13; the rest of 7 and 13 is in 20261026000005).

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

-- 13. A version can only be the campaign's current one, so none can be
--     forged ahead of or behind it.
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
