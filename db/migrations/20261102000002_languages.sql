-- C7-2: languages. A brand picks the languages its ads are translated into
-- (French, German and Spanish to start, Q3), and its kit holds, per language,
-- the legal lines and banned terms a person wrote (Q4: legal lines are never
-- machine-translated). The Localise agent's translations are copy sets of
-- their own (lang, translated_from the English set), append-only like the
-- others; a translated ad is drawn on request from the English ad's picture,
-- layout and kit with the translated words, so ad_variants stays one row per
-- picked ad (as for sizes, C7-1).
--
-- Rule 7: brand_languages carries workspace_id with row-level security, and
-- references its brand by (id, workspace_id). Everything here runs as the
-- tables' owner, so it needs no superuser (Neon).

create table public.brand_languages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null,
  -- A language tag such as fr-FR; the supported list is in code (src/lib/creative/languages.ts),
  -- so the next languages need no schema change. English is the kit itself.
  lang text not null check (lang ~ '^[a-z]{2}-[A-Z]{2}$' and lang <> 'en-GB'),
  legal_lines text[] not null default '{}' check (cardinality(legal_lines) <= 20),
  banned_terms text[] not null default '{}' check (cardinality(banned_terms) <= 50),
  -- The demo brands' lines were written by Claude for the demo (Q4), and say so until a person edits them.
  written_for_demo boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, lang),
  unique (id, workspace_id),
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade
);

create index brand_languages_workspace_idx on public.brand_languages (workspace_id);
create index brand_languages_brand_idx on public.brand_languages (brand_id, workspace_id);
create index brand_languages_created_by_idx on public.brand_languages (created_by);

create trigger brand_languages_touch before update on public.brand_languages
for each row execute function public.touch_updated_at();

alter table public.brand_languages enable row level security;

create policy brand_languages_select on public.brand_languages for select to authenticated using (public.is_member(workspace_id));
create policy brand_languages_insert on public.brand_languages for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));
create policy brand_languages_update on public.brand_languages for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy brand_languages_delete on public.brand_languages for delete to authenticated using (public.is_member(workspace_id));

revoke all on public.brand_languages from anon;
-- Saving a brand's languages reads, adds, updates and removes rows; the rest of the default grant is taken back.
revoke truncate, references, trigger on public.brand_languages from authenticated;

-- Copy sets gain a language. Every set so far is British English. A
-- translation names the English set it was made from, and records whether the
-- mock model wrote it (rule 1: labelled simulated).
alter table public.copy_sets
  add column lang text not null default 'en-GB' check (lang ~ '^[a-z]{2}-[A-Z]{2}$'),
  add column translated_from uuid,
  add column simulated boolean not null default false,
  add constraint copy_sets_translation check ((lang = 'en-GB') = (translated_from is null)),
  add constraint copy_sets_translated_by_agent check (translated_from is null or (source = 'agent' and based_on is null)),
  add constraint copy_sets_translated_from_fk foreign key (translated_from, workspace_id) references public.copy_sets (id, workspace_id);

create index copy_sets_translated_from_idx on public.copy_sets (translated_from, workspace_id);
-- One current translation of a set per language, so a retried step or two clicks can't double it.
create unique index copy_sets_translation_once on public.copy_sets (translated_from, lang)
  where translated_from is not null and discarded_at is null;

-- A translation must be of an English ad set (paid social or display) of the same campaign, version and audience.
create function public.copy_sets_translation_parts() returns trigger
language plpgsql set search_path = '' as $$
declare src record;
begin
  if new.translated_from is null then return new; end if;
  select campaign_id, brief_version, channel, lang, segment_ref into src from public.copy_sets where id = new.translated_from;
  if src is null or src.lang <> 'en-GB' or src.campaign_id <> new.campaign_id or src.brief_version <> new.brief_version
     or src.channel <> new.channel or src.segment_ref is distinct from new.segment_ref
     or new.channel not in ('paid social', 'display') then
    raise exception 'A translation must be of an English paid-social or display set of the same campaign, version and audience' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger copy_sets_translation_parts before insert on public.copy_sets
for each row execute function public.copy_sets_translation_parts();

-- The guard (20261028000003) now covers the new columns: still only the discard mark changes.
create or replace function public.copy_sets_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.workspace_id, new.campaign_id, new.brief_version, new.channel, new.segment_ref, new.segment_title,
      new.set, new.legal_lines, new.source, new.based_on, new.created_by, new.created_at,
      new.lang, new.translated_from, new.simulated)
     is distinct from
     (old.id, old.workspace_id, old.campaign_id, old.brief_version, old.channel, old.segment_ref, old.segment_title,
      old.set, old.legal_lines, old.source, old.based_on, old.created_by, old.created_at,
      old.lang, old.translated_from, old.simulated)
     or (new.run_id is distinct from old.run_id and new.run_id is not null) then
    raise exception 'Only a copy set''s discard mark can change' using errcode = '42501';
  end if;
  return new;
end
$$;

-- An ad's own words are English: a translated ad is drawn from the English ad
-- with its translation, never stored as a variant of its own.
create or replace function public.ad_variants_parts() returns trigger
language plpgsql set search_path = '' as $$
declare
  img record;
  cs record;
begin
  select kind, campaign_id into img from public.assets where id = new.image_asset_id;
  if img is null or img.kind <> 'image' or img.campaign_id is distinct from new.campaign_id then
    raise exception 'A variant''s picture must be an image of the same campaign' using errcode = '23514';
  end if;
  select channel, campaign_id, brief_version, lang into cs from public.copy_sets where id = new.copy_set_id;
  if cs is null or cs.campaign_id <> new.campaign_id or cs.brief_version <> new.brief_version
     or cs.channel not in ('paid social', 'display') then
    raise exception 'A variant''s words must be a paid-social or display set for the same brief version' using errcode = '23514';
  end if;
  if cs.lang <> 'en-GB' then
    raise exception 'A variant''s words must be the English set; translations are drawn from it' using errcode = '23514';
  end if;
  return new;
end
$$;
