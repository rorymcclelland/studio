-- Baseline (N-1): the small part of an auth platform the later migrations rely
-- on. Studio owns this on Neon, locally and in CI: the anon and authenticated
-- roles, the auth schema with a users table, auth.uid() and auth.role().
--
-- Works whether the connecting role is a superuser (postgres, locally and in
-- CI) or not (studio_owner on Neon, which has CREATEROLE but no superuser,
-- no bypassrls and no alter system). Nothing here needs an extension:
-- gen_random_uuid() is built in from Postgres 13.
--
-- Every step checks first, so on a stack that already provides these objects
-- and owns them (the Supabase CLI stack in CI until N-4) it leaves them alone.

-- Roles. No service_role: nothing uses it. The connecting role is granted
-- both by name, so `set local role` works for it (asUser() relies on this).
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
    if not pg_has_role(current_user, r, 'USAGE') then
      execute format('grant %I to %I', r, current_user);
    end if;
  end loop;
end
$$;

-- The auth schema, its users table and the two helpers. Grants on them are
-- made only when this migration created them.
do $baseline$
begin
  if to_regnamespace('auth') is null then
    create schema auth;
    grant usage on schema auth to anon, authenticated;
  end if;

  if to_regclass('auth.users') is null then
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      created_at timestamptz not null default now()
    );
  end if;

  if to_regprocedure('auth.uid()') is null then
    create function auth.uid() returns uuid
    language sql stable as $fn$
      select nullif(
        coalesce(current_setting('request.jwt.claim.sub', true),
                 (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')),
        '')::uuid
    $fn$;
    grant execute on function auth.uid() to anon, authenticated;
  end if;

  if to_regprocedure('auth.role()') is null then
    create function auth.role() returns text
    language sql stable as $fn$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    $fn$;
    grant execute on function auth.role() to anon, authenticated;
  end if;
end
$baseline$;

-- The public schema: usage, and what the connecting role creates from here on
-- is granted to both roles by default. Later migrations revoke what each table
-- should not allow, and RLS decides which rows.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
