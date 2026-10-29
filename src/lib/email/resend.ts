import "server-only";
import type { Mailer } from "./mailer";

const RESEND_URL = "https://api.resend.com/emails";

export class MailError extends Error {}

/**
 * Resend over plain fetch (no SDK). The key lives only in Vercel's Production
 * environment (rule 6) and never appears in an error or a log, and neither
 * does the recipient's address.
 */
export function resendMailer(apiKey: string | undefined, from: string | undefined, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    kind: "resend",
    async send({ to, subject, text, html }) {
      if (!apiKey) throw new MailError("RESEND_API_KEY is not set, so no email can be sent.");
      if (!from) throw new MailError("EMAIL_FROM is not set, so no email can be sent.");
      const res = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // The message is logged, so it carries the status and a short reason only: never the
        // recipient, and any address Resend's body echoes back is scrubbed.
        const reason = mailErrorReason(await res.text().catch(() => ""));
        throw new MailError(`Resend refused the email (HTTP ${res.status}).${reason ? ` ${reason}` : ""}`);
      }
    },
  };
}

const EMAIL_LIKE = /[^\s@"'<>(),;:[\]]+@[^\s@"'<>(),;:[\]]+/g;

/** Replaces anything shaped like an email address with "[address]". */
export function scrubEmails(text: string): string {
  // A full stop after an address ends the sentence; keep it.
  return text.replace(EMAIL_LIKE, (m) => `[address]${/\.+$/.exec(m)?.[0] ?? ""}`);
}

/**
 * A short reason from a provider's error body, safe to log: its JSON
 * `message` (or `error`) when it has one, else the text, with addresses
 * scrubbed and at most 200 characters.
 */
export function mailErrorReason(body: string): string {
  let reason = body;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const m = typeof o.message === "string" ? o.message : typeof o.error === "string" ? o.error : null;
      if (m) reason = m;
    }
  } catch {
    // Not JSON: use the text as it is.
  }
  return scrubEmails(reason.replace(/\s+/g, " ").trim()).slice(0, 200);
}
