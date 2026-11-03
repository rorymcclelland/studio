// C8-2: the compliance rules sourced from the picture check, as pure functions
// (src/lib/compliance/rules.ts: faceRule, pictureDontRule, pictureFindings),
// and the stored record (src/lib/compliance/vision.ts). Test cases 3 (a face
// for a non-finance brand is not a finding) and 5 (a check that errored, hit
// the cap or never ran is Review with "The picture check didn't run: <reason>",
// never Pass), and Q4 (only the face rule fails on the model's word; a "no" on
// the don't rules is "No issues found by AI", not Pass).
import { describe, expect, it } from "vitest";
import { CHECKED_BY_AI, dontKey, faceRule, leftOutReason, NOT_CHECKED_YET, pictureDontRule, pictureFindings, judge, findingHash } from "@/lib/compliance/rules";
import { fitVision, jsonbBytes, jsonbText, readVision, VISION_MAX_BYTES, type VisionRecord } from "@/lib/compliance/vision";

const RULES = ["Use fear (storms, danger) to sell", "Show soft abstract shapes"];

function checked(over: Partial<Extract<VisionRecord, { status: "checked" }>> = {}): VisionRecord {
  return {
    status: "checked",
    checkedAt: "2026-11-03T10:00:00.000Z",
    runId: "00000000-0000-4000-8000-000000000001",
    stepId: "00000000-0000-4000-8000-000000000002",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    hasText: false,
    reason: "No text.",
    face: { present: false, closeUp: false },
    rules: RULES.map((r) => ({ key: dontKey(r), breaks: false, reason: "Nothing like it." })),
    ...over,
  };
}
const failed = (status: "error" | "cap", message: string): VisionRecord => ({ status, checkedAt: "2026-11-03T10:00:00.000Z", runId: "r", stepId: null, provider: null, model: null, message });

describe("C8-2 picture findings", () => {
  it("#3 a face for a non-finance brand is not a finding, even a close-up; for a finance brand a close-up fails, any other face passes", () => {
    const closeUp = checked({ face: { present: true, closeUp: true } });
    expect(faceRule(closeUp, false)).toBeNull();
    expect(pictureFindings(closeUp, false, RULES).map((f) => f.rule)).toEqual(["picture"]);
    expect(pictureFindings(closeUp, false, []).map((f) => f.rule)).toEqual([]);

    const fail = faceRule(closeUp, true)!;
    expect(fail).toMatchObject({ rule: "face", name: "Picture: face (finance brands)", status: "fail", size: null, lang: null, checkedBy: CHECKED_BY_AI, short: "a close-up face in the picture" });
    expect(fail.reason).toMatch(/found a face in close-up/);
    expect(fail.fix).toMatch(/New picture/);
    expect(leftOutReason([judge(fail, findingHash(fail, "x"), null)])).toBe("Fails: a close-up face in the picture.");
    expect(faceRule(checked({ face: { present: true, closeUp: false } }), true)).toMatchObject({ status: "pass", reason: "The AI check found a person, but no face in close-up." });
    expect(faceRule(checked(), true)).toMatchObject({ status: "pass", reason: "The AI check found no face in the picture.", checkedBy: CHECKED_BY_AI });
  });

  it("#5 a check that errored, hit the cap or never ran is Review with \"The picture check didn't run: <reason>\", never Pass", () => {
    const cases: [VisionRecord | null, RegExp][] = [
      [null, /^The picture check didn't run: the picture was made before Studio checked pictures/],
      [failed("error", "mock: Overloaded"), /^The picture check didn't run: mock: Overloaded\.$/],
      [failed("cap", "Daily AI cap reached: £1.00 spent of £1.00."), /^The picture check didn't run: Daily AI cap reached: £1\.00 spent of £1\.00\.$/],
    ];
    for (const [v, reason] of cases) {
      for (const f of [faceRule(v, true)!, pictureDontRule(v, RULES)!]) {
        expect(f.status, f.rule).toBe("review");
        expect(f.reason, f.rule).toMatch(reason);
        expect(f.fix).toBe("Use Check pictures on the campaign");
        expect(f.checkedBy).toBeUndefined();
      }
    }
    expect(pictureDontRule(null, RULES)!.reason).toBe(NOT_CHECKED_YET);
    // A record that can't be read counts as none (Review), never as a pass.
    expect(readVision({ status: "checked", hasText: false })).toBeNull();
    expect(readVision("yes")).toBeNull();
    expect(pictureDontRule(readVision({ status: "checked" }), RULES)!.status).toBe("review");
  });

  it("Q4: a \"yes\" on a don't rule is Review with the model's reason, never Fail; a \"no\" for every rule is \"No issues found by AI\"", () => {
    const yes = checked({ rules: [{ key: dontKey(RULES[0]), breaks: false, reason: "No." }, { key: dontKey(RULES[1]), breaks: true, reason: "The picture is soft abstract shapes." }] });
    const f = pictureDontRule(yes, RULES)!;
    expect(f).toMatchObject({ rule: "picture", name: "Picture: don't rules", status: "review", checkedBy: CHECKED_BY_AI });
    expect(f.reason).toBe('The AI check says the picture may break "Show soft abstract shapes": The picture is soft abstract shapes.');
    expect(f.fix).toMatch(/accept it if it keeps the rule, or use New picture/);
    expect(leftOutReason([judge(f, findingHash(f, "x"), null)])).toBe("Awaiting review: picture: don't rules.");

    const no = pictureDontRule(checked(), RULES)!;
    expect(no).toMatchObject({ status: "pass", reason: "No issues found by AI for the brand's 2 don't rules." });
    // The mock model's checks say so (rule 1).
    expect(pictureDontRule(checked({ provider: "mock", model: "mock-model" }), RULES)!.checkedBy).toBe(`${CHECKED_BY_AI} (simulated: the mock model)`);
    // A rule added after the check is named as not looked for; an edited rule is a new rule.
    const later = pictureDontRule(checked(), [...RULES, "Show money falling from the sky"])!;
    expect(later.status).toBe("pass");
    expect(later.reason).toBe(
      "No issues found by AI for the brand's 2 don't rules. The picture was checked before \"Show money falling from the sky\" was added, so the AI didn't look for it; the don't rule is still listed for a person.",
    );
    expect(pictureDontRule(checked(), [])).toBeNull();
  });

  it("the stored record fits the meta column: long reasons are cut so twenty rules always fit", () => {
    const many = checked({
      reason: "é".repeat(300),
      rules: Array.from({ length: 20 }, (_, i) => ({ key: dontKey(`rule ${i}`), breaks: i % 2 === 0, reason: "ü".repeat(300) })),
    });
    for (const budget of [VISION_MAX_BYTES, 2_500, 1_800]) {
      const fitted = fitVision(many, budget);
      // Review fix 6: measured as jsonb prints it (the meta column's limit), which is longer than compact JSON.
      expect(jsonbBytes(fitted), String(budget)).toBeLessThanOrEqual(budget);
      expect(readVision(fitted)).not.toBeNull();
      if (fitted.status === "checked") expect(fitted.rules.map((r) => r.breaks)).toEqual(many.status === "checked" ? many.rules.map((r) => r.breaks) : []);
    }
    const small = checked();
    expect(fitVision(small)).toEqual(small);
    expect(jsonbText({ a: [1, "x"], b: { c: null } })).toBe('{"a": [1, "x"], "b": {"c": null}}');
  });
});
