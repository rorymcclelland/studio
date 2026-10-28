// Sprint 6 review: the e2e mailbox route (GET /api/dev/last-sign-in-link) is
// not found on any Vercel deployment, however Vercel says so, and answers
// only locally with the console mailer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

const { NextRequest } = await import("next/server");
const { GET } = await import("@/app/api/dev/last-sign-in-link/route");
const { clearOutbox, consoleMailer } = await import("@/lib/email/console");

const LINK = "http://localhost:3000/signin/link/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const ask = () => GET(new NextRequest("http://localhost:3000/api/dev/last-sign-in-link?email=Someone@Example.test"));

describe("GET /api/dev/last-sign-in-link", () => {
  beforeEach(async () => {
    for (const name of ["VERCEL", "VERCEL_ENV", "RESEND_API_KEY", "EMAIL_FROM"]) vi.stubEnv(name, "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleMailer().send({ to: "someone@example.test", subject: "Your sign-in link for Studio", text: `Open ${LINK}`, html: "" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearOutbox();
  });

  it("answers locally with the newest link and a count", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ link: LINK, count: 1 });
  });

  for (const [name, value] of [["VERCEL", "1"], ["VERCEL_ENV", "preview"], ["VERCEL_ENV", "production"]] as const) {
    it(`is not found when ${name}=${value}`, async () => {
      vi.stubEnv(name, value);
      const res = await ask();
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("signin/link");
    });
  }

  it("is not found locally when the mailer is Resend, not the console", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Studio <sign-in@example.test>");
    expect((await ask()).status).toBe(404);
  });
});
