-- Sprint 10b, D-2 (decision 0028): fictional versus simulated, and a brand's own names.
--
-- brands.is_simulated used to mean two things: "this brand is invented" and
-- "its data is simulated". From here it means only the second. The new
-- brands.is_fictional means the first; the demo brands, the only brands that
-- were simulated before this migration, are both.
--
-- brands.own_names: up to 5 other names the brand's ads may use, such as a
-- parent brand's (rule 2's market exception). The 80-character limit per name
-- is the kit's (zod), as for the other kit lists.

alter table public.brands add column is_fictional boolean not null default false;
alter table public.brands add column own_names text[] not null default '{}';
alter table public.brands add constraint brands_own_names_max check (cardinality(own_names) <= 5);

-- The existing demo brands are fictional and simulated. This runs before the
-- guard below holds is_fictional.
update public.brands set is_fictional = true where is_simulated;

-- The guard: workspace and creator never change; is_fictional never changes
-- after insert; is_simulated may change from false to true (simulated data is
-- generated, D-3) and never back.
create or replace function public.brands_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.created_by is distinct from old.created_by
     or new.is_fictional is distinct from old.is_fictional
     or (old.is_simulated and not new.is_simulated) then
    raise exception 'A brand''s workspace, creator, fictional flag and simulated flag cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end
$$;
