-- N-2 and N-3 (Sprint 6): Studio's own sign-in. A session is a random token
-- in an httpOnly cookie; a sign-in link carries another. Only the SHA-256 of
-- either is stored, as invite tokens already are.
--
-- Both tables live in the auth schema and are granted to no one: anon and
-- authenticated can't read or change them. The app reaches them only through
-- the security-definer functions below, each with an empty search_path.
--
-- Allow-list membership lives in the ALLOWED_EMAILS environment variable, so
-- the server decides it in code and passes a flag to request_sign_in; the
-- database half is the invites (public.is_invited). The anon role is reached
-- only by the app's own server connection (the Data API is off, and Neon has
-- none), so the flag is trusted as the server's word.

create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_id_idx on auth.sessions (user_id);
create index sessions_expires_at_idx on auth.sessions (expires_at);

create table auth.sign_in_tokens (
  token_hash text primary key check (char_length(token_hash) = 64),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and position('@' in email) > 1),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
-- The rate limits count an address's links, and all links, in the last hour.
create index sign_in_tokens_email_created_idx on auth.sign_in_tokens (email, created_at desc);
create index sign_in_tokens_created_idx on auth.sign_in_tokens (created_at desc);

alter table auth.sessions enable row level security;
alter table auth.sign_in_tokens enable row level security;
revoke all on auth.sessions, auth.sign_in_tokens from public, anon, authenticated;

-- Starts a session for a user. Not granted to anon or authenticated: only the
-- app's own connection calls it, after an invite or a sign-in link has been
-- used, so no caller can mint a session for any user id it likes.
create function public.start_session(p_user uuid, p_token_hash text, p_expires_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.sessions where expires_at < now() - interval '1 day';
  insert into auth.sessions (user_id, token_hash, expires_at) values (p_user, p_token_hash, p_expires_at);
end
$$;

-- The user a session token's hash belongs to, or no row (unknown, ended or
-- expired). A session used more than a day after it was last seen is
-- extended to 30 days from now. (Named lookup_session, not session_user,
-- because SESSION_USER is a reserved word in SQL.)
create function public.lookup_session(p_token_hash text) returns table (user_id uuid, email text)
language plpgsql security definer set search_path = '' as $$
begin
  update auth.sessions s set last_seen_at = now(), expires_at = now() + interval '30 days'
  where s.token_hash = p_token_hash and s.expires_at > now() and s.last_seen_at < now() - interval '1 day';
  return query
    select s.user_id, u.email::text from auth.sessions s join auth.users u on u.id = s.user_id
    where s.token_hash = p_token_hash and s.expires_at > now();
end
$$;

-- Ends one session (sign-out). True if there was one to end.
create function public.end_session(p_token_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.sessions where token_hash = p_token_hash;
  get diagnostics n = row_count;
  return n > 0;
end
$$;

-- Revoking a person ends their sessions and any sign-in link not yet used.
-- Only someone who invited that address may call it, and only once the
-- address has no access left (public.is_invited is false), so no member can
-- sign out someone who still has access. Returns the sessions ended.
create function public.end_sessions_for_email(p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  n integer;
begin
  if not exists (select 1 from public.invites i where i.email = v_email and i.created_by = auth.uid())
     or public.is_invited(v_email) then
    return 0;
  end if;
  delete from auth.sessions s using auth.users u where u.id = s.user_id and lower(u.email) = v_email;
  get diagnostics n = row_count;
  update auth.sign_in_tokens set used_at = now() where email = v_email and used_at is null;
  return n;
end
$$;

-- Records a sign-in link's token hash, for 15 minutes, when the address has
-- access (allow-listed, as the server says, or invited and not revoked) and
-- the limits allow it: 3 links per address per hour, 30 an hour in all (they
-- protect the free sending quota). True means send the link. The sign-in page
-- shows the same reply either way, so it never reveals who has access.
create function public.request_sign_in(p_email text, p_token_hash text, p_allow_listed boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email));
begin
  if v_email is null or char_length(v_email) > 254 or position('@' in v_email) < 2 then
    return false;
  end if;
  if not (coalesce(p_allow_listed, false) or public.is_invited(v_email)) then
    return false;
  end if;
  -- One request at a time, so concurrent requests can't both pass a limit.
  perform pg_advisory_xact_lock(hashtext('public.request_sign_in'));
  delete from auth.sign_in_tokens where created_at < now() - interval '1 day';
  if (select count(*) from auth.sign_in_tokens t where t.email = v_email and t.created_at > now() - interval '1 hour') >= 3 then
    return false;
  end if;
  if (select count(*) from auth.sign_in_tokens t where t.created_at > now() - interval '1 hour') >= 30 then
    return false;
  end if;
  insert into auth.sign_in_tokens (token_hash, email, expires_at) values (p_token_hash, v_email, now() + interval '15 minutes');
  return true;
end
$$;

-- Uses a sign-in link: marks it used and returns its email, or null when it
-- is unknown, used already or expired. It works once.
create function public.use_sign_in(p_token_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  update auth.sign_in_tokens set used_at = now()
  where token_hash = p_token_hash and used_at is null and expires_at > now()
  returning email into v_email;
  return v_email;
end
$$;

-- Execute only where needed: the default privileges give new functions in
-- public to anon and authenticated, so take everything back first.
revoke all on function public.start_session(uuid, text, timestamptz), public.lookup_session(text), public.end_session(text),
  public.end_sessions_for_email(text), public.request_sign_in(text, text, boolean), public.use_sign_in(text)
  from public, anon, authenticated;
do $$
begin
  -- Supabase and the local shim also have service_role; Neon's baseline doesn't.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on auth.sessions, auth.sign_in_tokens from service_role;
    revoke all on function public.start_session(uuid, text, timestamptz), public.lookup_session(text), public.end_session(text),
      public.end_sessions_for_email(text), public.request_sign_in(text, text, boolean), public.use_sign_in(text)
      from service_role;
  end if;
end
$$;
-- Before anyone is signed in (anon), and from signed-in pages that look up their own session.
grant execute on function public.lookup_session(text), public.end_session(text) to anon, authenticated;
grant execute on function public.request_sign_in(text, text, boolean), public.use_sign_in(text) to anon;
-- The owner revoking a person, signed in.
grant execute on function public.end_sessions_for_email(text) to authenticated;
