import type { Email } from "@/lib/email/mailer";

// N-3: the sign-in email. Plain text and simple HTML, British English. It
// says what Studio is and that the link works once, for 15 minutes (rule 1).

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function signInEmail(to: string, link: string, minutes: number): Email {
  const subject = "Your sign-in link for Studio";
  const text = [
    "Here is your link to sign in to Studio:",
    "",
    link,
    "",
    `It works once and lasts ${minutes} minutes. Open it and press Continue to sign in.`,
    "",
    "Studio is a multi-agent campaign studio built by Rory McClelland. AI agents propose briefs and creative for fictional brands, and a person approves every move that spends, publishes or replaces creative.",
    "",
    "If you didn't ask for this link, you can ignore this email. No one can sign in without it.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en-GB">
<body style="font-family: Arial, Helvetica, sans-serif; color: #1f2328; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 24px;">
<p>Here is your link to sign in to Studio:</p>
<p><a href="${escape(link)}" style="display: inline-block; background: #24292f; color: #ffffff; padding: 10px 18px; border-radius: 999px; text-decoration: none; font-weight: bold;">Sign in to Studio</a></p>
<p>It works once and lasts ${minutes} minutes. Open it and press Continue to sign in.</p>
<p style="color: #4b535d; font-size: 14px;">If the button doesn't work, copy this address into your browser:<br><span style="word-break: break-all;">${escape(link)}</span></p>
<p style="color: #4b535d; font-size: 14px;">Studio is a multi-agent campaign studio built by Rory McClelland. AI agents propose briefs and creative for fictional brands, and a person approves every move that spends, publishes or replaces creative.</p>
<p style="color: #4b535d; font-size: 14px;">If you didn't ask for this link, you can ignore this email. No one can sign in without it.</p>
</body>
</html>`;
  return { to, subject, text, html };
}
