import { normaliseKitText } from "@/lib/context/keys";

// Sprint 10b, D-2 (decision 0029): a brand's own names, such as a parent
// brand's, may reach its briefs and ads even when the market notes name them.
// Any other company the notes name is still refused (rule 2's market exception).
// Pure: no database.

/** True when two names are the same, ignoring case and spacing (as the kit compares its lists). */
export function sameName(a: string, b: string): boolean {
  return normaliseKitText(a) === normaliseKitText(b);
}

/** True when `name` is the brand's name or one of its own names. "Brightwater Foods Group" is not "Brightwater". */
export function isOwnName(name: string, brand: { name: string; ownNames: readonly string[] }): boolean {
  return [brand.name, ...brand.ownNames].some((n) => sameName(n, name));
}

/** The market notes' names less the brand's name and its own names: the names a brief or ad may not use. */
export function refusableNames(realNames: string[], brand: { name: string; ownNames: readonly string[] }): string[] {
  return realNames.filter((n) => !isOwnName(n, brand));
}
