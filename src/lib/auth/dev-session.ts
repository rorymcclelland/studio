import { createHmac, timingSafeEqual } from "node:crypto";

// Local development sign-in (AUTH_MODE=dev): a signed cookie naming a user.
// configProblems() refuses this mode on Vercel.

export const DEV_COOKIE = "cs_dev_session";

function sign(payload: string): string {
  const secret = process.env.SESSION_SECRET ?? "";
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeDevSession(userId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, email })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeDevSession(value: string | undefined): { userId: string; email: string } | null {
  if (!value) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.userId === "string" && typeof data.email === "string") return data;
  } catch {
    // fall through
  }
  return null;
}
