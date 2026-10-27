-- S5-3 and S5-4: ad variants, and F-10: PNG logos.
--
-- A variant is one picture (an image asset) and one ad copy set (paid social
-- or display) in one layout, for a campaign's signed-off brief version. Its
-- PNG is drawn in code on request (/ads/[id]); the row keeps what the
-- renderer checked (contrast, fit, legal line) and a snapshot of the kit it
-- was drawn with (palette, fonts, logo), so a later change to the kit doesn't
-- change an ad already made (as copy_sets keep their legal lines).
--
-- Append-only, except the marks a person adds (picked, discarded) and the
-- layout, which a person may switch; the checks change only with the layout,
-- because they are the new layout's checks. A new picture or new words make a
-- new variant (based_on the old one) and discard the old one.
--
-- Rule 7: workspace_id with row-level security, every parent referenced by
-- (id, workspace_id).

create table public.ad_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null,
  brief_version integer not null check (brief_version >= 1),
  image_asset_id uuid not null,
  copy_set_id uuid not null,
  layout text not null check (layout in ('full-bleed', 'split', 'card')),
  checks jsonb not null check (jsonb_typeof(checks) = 'object' and octet_length(checks::text) <= 16000),
  -- Palette, fonts, brand name and logo as drawn (the SVG text, or the PNG logo asset id).
  -- Room for a 50,000-character SVG logo after JSON escaping.
  kit jsonb not null check (jsonb_typeof(kit) = 'object' and octet_length(kit::text) <= 200000),
  -- How it came to be: composed by Make creative, or a person's new picture, new words or edit.
  origin text not null check (origin in ('composed', 'new picture', 'new words', 'edited words')),
  -- The creative run that made it; null for a person's choice of words, or once the run is deleted.
  run_id uuid,
  based_on uuid,
  picked_at timestamptz,
  discarded_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint ad_variants_not_self check (based_on is distinct from id),
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (campaign_id, brief_version) references public.brief_versions (campaign_id, version) on delete cascade,
  foreign key (image_asset_id, workspace_id) references public.assets (id, workspace_id) on delete cascade,
  foreign key (copy_set_id, workspace_id) references public.copy_sets (id, workspace_id) on delete cascade,
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete set null (run_id),
  foreign key (based_on, workspace_id) references public.ad_variants (id, workspace_id) on delete set null (based_on)
);

create index ad_variants_workspace_idx on public.ad_variants (workspace_id, created_at desc);
create index ad_variants_campaign_idx on public.ad_variants (campaign_id, workspace_id, brief_version);
create index ad_variants_version_idx on public.ad_variants (campaign_id, brief_version);
create index ad_variants_image_idx on public.ad_variants (image_asset_id, workspace_id);
create index ad_variants_copy_set_idx on public.ad_variants (copy_set_id, workspace_id);
create index ad_variants_run_idx on public.ad_variants (run_id, workspace_id);
create index ad_variants_based_on_idx on public.ad_variants (based_on, workspace_id);
create index ad_variants_created_by_idx on public.ad_variants (created_by);
-- One current variant per picture and words, so a retried step or a restore can't double the gallery.
create unique index ad_variants_current_once on public.ad_variants (image_asset_id, copy_set_id) where discarded_at is null;

-- A variant's parts must be a picture and ad words of the same campaign and brief version.
create function public.ad_variants_parts() returns trigger
language plpgsql set search_path = '' as $$
declare
  img record;
  cs record;
begin
  select kind, campaign_id into img from public.assets where id = new.image_asset_id;
  if img is null or img.kind <> 'image' or img.campaign_id is distinct from new.campaign_id then
    raise exception 'A variant''s picture must be an image of the same campaign' using errcode = '23514';
  end if;
  select channel, campaign_id, brief_version into cs from public.copy_sets where id = new.copy_set_id;
  if cs is null or cs.campaign_id <> new.campaign_id or cs.brief_version <> new.brief_version
     or cs.channel not in ('paid social', 'display') then
    raise exception 'A variant''s words must be a paid-social or display set for the same brief version' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger ad_variants_parts before insert on public.ad_variants
for each row execute function public.ad_variants_parts();

-- Only the marks and the layout (with its checks) change. A deleted run or
-- variant clears its link (the foreign keys' own actions).
create function public.ad_variants_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.workspace_id, new.campaign_id, new.brief_version, new.image_asset_id, new.copy_set_id,
      new.kit, new.origin, new.created_by, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.campaign_id, old.brief_version, old.image_asset_id, old.copy_set_id,
      old.kit, old.origin, old.created_by, old.created_at)
     or (new.run_id is distinct from old.run_id and new.run_id is not null)
     or (new.based_on is distinct from old.based_on and new.based_on is not null)
     or (new.checks is distinct from old.checks and new.layout is not distinct from old.layout) then
    raise exception 'Only a variant''s marks and layout can change' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger ad_variants_guard before update on public.ad_variants
for each row execute function public.ad_variants_guard();

alter table public.ad_variants enable row level security;

create policy ad_variants_select on public.ad_variants for select to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
create policy ad_variants_insert on public.ad_variants for insert to authenticated
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid()))
              and created_by = (select auth.uid()));
create policy ad_variants_update on public.ad_variants for update to authenticated
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));

revoke all on public.ad_variants from anon;
revoke update, delete, truncate on public.ad_variants from authenticated;
grant update (picked_at, discarded_at, layout, checks) on public.ad_variants to authenticated;

-- F-10: a PNG logo, stored as an asset of kind 'logo' for the same brand. The
-- SVG logo stays in brands.logo_svg; a brand has at most one of the two.
alter table public.brands
  add column logo_asset_id uuid,
  add constraint brands_logo_asset_fk foreign key (logo_asset_id, workspace_id)
    references public.assets (id, workspace_id) on delete set null (logo_asset_id);

create index brands_logo_asset_idx on public.brands (logo_asset_id, workspace_id) where logo_asset_id is not null;

create function public.brands_logo_asset_check() returns trigger
language plpgsql set search_path = '' as $$
declare a record;
begin
  if new.logo_asset_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.logo_asset_id is not distinct from old.logo_asset_id then return new; end if;
  select kind, brand_id, mime into a from public.assets where id = new.logo_asset_id;
  if a is null or a.kind <> 'logo' or a.brand_id <> new.id or a.mime <> 'image/png' then
    raise exception 'A brand''s logo must be a PNG logo asset of the same brand' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger brands_logo_asset_check before insert or update of logo_asset_id on public.brands
for each row execute function public.brands_logo_asset_check();
