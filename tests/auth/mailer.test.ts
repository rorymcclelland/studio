// N-3: the mailer (Resend in production, the console elsewhere) and the sign-in email.
import { afterEach, describe, expect, it, vi } from "vitest";
import { signInEmail } from "@/lib/auth/sign-in-email";
import { clearOutbox, consoleMailer, lastSignInLink, sentTo } from "@/lib/email/console";
import { getMailer, mailerKind } from "@/lib/email/mailer";
import { MailError, resendMailer } from "@/lib/email/resend";

const LINK = "https://studio.example.test/signin/link/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

describe("N-3 mailer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearOutbox();
  });

  it("production always uses Resend; previews, CI and local work use the console unless a key is set off Vercel", () => {
    expect(mailerKind({ VERCEL_ENV: "production" })).toBe("resend");
    expect(mailerKind({ VERCEL_ENV: "production", RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c" })).toBe("resend");
    expect(mailerKind({ VERCEL_ENV: "preview", RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c" })).toBe("console");
    expect(mailerKind({})).toBe("console");
    expect(mailerKind({ CI: "true" })).toBe("console");
    expect(mailerKind({ RESEND_API_KEY: "re_x" })).toBe("console");
    expect(mailerKind({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c" })).toBe("resend");
    expect(getMailer({}).kind).toBe("console");
  });

  it("Resend: one POST to its emails API with the key as a bearer token, and plain text and HTML", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    const m = resendMailer("re_secret_key", "Studio <sign-in@studio.example.test>", fetchImpl as unknown as typeof fetch);
    await m.send(signInEmail("rory@example.test", LINK, 15));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_secret_key");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "Studio <sign-in@studio.example.test>", to: ["rory@example.test"], subject: "Your sign-in link for Studio" });
    expect(body.text).toContain(LINK);
    expect(body.html).toContain(LINK);
  });

  it("Resend failure: a refused send throws without the key; a missing key or sender throws before any request", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"The domain is not verified"}', { status: 403 }));
    const m = resendMailer("re_secret_key", "a@b.c", fetchImpl as unknown as typeof fetch);
    const err = await m.send(signInEmail("x@example.test", LINK, 15)).catch((e) => e);
    expect(err).toBeInstanceOf(MailError);
    expect(err.message).toMatch(/HTTP 403/);
    expect(err.message).toMatch(/not verified/);
    expect(err.message).not.toContain("re_secret_key");

    const never = vi.fn();
    await expect(resendMailer(undefined, "a@b.c", never as unknown as typeof fetch).send(signInEmail("x@example.test", LINK, 15))).rejects.toThrow(/RESEND_API_KEY is not set/);
    await expect(resendMailer("re_x", undefined, never as unknown as typeof fetch).send(signInEmail("x@example.test", LINK, 15))).rejects.toThrow(/EMAIL_FROM is not set/);
    expect(never).not.toHaveBeenCalled();
  });

  it("console: writes the link to the server log and keeps it in memory for tests", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleMailer().send(signInEmail("dev@example.test", LINK, 15));
    expect(log.mock.calls[0][0]).toContain(LINK);
    expect(log.mock.calls[0][0]).toContain("dev@example.test");
    expect(sentTo("DEV@example.test")).toHaveLength(1);
    expect(lastSignInLink("dev@example.test")).toEqual({ link: LINK, count: 1 });
    expect(lastSignInLink("someone-else@example.test")).toBeNull();
  });

  it("the email says what Studio is, that the link works once and lasts 15 minutes, in British English with no em dashes", () => {
    const e = signInEmail("rory@example.test", LINK, 15);
    for (const part of [e.text, e.html]) {
      expect(part).toContain("multi-agent campaign studio");
      expect(part).toContain("works once");
      expect(part).toContain("15 minutes");
      expect(part).toContain("fictional brands");
      expect(part).not.toContain(String.fromCharCode(0x2014)); // no em dash
    }
    expect(e.html).toContain('lang="en-GB"');
  });

  it("hostile: a link with markup is escaped in the HTML", () => {
    const e = signInEmail("rory@example.test", 'https://x.test/"><script>alert(1)</script>', 15);
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
  });
});
