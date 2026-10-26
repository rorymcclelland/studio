// Messages for the Creative section's actions that depend on an argument from
// the browser. Kept out of the "use server" file so they can be tested.

const DISCARD_DONE = {
  discard: "Words discarded. Restore them under Discarded.",
  "keep-new": "New words kept. The old ones are under Discarded.",
  "keep-old": "Old words kept. The new ones are under Discarded.",
} as const;

export type DiscardWhy = keyof typeof DISCARD_DONE;

/**
 * What to say after a set is discarded. `why` comes from the browser, so only
 * the object's own keys count: a plain lookup of "constructor" would return a
 * function (review nit).
 */
export function discardDoneMessage(why: unknown): string {
  return typeof why === "string" && Object.hasOwn(DISCARD_DONE, why) ? DISCARD_DONE[why as DiscardWhy] : DISCARD_DONE.discard;
}
