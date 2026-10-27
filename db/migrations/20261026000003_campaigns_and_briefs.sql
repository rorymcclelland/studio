-- S3-2 and S3-3: campaigns and their briefs. A campaign belongs to one brand;
-- each brief version is kept (append-only), whether the Brief agent wrote it,
-- a person edited it, a revision was accepted or an old version restored.
-- Rule 7: workspace_id with row-level security; children reference parents
-- by (id, workspace_id), so nothing can attach across workspaces.

-- Runs can be referenced by (id, workspace_id) too, so a campaign or version
-- can only point at a run in its own workspace.
alter table public.agent_runs add constraint agent_runs_id_workspace_key unique (id, workspace_id);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null,
  objective text not null check (char_length(btrim(objective)) between 10 and 300),
  status text not null default 'drafting' check (status in ('drafting', 'draft')),
  current_version integer not null default 0 check (current_version >= 0),
  -- The latest brief-writing run, so the page can show its progress or problem.
  run_id uuid,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade,
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete set null (run_id)
);

create index campaigns_workspace_created_idx on public.campaigns (workspace_id, created_at desc);
create index campaigns_brand_idx on public.campaigns (brand_id, workspace_id);
create index campaigns_created_by_idx on public.campaigns (created_by);
create index campaigns_run_idx on public.campaigns (run_id, workspace_id);

create trigger campaigns_touch before update on public.campaigns
for each row execute function public.touch_updated_at();

create function public.campaigns_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.brand_id is distinct from old.brand_id
     or new.created_by is distinct from old.created_by then
    raise exception 'A campaign''s workspace, brand and creator cannot be changed' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger campaigns_guard before update on public.campaigns
for each row execute function public.campaigns_guard();

create table public.brief_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  version integer not null check (version >= 1),
  brief jsonb not null check (jsonb_typeof(brief) = 'object' and octet_length(brief::text) <= 60000),
  source text not null check (source in ('agent', 'person', 'revision', 'restore')),
  restored_from integer,
  note text check (note is null or char_length(note) <= 500),
  run_id uuid,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (campaign_id, version),
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete set null (run_id)
);

create index brief_versions_campaign_idx on public.brief_versions (campaign_id, workspace_id);
create index brief_versions_created_by_idx on public.brief_versions (created_by);
create index brief_versions_run_idx on public.brief_versions (run_id, workspace_id);

alter table public.campaigns enable row level security;
alter table public.brief_versions enable row level security;

create policy campaigns_select on public.campaigns for select to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid()))
              and created_by = (select auth.uid()));
create policy campaigns_update on public.campaigns for update to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));

-- Versions are append-only: read and add, never change or remove (history is never rewritten).
create policy brief_versions_select on public.brief_versions for select to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy brief_versions_insert on public.brief_versions for insert to authenticated
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid()))
              and created_by = (select auth.uid()));

revoke all on public.campaigns, public.brief_versions from anon;
revoke update, delete, truncate on public.brief_versions from authenticated;
