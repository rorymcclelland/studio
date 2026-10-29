-- S5-2: the Copy agent's words, per brief version, channel and audience.
-- Written by Copy runs (source 'agent') and by people's hand edits (source
-- 'person', based on the set they change). Append-only: a hand edit or new
-- words is a new row; the only change ever made to a row is its discard mark
-- (set, or cleared again to undo). Rule 7: workspace_id with row-level
-- security, and every parent referenced by (id, workspace_id).

create table public.copy_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null,
  brief_version integer not null check (brief_version >= 1),
  -- The Copy run that wrote it; null for a hand edit, or once the run is deleted.
  run_id uuid,
  channel text not null check (channel in ('paid social', 'display', 'search', 'email', 'app push')),
  -- The brief's audience (a segment context item id), kept with its title in
  -- case the item changes later. Null when the brief names no audience.
  segment_ref uuid,
  segment_title text not null check (char_length(segment_title) between 1 and 200),
  set jsonb not null check (jsonb_typeof(set) = 'object' and octet_length(set::text) <= 4000),
  -- The kit's legal lines, attached by code when the set was saved (never written by the model).
  legal_lines text[] not null default '{}' check (cardinality(legal_lines) <= 20),
  source text not null check (source in ('agent', 'person')),
  based_on uuid,
  discarded_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint copy_sets_person_based_on check (source = 'agent' or based_on is not null),
  constraint copy_sets_not_self check (based_on is distinct from id),
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (campaign_id, brief_version) references public.brief_versions (campaign_id, version) on delete cascade,
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete set null (run_id),
  foreign key (based_on, workspace_id) references public.copy_sets (id, workspace_id)
);

create index copy_sets_workspace_idx on public.copy_sets (workspace_id, created_at desc);
create index copy_sets_campaign_idx on public.copy_sets (campaign_id, workspace_id, brief_version);
create index copy_sets_version_idx on public.copy_sets (campaign_id, brief_version);
create index copy_sets_run_idx on public.copy_sets (run_id, workspace_id);
create index copy_sets_based_on_idx on public.copy_sets (based_on, workspace_id);
create index copy_sets_created_by_idx on public.copy_sets (created_by);

-- Only the discard mark changes. A deleted run clears run_id (the foreign key's
-- own action); nothing else about a set is ever rewritten.
create function public.copy_sets_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.workspace_id, new.campaign_id, new.brief_version, new.channel, new.segment_ref, new.segment_title,
      new.set, new.legal_lines, new.source, new.based_on, new.created_by, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.campaign_id, old.brief_version, old.channel, old.segment_ref, old.segment_title,
      old.set, old.legal_lines, old.source, old.based_on, old.created_by, old.created_at)
     or (new.run_id is distinct from old.run_id and new.run_id is not null) then
    raise exception 'Only a copy set''s discard mark can change' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger copy_sets_guard before update on public.copy_sets
for each row execute function public.copy_sets_guard();

alter table public.copy_sets enable row level security;

create policy copy_sets_select on public.copy_sets for select to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy copy_sets_insert on public.copy_sets for insert to authenticated
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid()))
              and created_by = (select auth.uid()));
create policy copy_sets_update on public.copy_sets for update to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));

revoke all on public.copy_sets from anon;
revoke update, delete, truncate on public.copy_sets from authenticated;
grant update (discarded_at) on public.copy_sets to authenticated;
