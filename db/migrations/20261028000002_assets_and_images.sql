-- S5-1: pictures. The usage ledger counts images (they are priced per image),
-- and an asset store keeps the pictures the Imagery agent draws (and, with
-- F-10, uploaded logos) in Postgres (Q2), with row-level security like every
-- other table. Assets are append-only: a picture's bytes never change, so it
-- can be cached for good; only the discarded mark may be set or cleared.

alter table public.usage_ledger add column images integer not null default 0 check (images >= 0);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('image', 'logo')),
  brand_id uuid not null,
  campaign_id uuid,
  run_id uuid,
  mime text not null check (mime in ('image/webp', 'image/png')),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  bytes bytea not null check (octet_length(bytes) between 1 and 2097152),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Drawn by the mock image model: shown with a "Simulated image" label (rule 1).
  simulated boolean not null default false,
  -- What made it: for a drawn picture its number in the run, attempt, idea and prompt.
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 8000),
  created_by uuid not null references auth.users (id),
  created_by_kind text not null check (created_by_kind in ('agent', 'person')),
  discarded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade,
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete set null (run_id)
);

create index assets_workspace_created_idx on public.assets (workspace_id, created_at desc);
create index assets_brand_idx on public.assets (brand_id, workspace_id);
create index assets_campaign_idx on public.assets (campaign_id, workspace_id);
create index assets_run_idx on public.assets (run_id, workspace_id);
create index assets_created_by_idx on public.assets (created_by);

-- Append-only except the discarded mark (and the run link a deleted run clears).
create function public.assets_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.workspace_id, new.kind, new.brand_id, new.campaign_id, new.mime, new.width, new.height,
      new.bytes, new.sha256, new.simulated, new.meta, new.created_by, new.created_by_kind, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.kind, old.brand_id, old.campaign_id, old.mime, old.width, old.height,
      old.bytes, old.sha256, old.simulated, old.meta, old.created_by, old.created_by_kind, old.created_at)
     or (new.run_id is distinct from old.run_id and new.run_id is not null) then
    raise exception 'An asset cannot be changed, only marked discarded' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger assets_guard before update on public.assets
for each row execute function public.assets_guard();

alter table public.assets enable row level security;

create policy assets_select on public.assets for select to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy assets_insert on public.assets for insert to authenticated
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid()))
              and created_by = (select auth.uid()));
create policy assets_update on public.assets for update to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));

revoke all on public.assets from anon;
revoke update, delete, truncate on public.assets from authenticated;
grant update (discarded_at) on public.assets to authenticated;
