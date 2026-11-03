import { dontKey } from "@/lib/compliance/rules";
import type { VisionRecord } from "@/lib/compliance/vision";

/**
 * C8-2: a picture-check result as the mock model writes it, for test pictures
 * stored straight into the database: no text, no face, and none of `rules`
 * broken. Without one, a picture's ads show the picture items as Review ("The
 * picture check didn't run"), as a picture made before Sprint 8 does.
 */
export function checkedVision(rules: string[] = []): VisionRecord {
  return {
    status: "checked",
    checkedAt: "2026-11-03T09:00:00.000Z",
    runId: "00000000-0000-4000-8000-00000000c082",
    stepId: null,
    provider: "mock",
    model: "mock-model",
    hasText: false,
    reason: "Simulated check: no letters, numbers or marks were found.",
    face: { present: false, closeUp: false },
    rules: rules.map((r) => ({ key: dontKey(r), breaks: false, reason: "Simulated check: nothing in the picture goes against this rule." })),
  };
}
