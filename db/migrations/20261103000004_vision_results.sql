-- C8-2: the picture check's results are kept with the picture, in
-- assets.meta.vision: what the model said about text, a face and each of the
-- kit's don't rules, with the run, step, provider and model (rule 4), or why
-- the check didn't run. Assets stay append-only for everything else: the
-- guard now lets meta's "vision" key change (and only that key), and the app's
-- role still can't update meta directly. It writes the record only through
-- public.set_asset_vision, which checks the caller is a member of the
-- picture's workspace (rule 7). The meta column's own limit (an object of at
-- most 8,000 bytes) still applies.

create or replace function public.assets_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.workspace_id, new.kind, new.brand_id, new.campaign_id, new.mime, new.width, new.height,
      new.bytes, new.sha256, new.simulated, new.meta - 'vision', new.created_by, new.created_by_kind, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.kind, old.brand_id, old.campaign_id, old.mime, old.width, old.height,
      old.bytes, old.sha256, old.simulated, old.meta - 'vision', old.created_by, old.created_by_kind, old.created_at)
     or (new.run_id is distinct from old.run_id and new.run_id is not null) then
    raise exception 'An asset cannot be changed, only marked discarded' using errcode = '42501';
  end if;
  -- A result may be set or replaced on a picture, as an object, or taken away (which only makes the picture "not checked yet").
  if (new.meta -> 'vision') is distinct from (old.meta -> 'vision') and (new.meta -> 'vision') is not null
     and (new.kind <> 'image' or jsonb_typeof(new.meta -> 'vision') <> 'object') then
    raise exception 'A picture check result must be an object, on a picture' using errcode = '22023';
  end if;
  return new;
end
$$;

-- Records a picture check on a picture in the caller's workspace. Returns
-- false (and changes nothing) for any other asset, or an id that isn't one.
create function public.set_asset_vision(p_asset uuid, p_vision jsonb) returns boolean
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
  update public.assets a set meta = jsonb_set(a.meta, '{vision}', p_vision)
  where a.id = p_asset and a.kind = 'image'
    and a.workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = who);
  get diagnostics n = row_count;
  return n = 1;
end
$$;

revoke all on function public.set_asset_vision(uuid, jsonb) from public, anon;
grant execute on function public.set_asset_vision(uuid, jsonb) to authenticated;
