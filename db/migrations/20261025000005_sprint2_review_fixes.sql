-- Sprint 2 review fixes (findings 4, 5 and 6).
--
-- 4. Defence in depth for writes that bypass the app (the app never uses
--    Supabase's Data API, but a signed-in user could): the database checks
--    palette entries itself, and a brand's workspace, creator and simulated
--    flag cannot change after it is created (rule 1: the "Simulated data"
--    label cannot be switched off).
-- 5. A brand's customer data has an "as of" date, so time windows (last 12 and
--    24 months) are measured from when the data was made, not from today.
-- 6. Policies on the Sprint 2 tables check membership once per query
--    (a subquery on workspace_members) instead of once per row.

alter table public.brands add column data_as_of timestamptz;

create function public.valid_palette(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 12
    and not exists (
      select 1 from jsonb_array_elements(p) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(e ->> 'hex', '') !~ '^#[0-9A-Fa-f]{6}$'
         or char_length(coalesce(e ->> 'name', '')) not between 1 and 40
         or (select count(*) from jsonb_object_keys(e)) <> 2
    )
$$;

alter table public.brands add constraint brands_palette_valid check (public.valid_palette(palette));

create function public.brands_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.created_by is distinct from old.created_by
     or new.is_simulated is distinct from old.is_simulated then
    raise exception 'A brand''s workspace, creator and simulated flag cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger brands_guard before update on public.brands
for each row execute function public.brands_guard();

-- Membership once per query. (select auth.uid()) is evaluated once; the
-- subquery is planned as a hashed semi-join rather than a function call per row.

alter policy brands_select on public.brands
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
alter policy brands_insert on public.brands
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid()))
              and created_by = (select auth.uid()));
alter policy brands_update on public.brands
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
alter policy brands_delete on public.brands
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));

alter policy products_all on public.products
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
alter policy customers_all on public.customers
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
alter policy orders_all on public.orders
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
alter policy order_lines_all on public.order_lines
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
alter policy context_items_all on public.context_items
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
alter policy context_edges_all on public.context_edges
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
