import "server-only";
import { consoleMailer } from "./console";
import { resendMailer } from "./resend";

// N-3: the small mailer behind sign-in links. Resend's HTTP API in
// production; the console everywhere else (local work, CI, previews, and any
// non-production run without a Resend key), which writes the email to the
// server log and keeps it in memory for tests and the e2e mailbox route.

export type Email = { to: string; subject: string; text: string; html: string };

export interface Mailer {
  readonly kind: "resend" | "console";
  /** Sends one email; throws when the provider refuses it. */
  send(email: Email): Promise<void>;
}

/** Which mailer this environment uses. Production always uses Resend, so a missing key fails loudly instead of logging a link. */
export function mailerKind(env: Record<string, string | undefined> = process.env): Mailer["kind"] {
  if (env.VERCEL_ENV === "production") return "resend";
  if (env.VERCEL_ENV === "preview") return "console";
  return env.RESEND_API_KEY && env.EMAIL_FROM ? "resend" : "console";
}

export function getMailer(env: Record<string, string | undefined> = process.env): Mailer {
  return mailerKind(env) === "resend" ? resendMailer(env.RESEND_API_KEY, env.EMAIL_FROM) : consoleMailer();
}
