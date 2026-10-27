import { createHash, randomBytes } from "node:crypto";

// Session, sign-in link and invite tokens: 32 random bytes, base64url (43
// characters). Only the SHA-256 of a token is ever stored (rule 6).

export const newToken = (): string => randomBytes(32).toString("base64url");

export const hashToken = (t: string): string => createHash("sha256").update(t, "utf8").digest("hex");

/** True for something shaped like a token newToken() made; anything else is refused before the database. */
export const isTokenShaped = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);
