-- P9-4: the Monitor. Two tables.
--
-- performance_alerts: what the monitor raised after a simulated day, in code
-- (src/lib/performance/alerts.ts, inside the clock's transaction): an ad below
-- its threshold two days in a row, an ad tiring, or an ad that has stopped
-- passing compliance, with the facts behind it. One alert per ad and kind in a
-- launch, never raised again, even after its condition clears and returns. A
-- person may mark it as seen, once; nothing else about it ever changes. Alerts
-- never act (rule 3): nothing here approves, swaps or moves money.
--
-- performance_questions: Ask about this campaign. The question as typed (plain
-- text), the plan the Monitor's plan step made, the result code worked out from
-- the campaign's own rows, and the answer, or why it was refused. Filled in
-- once as the run goes; an answered or refused question is final.
--
-- Rule 7: workspace_id with row-level security, every parent referenced by
-- (id, workspace_id). Everything here runs as the tables' owner, so it needs
-- no superuser (Neon).

create table public.performance_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  launch_id uuid not null,
  variant_id uuid not null,
  day integer not null check (day between 1 and 60),
  kind text not null check (kind in ('below_threshold', 'tiring', 'not_compliant')),
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  seen_by uuid references auth.users (id),
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  check ((seen_by is null) = (seen_at is null)),
  -- Once per ad per kind per launch.
  unique (launch_id, variant_id, kind),
  foreign key (launch_id, workspace_id) references public.launches (id, workspace_id) on delete cascade,
  foreign key (variant_id, workspace_id) references public.ad_variants (id, workspace_id) on delete cascade
);

create index performance_alerts_workspace_idx on public.performance_alerts (workspace_id);
create index performance_alerts_launch_idx on public.performance_alerts (launch_id, workspace_id, day);
create index performance_alerts_variant_idx on public.performance_alerts (variant_id, workspace_id);
create index performance_alerts_unseen_idx on public.performance_alerts (workspace_id) where seen_at is null;
create index performance_alerts_seen_by_idx on public.performance_alerts (seen_by);

-- An alert is about one of the launch's own ads. Security definer, so the
-- launch is read whoever inserts; row-level security still decides whether
-- the inserter may write into that workspace, and the foreign keys whether the
-- launch and the ad are that workspace's.
create function public.performance_alerts_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  select ads, workspace_id into l from public.launches where id = new.launch_id;
  if l is null then
    -- Left to the foreign key to refuse.
    return new;
  end if;
  -- Another workspace's launch is refused as the foreign key would refuse it, before the unique key is reached.
  if l.workspace_id <> new.workspace_id then
    raise exception 'The alert''s launch isn''t in its workspace' using errcode = '23503';
  end if;
  if not l.ads @> jsonb_build_array(jsonb_build_object('variantId', new.variant_id::text)) then
    raise exception 'An alert is raised only for one of the launch''s own ads' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function public.performance_alerts_check() from public;

create trigger performance_alerts_check before insert on public.performance_alerts
for each row execute function public.performance_alerts_check();

-- For every role, the owner too: only seen_by and seen_at change, together,
-- from not seen to seen, once.
create function public.performance_alerts_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.workspace_id, new.launch_id, new.variant_id, new.day, new.kind, new.facts, new.created_at)
       is distinct from (old.id, old.workspace_id, old.launch_id, old.variant_id, old.day, old.kind, old.facts, old.created_at)
     or old.seen_at is not null or old.seen_by is not null
     or new.seen_at is null or new.seen_by is null then
    raise exception 'An alert can only be marked as seen, once' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger performance_alerts_guard before update on public.performance_alerts
for each row execute function public.performance_alerts_guard();

alter table public.performance_alerts enable row level security;

create policy performance_alerts_select on public.performance_alerts for select to authenticated using (public.is_member(workspace_id));
create policy performance_alerts_insert on public.performance_alerts for insert to authenticated with check (public.is_member(workspace_id));
-- A member marks an alert as seen as themselves.
create policy performance_alerts_update on public.performance_alerts for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id) and seen_by = (select auth.uid()));

revoke all on public.performance_alerts from anon;
revoke delete, truncate, references, trigger on public.performance_alerts from authenticated;

create table public.performance_questions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  launch_id uuid not null,
  question text not null check (char_length(question) between 1 and 300),
  plan jsonb,
  answer text check (char_length(answer) between 1 and 600),
  result jsonb,
  refused text check (char_length(refused) between 1 and 500),
  run_id uuid references public.agent_runs (id) on delete set null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (launch_id, workspace_id) references public.launches (id, workspace_id) on delete cascade
);

create index performance_questions_workspace_idx on public.performance_questions (workspace_id);
create index performance_questions_launch_idx on public.performance_questions (launch_id, workspace_id, created_at);
create index performance_questions_run_idx on public.performance_questions (run_id);
create index performance_questions_created_by_idx on public.performance_questions (created_by);

-- For every role, the owner too: who asked what, about which launch and when,
-- never changes; once it is answered or refused, nothing does.
create function public.performance_questions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.workspace_id, new.launch_id, new.question, new.created_by, new.created_at)
       is distinct from (old.id, old.workspace_id, old.launch_id, old.question, old.created_by, old.created_at) then
    raise exception 'A question''s words, campaign and asker cannot be changed' using errcode = '42501';
  end if;
  if old.answer is not null or old.refused is not null then
    raise exception 'An answered or refused question is final' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger performance_questions_guard before update on public.performance_questions
for each row execute function public.performance_questions_guard();

alter table public.performance_questions enable row level security;

create policy performance_questions_select on public.performance_questions for select to authenticated using (public.is_member(workspace_id));
create policy performance_questions_insert on public.performance_questions for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));
create policy performance_questions_update on public.performance_questions for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

revoke all on public.performance_questions from anon;
revoke delete, truncate, references, trigger on public.performance_questions from authenticated;

-- Who marked an alert as seen, or asked a question, as the page shows them: a
-- fellow member's email, and nobody else's (null for anyone the caller doesn't
-- share a workspace with). auth.users isn't readable by members.
create function public.member_email(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select u.email::text from auth.users u
  where u.id = p_user
    and exists (
      select 1 from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = auth.uid() and theirs.user_id = p_user
    )
$$;

revoke all on function public.member_email(uuid) from public, anon;
grant execute on function public.member_email(uuid) to authenticated;
