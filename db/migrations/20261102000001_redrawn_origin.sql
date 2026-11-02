-- F-26: Redraw with the current kit. A redrawn ad is a new variant (origin
-- 'redrawn', based_on the ad it replaces) with the same picture, words and
-- layout and the brand's kit as it is now; the old ad is discarded, and
-- restoring it discards the redrawn one. The guard on kit (ad_variants_guard)
-- stays as it is: a variant's kit never changes in place.
--
-- Only the origin check changes. It runs as the table's owner, so it needs no
-- superuser (Neon).

alter table public.ad_variants drop constraint ad_variants_origin_check;
alter table public.ad_variants add constraint ad_variants_origin_check
  check (origin in ('composed', 'new picture', 'new words', 'edited words', 'redrawn'));
