// Sprint 10b, D-1 New brand: the pure parts. The short name is filled in from
// the name (slugFromName), and the New brand form's fields are checked with the
// kit's own rules and words (parseNewBrand). The interface is in the header of
// tests/e2e/new-brand.spec.ts; the database parts are tests/db/new-brand.test.ts.
import { describe, expect, it } from "vitest";
import { parseNewBrand, slugFromName } from "@/lib/brands/schema";
import { BRIGHTWATER, HOSTILE_BRAND_NAME } from "../fixtures/new-brand";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("D-1 the New brand form's rules", () => {
  it("D-1 #1 the short name is filled in from the name", () => {
    expect(slugFromName(BRIGHTWATER.name)).toBe(BRIGHTWATER.slug);
    expect(slugFromName("  Brightwater   Kitchen  ")).toBe("brightwater-kitchen");
    expect(slugFromName("Café Brightwater & Co.")).toBe("cafe-brightwater-co");
    expect(slugFromName("Brightwater 2")).toBe("brightwater-2");
    expect(slugFromName("!!!")).toBe("");
    expect(slugFromName("")).toBe("");
    // At most 40 characters, never ending in a hyphen.
    const long = slugFromName("Brightwater Kitchen and Pantry for Weeknight Cooks Everywhere");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toMatch(SLUG);
    expect(long.startsWith("brightwater-kitchen")).toBe(true);
    // Markup and SQL leave only letters, numbers and single hyphens.
    const hostile = slugFromName(HOSTILE_BRAND_NAME);
    expect(hostile).toMatch(SLUG);
    expect(hostile.length).toBeLessThanOrEqual(40);
  });

  it("D-1 #1 a name with a category, short name and description passes, trimmed", () => {
    const r = parseNewBrand({ name: ` ${BRIGHTWATER.name} `, slug: BRIGHTWATER.slug, category: BRIGHTWATER.category, description: BRIGHTWATER.description });
    expect(r).toEqual({ ok: true, data: { name: BRIGHTWATER.name, slug: BRIGHTWATER.slug, category: BRIGHTWATER.category, description: BRIGHTWATER.description } });
    // Category and description are optional.
    expect(parseNewBrand({ name: BRIGHTWATER.name, slug: BRIGHTWATER.slug })).toEqual({ ok: true, data: { name: BRIGHTWATER.name, slug: BRIGHTWATER.slug, category: "", description: "" } });
  });

  it("D-1 #3 an empty name, and a name of 81 characters, are refused with the field's words; 80 is fine", () => {
    expect(parseNewBrand({ name: "", slug: "empty" })).toMatchObject({ ok: false, fieldErrors: { name: "Give the brand a name." } });
    expect(parseNewBrand({ name: "   ", slug: "spaces" })).toMatchObject({ ok: false, fieldErrors: { name: "Give the brand a name." } });
    const long = `Brightwater ${"k".repeat(69)}`;
    expect(long).toHaveLength(81);
    expect(parseNewBrand({ name: long, slug: "long" })).toMatchObject({ ok: false, fieldErrors: { name: "Name must be 80 characters or fewer." } });
    expect(parseNewBrand({ name: long.slice(0, 80), slug: "long" })).toMatchObject({ ok: true });
    // A bad short name is said beside its own field.
    expect(parseNewBrand({ name: BRIGHTWATER.name, slug: "Not A Slug" })).toMatchObject({
      ok: false,
      fieldErrors: { slug: "Use lower-case letters, numbers and hyphens, such as fern-hollow." },
    });
  });

  it("D-1 #4 a name with markup and SQL passes as text, unchanged", () => {
    const r = parseNewBrand({ name: HOSTILE_BRAND_NAME, slug: slugFromName(HOSTILE_BRAND_NAME) });
    expect(r).toMatchObject({ ok: true, data: { name: HOSTILE_BRAND_NAME } });
  });
});
