-- Sprint 10b, review fix S1 (rule 2): a fictional demo brand has no own names.
--
-- Own names (D-2, decision 0028) let a person's own real brand use a parent
-- brand's name in its briefs and ads. A fictional brand has no real parent, so
-- an own name on it could only carry a real company's name into the demo
-- brands' copy. The kit editor hides "Also known as" for a fictional brand and
-- updateBrand() refuses own names for one; this holds it in the database too.
-- The demo brands have none today, so the check holds for every existing row.

alter table public.brands
  add constraint brands_fictional_no_own_names check (not is_fictional or cardinality(own_names) = 0);
