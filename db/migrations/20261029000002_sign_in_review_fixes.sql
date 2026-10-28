-- Sprint 6 review fixes for sign-in (N-3).
--
-- 1. Daily limits on sign-in links. Resend's free plan sends 100 emails a day,
--    and the hourly limits alone (3 per address, 30 in all) would let someone
--    use them all up in a few hours. request_sign_in now also allows at most
--    10 links per address and 80 in all in any 24 hours, keeping the hourly
--    limits, the advisory lock and the clean-up of old rows. The clean-up
--    keeps two days of rows, so the 24-hour count always sees every link it
--    needs.
--
-- 2. Defence in depth. request_sign_in trusts its p_allow_listed flag as the
--    server's word. It was executable by anon, which only the app's own server
--    reaches today, but nothing should rest on that: execute is now revoked
--    from every app role, and the app calls it on its own (owner) connection,
--    as it calls start_session.
--
-- Nothing here needs a superuser: the function is replaced by its owner.

create or replace function public.request_sign_in(p_email text, p_token_hash text, p_allow_listed boolean) returns boolean
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
  -- Two days kept: the daily limits count the last 24 hours.
  delete from auth.sign_in_tokens where created_at < now() - interval '2 days';
  -- Per address: 3 an hour, 10 a day.
  if (select count(*) from auth.sign_in_tokens t where t.email = v_email and t.created_at > now() - interval '1 hour') >= 3 then
    return false;
  end if;
  if (select count(*) from auth.sign_in_tokens t where t.email = v_email and t.created_at > now() - interval '1 day') >= 10 then
    return false;
  end if;
  -- In all: 30 an hour, 80 a day (Resend's free plan sends 100 a day).
  if (select count(*) from auth.sign_in_tokens t where t.created_at > now() - interval '1 hour') >= 30 then
    return false;
  end if;
  if (select count(*) from auth.sign_in_tokens t where t.created_at > now() - interval '1 day') >= 80 then
    return false;
  end if;
  insert into auth.sign_in_tokens (token_hash, email, expires_at) values (p_token_hash, v_email, now() + interval '15 minutes');
  return true;
end
$$;

-- No app role may call it: only the app's own connection, which decides the
-- allow-list flag from ALLOWED_EMAILS.
revoke all on function public.request_sign_in(text, text, boolean) from public, anon, authenticated;
