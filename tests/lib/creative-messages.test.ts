import { describe, expect, it } from "vitest";
import { discardDoneMessage } from "@/lib/creative/messages";

describe("review nit: the message after discarding words", () => {
  it("says which words were kept", () => {
    expect(discardDoneMessage("discard")).toBe("Words discarded. Restore them under Discarded.");
    expect(discardDoneMessage("keep-new")).toBe("New words kept. The old ones are under Discarded.");
    expect(discardDoneMessage("keep-old")).toBe("Old words kept. The new ones are under Discarded.");
  });

  it("falls back to the plain message for anything else, including names on Object.prototype", () => {
    // A server action's argument comes from the browser, so it can be anything.
    for (const why of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "", "nonsense", undefined, null, 3, {}]) {
      expect(discardDoneMessage(why), String(why)).toBe("Words discarded. Restore them under Discarded.");
    }
  });
});
