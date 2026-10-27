import { missingProviderKeys } from "@/lib/models/registry";

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** The owner (Rory): may invite people, and is exempt from the per-workspace cap. Defaults to the first allowed email. */
export function ownerEmail(env: Record<string, string | undefined> = process.env): string | null {
  const o = (env.OWNER_EMAIL ?? "").trim().toLowerCase();
  return o || allowedEmails()[0] || null;
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  const o = ownerEmail();
  return !!email && !!o && email.trim().toLowerCase() === o;
}

/** Each non-owner workspace's daily AI spend limit in pence (F-3), under the app-wide cap. */
export function workspaceCapPence(): number {
  const v = Number(process.env.WORKSPACE_DAILY_CAP_PENCE);
  return Number.isFinite(v) && v >= 0 ? v : 50;
}

/** The part of the daily cap only the owner can use (pence), so guests can't stop the owner's demo. */
export function ownerReservePence(): number {
  const v = Number(process.env.OWNER_RESERVE_PENCE);
  return Number.isFinite(v) && v >= 0 ? v : 50;
}

export function isEmailAllowed(email: string | null | undefined, list = allowedEmails()): boolean {
  if (!email) return false;
  return list.includes(email.trim().toLowerCase());
}

/**
 * Everything the app needs to start, checked in one place (S1-1 #4, S1-4 #6).
 * The layout shows these as a configuration page instead of a blank screen.
 */
export function configProblems(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  const need = (name: string, why: string) => {
    if (!env[name]) problems.push(`${name} is not set: ${why}.`);
  };
  need("DATABASE_URL", "the Postgres connection string");
  need("ALLOWED_EMAILS", "a comma-separated list of the emails allowed to sign in");

  // N-3: production sends sign-in links through Resend; everywhere else they go to the server log.
  if (env.VERCEL_ENV === "production") {
    need("RESEND_API_KEY", "the Resend API key that sends sign-in links (Vercel Production only, marked Sensitive)");
    need("EMAIL_FROM", 'the sender of sign-in emails, on the verified mcclelland.info subdomain, e.g. "Studio <sign-in@studio.mcclelland.info>"');
  }

  if (env.VERCEL && !env.INNGEST_DEV) {
    need("INNGEST_EVENT_KEY", "added by the Inngest integration for Vercel");
    need("INNGEST_SIGNING_KEY", "added by the Inngest integration for Vercel");
  }

  for (const m of missingProviderKeys(env)) {
    problems.push(`${m.envVar} is not set: the "${m.provider}" model provider is configured for an agent.`);
  }
  return problems;
}
