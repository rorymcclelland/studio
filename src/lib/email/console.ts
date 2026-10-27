import "server-only";
import type { Email, Mailer } from "./mailer";

// The console mailer: local work, CI and previews. It writes each email to
// the server log, so a sign-in link can be copied from there, and keeps the
// last few in memory, so tests (and, off Vercel, the e2e mailbox route
// /api/dev/last-sign-in-link) can read them. Kept on globalThis because the
// server action that sends and the route that reads are separate bundles.

export type SentEmail = Email & { at: Date; seq: number };

type Outbox = { emails: SentEmail[]; seq: number };
declare global {
  var __csOutbox: Outbox | undefined;
}
const KEEP = 200;

function outbox(): Outbox {
  globalThis.__csOutbox ??= { emails: [], seq: 0 };
  return globalThis.__csOutbox;
}

export function consoleMailer(): Mailer {
  return {
    kind: "console",
    async send(email) {
      const box = outbox();
      box.seq += 1;
      box.emails.push({ ...email, at: new Date(), seq: box.seq });
      if (box.emails.length > KEEP) box.emails.splice(0, box.emails.length - KEEP);
      console.log(`[mail] (console mailer, not sent) to ${email.to}: ${email.subject}\n${email.text}`);
    },
  };
}

/** Emails the console mailer has "sent" to an address, oldest first. */
export function sentTo(address: string): SentEmail[] {
  const a = address.trim().toLowerCase();
  return outbox().emails.filter((e) => e.to === a);
}

const LINK = /https?:\/\/[^\s"<>]+\/signin\/link\/[A-Za-z0-9_-]{43}/;

/** The newest sign-in link sent to an address, with how many sign-in emails it has had, or null. */
export function lastSignInLink(address: string): { link: string; count: number } | null {
  const withLinks = sentTo(address).flatMap((e) => {
    const m = LINK.exec(e.text);
    return m ? [m[0]] : [];
  });
  return withLinks.length ? { link: withLinks[withLinks.length - 1], count: withLinks.length } : null;
}

/** Empties the in-memory outbox (tests). */
export function clearOutbox(): void {
  globalThis.__csOutbox = { emails: [], seq: 0 };
}
