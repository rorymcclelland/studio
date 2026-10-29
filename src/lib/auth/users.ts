import "server-only";
import { getSql } from "@/lib/db/client";

/**
 * The id of the auth.users row for an email, created if it is new. Called
 * only after an invite or a sign-in link has been used, never on a request
 * alone. auth.users is not workspace data and isn't granted to anon or
 * authenticated, so this runs on the app's own connection (as the old local
 * sign-in did); every workspace read still goes through asUser().
 */
export async function findOrCreateUser(email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  const [u] = await getSql()`
    insert into auth.users (email) values (${e})
    on conflict (email) do update set email = excluded.email
    returning id`;
  return u.id as string;
}
