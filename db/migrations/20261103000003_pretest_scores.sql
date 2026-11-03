-- C8-4: the pre-test panel. The brief's synthetic personas (from the latest
-- persona review of the signed-off version) score a picked ad 1 to 5 on four
-- scales, each with a reason quoting the ad's own words (the Pretest agent,
-- one Haiku vision call per ad). Labelled "Synthetic panel, not real
-- customers" wherever shown (rule 1).
--
-- Scores are kept with the ad they were for and its key: the ad's ETag, made
-- from its picture's hash, its words (a copy set never changes), its layout
-- and its kit. A redraw, new words or a new picture make a new variant, and a
-- layout switch changes the key, so the scores show "Out of date: pre-test
-- again" rather than being carried over.
--
-- Append-only, like persona reviews: a pre-test again adds a row. Rule 7:
-- workspace_id with row-level security, every parent referenced by
-- (id, workspace_id). Everything here runs as the tables' owner, so it needs
-- no superuser (Neon).

create table public.pretest_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null,
  variant_id uuid not null,
  -- The ad's parts when it was scored: its picture and its words, and the key over all it showed.
  image_asset_id uuid not null,
  copy_set_id uuid not null,
  ad_key text not null check (ad_key ~ '^"ad-[0-9a-f]{40}"$'),
  -- The persona review the panel came from (null once that run is deleted).
  persona_run_id uuid,
  run_id uuid not null,
  step_id uuid,
  -- Each persona's scores and reasons, as the Pretest agent's checked output, with the personas' names.
  panel jsonb not null check (jsonb_typeof(panel) = 'object' and octet_length(panel::text) <= 24000),
  -- The panel average over every persona and scale, one decimal place: a score, never a prediction.
  average numeric(2, 1) not null check (average >= 1 and average <= 5),
  -- Scored by the mock model (rule 1: labelled simulated).
  simulated boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- A retried step finds the row it already saved.
  unique (run_id, variant_id),
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade,
  foreign key (variant_id, workspace_id) references public.ad_variants (id, workspace_id) on delete cascade,
  foreign key (image_asset_id, workspace_id) references public.assets (id, workspace_id) on delete cascade,
  foreign key (copy_set_id, workspace_id) references public.copy_sets (id, workspace_id) on delete cascade,
  foreign key (run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete cascade,
  foreign key (persona_run_id, workspace_id) references public.agent_runs (id, workspace_id) on delete set null (persona_run_id),
  foreign key (step_id, workspace_id) references public.agent_steps (id, workspace_id) on delete set null (step_id)
);

create index pretest_scores_workspace_idx on public.pretest_scores (workspace_id, created_at desc);
create index pretest_scores_campaign_idx on public.pretest_scores (campaign_id, workspace_id);
create index pretest_scores_variant_idx on public.pretest_scores (variant_id, workspace_id, created_at desc);
create index pretest_scores_image_idx on public.pretest_scores (image_asset_id, workspace_id);
create index pretest_scores_copy_set_idx on public.pretest_scores (copy_set_id, workspace_id);
create index pretest_scores_run_idx on public.pretest_scores (run_id, workspace_id);
create index pretest_scores_persona_run_idx on public.pretest_scores (persona_run_id, workspace_id);
create index pretest_scores_step_idx on public.pretest_scores (step_id, workspace_id);
create index pretest_scores_created_by_idx on public.pretest_scores (created_by);

-- The scores' parts must be the ad's own: its campaign, its picture and its words.
create function public.pretest_scores_parts() returns trigger
language plpgsql set search_path = '' as $$
declare v record;
begin
  select campaign_id, image_asset_id, copy_set_id into v from public.ad_variants where id = new.variant_id;
  if v is null or v.campaign_id <> new.campaign_id or v.image_asset_id <> new.image_asset_id or v.copy_set_id <> new.copy_set_id then
    raise exception 'Pre-test scores must name the ad''s own campaign, picture and words' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pretest_scores_parts before insert on public.pretest_scores
for each row execute function public.pretest_scores_parts();

alter table public.pretest_scores enable row level security;

create policy pretest_scores_select on public.pretest_scores for select to authenticated using (public.is_member(workspace_id));
create policy pretest_scores_insert on public.pretest_scores for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));

revoke all on public.pretest_scores from anon;
-- Append-only: scores are read and added, never changed or removed by the app.
revoke update, delete, truncate, references, trigger on public.pretest_scores from authenticated;
