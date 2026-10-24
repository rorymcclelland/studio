// S1-3 #5 (allow-list), S1-1 #4 (configuration errors), dev session signing.
import { describe, expect, it } from "vitest";
import { configProblems, isEmailAllowed } from "@/lib/env";
import { decodeDevSession, encodeDevSession } from "@/lib/auth/dev-session";

describe("access", () => {
  it("S1-3 #5: only allow-listed emails may sign in, case and spaces ignored", () => {
    const list = ["rory@example.test"];
    expect(isEmailAllowed("rory@example.test", list)).toBe(true);
    expect(isEmailAllowed("  Rory@Example.TEST ", list)).toBe(true);
    expect(isEmailAllowed("someone@example.test", list)).toBe(false);
    expect(isEmailAllowed("rory@example.test.evil.com", list)).toBe(false);
    expect(isEmailAllowed("", list)).toBe(false);
    expect(isEmailAllowed(null, list)).toBe(false);
    expect(isEmailAllowed("rory@example.test", [])).toBe(false);
  });

  it("dev sessions are signed: tampering or the wrong secret is refused", () => {
    process.env.SESSION_SECRET = "a".repeat(32);
    const v = encodeDevSession("00000000-0000-4000-8000-000000000001", "dev@example.test");
    expect(decodeDevSession(v)).toEqual({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "dev@example.test",
    });
    const [payload, mac] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "x", email: "dev@example.test" })).toString("base64url");
    expect(decodeDevSession(`${forged}.${mac}`)).toBeNull();
    expect(decodeDevSession(`${payload}.AAAA`)).toBeNull();
    expect(decodeDevSession("garbage")).toBeNull();
    process.env.SESSION_SECRET = "b".repeat(32);
    expect(decodeDevSession(v)).toBeNull();
  });

  it("S1-1 #4: missing configuration is listed by name, not a blank page", () => {
    const problems = configProblems({ MODEL_PROVIDER_OVERRIDE: "" });
    expect(problems.join("\n")).toMatch(/DATABASE_URL/);
    expect(problems.join("\n")).toMatch(/ALLOWED_EMAILS/);
    expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(problems.join("\n")).toMatch(/ANTHROPIC_API_KEY/);
    const ok = configProblems({
      DATABASE_URL: "postgres://x",
      ALLOWED_EMAILS: "a@b.c",
      AUTH_MODE: "dev",
      SESSION_SECRET: "s".repeat(32),
      MODEL_PROVIDER_OVERRIDE: "mock",
    });
    expect(ok).toEqual([]);
  });

  it("dev auth mode is refused on Vercel", () => {
    const problems = configProblems({
      DATABASE_URL: "postgres://x",
      ALLOWED_EMAILS: "a@b.c",
      AUTH_MODE: "dev",
      SESSION_SECRET: "s".repeat(32),
      MODEL_PROVIDER_OVERRIDE: "mock",
      VERCEL: "1",
      INNGEST_DEV: "1",
    });
    expect(problems.join("\n")).toMatch(/refused on Vercel/);
  });
});
