-- C8-3: check an uploaded ad. A person uploads an ad made outside Studio (a
-- PNG or JPEG up to 5 MB and 4096 px on each side) for a brand; it is checked
-- in code, re-encoded by sharp (which drops its metadata) and kept as an asset
-- of the new kind 'upload': made by a person, never simulated, never part of
-- a campaign or a run. Make creative and the launch pack never use one: an
-- ad's picture must be an 'image' (ad_variants_parts) and a logo a 'logo'
-- (brands_logo_asset), and the pack draws only ad variants.
--
-- The Read ad agent (Haiku vision) reads the words in the upload and
-- estimates where they and the logo sit; code then checks the words and the
-- pixels. Each check is kept in uploaded_ad_checks, append-only: a check again
-- adds a row. Rule 7: workspace_id with row-level security, every parent
-- referenced by (id, workspace_id). Everything here runs as the tables'
-- owner, so it needs no superuser (Neon).

-- Assets gain the kind 'upload' and JPEG. A re-encoded 5 MB upload can be a
-- little larger than the file sent, so uploads may be up to 10 MB; drawn
-- pictures and logos keep their 2 MB, WebP and PNG.
alter table public.assets drop constraint assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind in ('image', 'logo', 'upload'));
alter table public.assets drop constraint assets_mime_check;
alter table public.assets add constraint assets_mime_check check (mime in ('image/webp', 'image/png', 'image/jpeg'));
alter table public.assets drop constraint assets_bytes_check;
alter table public.assets add constraint assets_bytes_check check (octet_length(bytes) between 1 and 10485760);
alter table public.assets add constraint assets_kind_parts check (
  case kind
    when 'upload' then mime in ('image/png', 'image/jpeg') and octet_length(bytes) <= 10485760
                       and created_by_kind = 'person' and simulated = false and campaign_id is null and run_id is null
    else mime in ('image/webp', 'image/png') and octet_length(bytes) <= 2097152
  end
);

create index assets_brand_kind_idx on public.assets (brand_id, workspace_id, kind, created_at desc);

create table public.uploaded_ad_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null,
  -- The uploaded ad (an asset of kind 'upload' of the same brand).
  asset_id uuid not null,
  channel text not null check (channel in ('paid social', 'display')),
  lang text not null check (lang ~ '^[a-z]{2}-[A-Z]{2}$'),
  -- The run that read it, and its model step (null once the run is deleted).
  run_id uuid,
  step_id uuid,
  -- The words the model read, as shown ("Read by AI"), with any real company name replaced (rule 2).
  words jsonb not null check (jsonb_typeof(words) = 'array' and octet_length(words::text) <= 24000),
  -- Every finding: rule, status, reason, fix and how it was found (in code, estimated, or by AI).
  findings jsonb not null check (jsonb_typeof(findings) = 'array' and octet_length(findings::text) <= 32000),
  outcome text not null check (outcome in ('passes', 'review', 'fails')),
  -- Read by the mock model (rule 1: labelled simulated).
  simulated boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- A retried step finds the row it already saved.
  unique (run_id),
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade,
  foreign key (asset_id, workspace_id) references public.assets (id, workspace_id) on delete cascade,
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete set null (run_id),
  foreign key (step_id, workspace_id) references public.agent_steps (id, workspace_id) on delete set null (step_id)
);

create index uploaded_ad_checks_workspace_idx on public.uploaded_ad_checks (workspace_id, created_at desc);
create index uploaded_ad_checks_brand_idx on public.uploaded_ad_checks (brand_id, workspace_id);
create index uploaded_ad_checks_asset_idx on public.uploaded_ad_checks (asset_id, workspace_id, created_at desc);
create index uploaded_ad_checks_run_idx on public.uploaded_ad_checks (run_id, workspace_id);
create index uploaded_ad_checks_step_idx on public.uploaded_ad_checks (step_id, workspace_id);
create index uploaded_ad_checks_created_by_idx on public.uploaded_ad_checks (created_by);

-- A check must be of an uploaded ad of its own brand.
create function public.uploaded_ad_checks_parts() returns trigger
language plpgsql set search_path = '' as $$
declare a record;
begin
  select kind, brand_id into a from public.assets where id = new.asset_id;
  if a is null or a.kind <> 'upload' or a.brand_id <> new.brand_id then
    raise exception 'A check must be of an uploaded ad of the same brand' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger uploaded_ad_checks_parts before insert on public.uploaded_ad_checks
for each row execute function public.uploaded_ad_checks_parts();

alter table public.uploaded_ad_checks enable row level security;

create policy uploaded_ad_checks_select on public.uploaded_ad_checks for select to authenticated using (public.is_member(workspace_id));
create policy uploaded_ad_checks_insert on public.uploaded_ad_checks for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));

revoke all on public.uploaded_ad_checks from anon;
-- Append-only: checks are read and added, never changed or removed by the app.
revoke update, delete, truncate, references, trigger on public.uploaded_ad_checks from authenticated;
