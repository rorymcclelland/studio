// S1-3 #5 (allow-list), S1-1 #4 (configuration errors), N-7 #2 (production names a missing Resend key).
import { describe, expect, it } from "vitest";
import { configProblems, isEmailAllowed } from "@/lib/env";

const BASE = { DATABASE_URL: "postgres://x", ALLOWED_EMAILS: "a@b.c", MODEL_PROVIDER_OVERRIDE: "mock" };

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

  it("S1-1 #4: missing configuration is listed by name, not a blank page", () => {
    const problems = configProblems({ MODEL_PROVIDER_OVERRIDE: "" });
    expect(problems.join("\n")).toMatch(/DATABASE_URL/);
    expect(problems.join("\n")).toMatch(/ALLOWED_EMAILS/);
    expect(problems.join("\n")).toMatch(/ANTHROPIC_API_KEY/);
    // Locally, sign-in needs nothing more: links go to the console mailer.
    expect(configProblems(BASE)).toEqual([]);
  });

  it("N-2: Supabase's variables are no longer needed or read, and dev auth mode has gone", () => {
    const text = configProblems(BASE).join("\n");
    expect(text).not.toMatch(/SUPABASE|SESSION_SECRET|AUTH_MODE/);
    // A leftover AUTH_MODE=dev changes nothing.
    expect(configProblems({ ...BASE, AUTH_MODE: "dev" })).toEqual([]);
  });

  it("N-3 and N-7 #2: production names a missing RESEND_API_KEY or EMAIL_FROM; previews need neither", () => {
    const prod = { ...BASE, VERCEL: "1", VERCEL_ENV: "production", INNGEST_DEV: "1" };
    const text = configProblems(prod).join("\n");
    expect(text).toMatch(/RESEND_API_KEY is not set/);
    expect(text).toMatch(/EMAIL_FROM is not set/);
    expect(configProblems({ ...prod, RESEND_API_KEY: "re_test", EMAIL_FROM: "Studio <sign-in@studio.example.test>" })).toEqual([]);
    expect(configProblems({ ...prod, VERCEL_ENV: "preview" })).toEqual([]);
  });
});
