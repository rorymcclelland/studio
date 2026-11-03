-- Sprint 8 review fixes (nit 8): public.set_asset_vision took any JSON
-- object. A picture-check result always has a "status" (checked, error or
-- cap, src/lib/compliance/vision.ts), and the compliance rules read nothing
-- else first, so a result without one is refused rather than stored as
-- something no rule can read. Everything else is as 20261103000004: only a
-- picture in the caller's workspace, through this function alone.

create or replace function public.set_asset_vision(p_asset uuid, p_vision jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  n integer;
begin
  if who is null then
    raise exception 'A picture check needs a signed-in person' using errcode = '42501';
  end if;
  if p_vision is null or jsonb_typeof(p_vision) <> 'object' then
    raise exception 'A picture check result must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(p_vision -> 'status') is distinct from 'string' or (p_vision ->> 'status') not in ('checked', 'error', 'cap') then
    raise exception 'A picture check result must have a status: checked, error or cap' using errcode = '22023';
  end if;
  update public.assets a set meta = jsonb_set(a.meta, '{vision}', p_vision)
  where a.id = p_asset and a.kind = 'image'
    and a.workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = who);
  get diagnostics n = row_count;
  return n = 1;
end
$$;

revoke all on function public.set_asset_vision(uuid, jsonb) from public, anon;
grant execute on function public.set_asset_vision(uuid, jsonb) to authenticated;
