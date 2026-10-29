-- Cutover day (29 Oct): production pages hung behind ensure_workspace's
-- per-user advisory lock when a transaction was abandoned while holding it
-- (a serverless function frozen mid-transaction). Every signed-in page calls
-- ensure_workspace, so every page queued behind one lost transaction.
--
-- The lock only matters the first time, when a workspace is created (two
-- first requests must not both create one). Existing members now return their
-- workspace without taking it; only someone with no workspace yet takes the
-- lock, then checks again before creating. Behaviour is otherwise unchanged.

create or replace function public.ensure_workspace() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ws uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Fast path: an existing member takes no lock.
  select m.workspace_id into ws
  from public.workspace_members m
  where m.user_id = uid
  order by m.created_at
  limit 1;
  if ws is not null then
    return ws;
  end if;

  -- First request for this user: serialise creation, then check again.
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
