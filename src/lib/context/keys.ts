import { createHash } from "node:crypto";

// Stable keys for kit text (F-11). A rule's key comes from its own text, so
// deleting or reordering one rule never changes another rule's key. The same
// normalisation runs in SQL (public.kit_text_key, migration 20261026000001).
// Case folding and whitespace are ASCII-only, so neither side depends on a
// locale or collation.

/** Trimmed, runs of ASCII whitespace collapsed to one space, ASCII lower case. */
export function normaliseKitText(s: string): string {
  return s.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, "").replace(/[ \t\r\n\f\v]+/g, " ").replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function textKey(s: string): string {
  return createHash("md5").update(normaliseKitText(s), "utf8").digest("hex").slice(0, 12);
}
