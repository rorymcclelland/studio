import "server-only";
import type { Mailer } from "./mailer";

const RESEND_URL = "https://api.resend.com/emails";

export class MailError extends Error {}

/**
 * Resend over plain fetch (no SDK). The key lives only in Vercel's Production
 * environment (rule 6) and never appears in an error or a log.
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
        // Resend's error body names the problem (for example an unverified domain); it holds no secret.
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new MailError(`Resend refused the email (HTTP ${res.status}). ${detail}`.trim());
      }
    },
  };
}
