-- F-3: interviewers get in through invite links Rory sends himself (Supabase's
-- built-in email only reaches project team members). An invite is app-level,
-- like profiles: it is about who may sign in, not workspace data, so it has no
-- workspace_id. Only its creator can see or change it; redeeming happens
-- through two narrow security-definer functions, since the person redeeming
-- is not signed in yet.

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and position('@' in email) > 1),
  token_hash text not null unique check (char_length(token_hash) = 64),
  note text check (note is null or char_length(note) <= 200),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id),
  revoked_at timestamptz
);

create index invites_created_by_idx on public.invites (created_by, created_at desc);
create index invites_used_by_idx on public.invites (used_by);
create index invites_email_idx on public.invites (email);

alter table public.invites enable row level security;
create policy invites_select on public.invites for select to authenticated using (created_by = (select auth.uid()));
create policy invites_insert on public.invites for insert to authenticated with check (created_by = (select auth.uid()));
create policy invites_update on public.invites for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
revoke all on public.invites from anon;
revoke delete, truncate on public.invites from authenticated;

-- The email an unused, unexpired, unrevoked invite is for, or nothing.
create function public.check_invite(p_token_hash text) returns text
language sql stable security definer set search_path = '' as $$
  select i.email from public.invites i
  where i.token_hash = p_token_hash and i.used_at is null and i.revoked_at is null and i.expires_at > now()
$$;

-- Marks an invite used by the user it signed in; false if it was used, revoked or expired meanwhile.
create function public.use_invite(p_token_hash text, p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.invites set used_at = now(), used_by = p_user
  where token_hash = p_token_hash and used_at is null and revoked_at is null and expires_at > now();
  get diagnostics n = row_count;
  return n = 1;
end
$$;

-- True when an email has a used invite that hasn't been revoked: the database half of the allow-list.
create function public.is_invited(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.invites i where i.email = lower(btrim(p_email)) and i.used_at is not null and i.revoked_at is null)
$$;

-- The signed-in user's email, so the app can tell the owner apart (per-workspace caps).
create function public.current_user_email() returns text
language sql stable security definer set search_path = '' as $$
  select u.email::text from auth.users u where u.id = auth.uid()
$$;

-- Today's spend for one workspace (members only: the ledger's own policy applies).
create function public.workspace_spend_today_pence(p_workspace uuid, tz text default 'Europe/London') returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(l.cost_pence), 0) from public.usage_ledger l
  where l.workspace_id = p_workspace and l.created_at >= (date_trunc('day', now() at time zone tz) at time zone tz)
$$;

revoke all on function public.check_invite(text), public.use_invite(text, uuid), public.is_invited(text),
  public.current_user_email(), public.workspace_spend_today_pence(uuid, text) from public;
grant execute on function public.check_invite(text), public.use_invite(text, uuid) to anon, authenticated;
grant execute on function public.is_invited(text), public.current_user_email(), public.workspace_spend_today_pence(uuid, text) to authenticated;
