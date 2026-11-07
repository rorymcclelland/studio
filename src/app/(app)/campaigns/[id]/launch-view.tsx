// P9-1: the pieces of the Launch (simulated) panel and the inbox's launch
// card that show a launch, without hooks, so they render anywhere (and in
// tests). Every figure is simulated and says so (rule 1). Words people wrote,
// such as a refusal's reason, are shown as text: React escapes them.
import { formatDay } from "@/components/format-day";
import { formatWhen } from "@/lib/format";
import { LANG_NAMES } from "@/lib/creative/languages";
import type { LaunchAdView } from "@/lib/performance/launch";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "English and German", "English, French and German". */
export function languageList(langs: string[]): string {
  const names = langs.map((l) => LANG_NAMES[l as keyof typeof LANG_NAMES] ?? l);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A start date for people: "6 November 2026". */
export function startDay(startsOn: string): string {
  return formatDay(`${startsOn}T12:00:00Z`);
}

/** The ads a launch holds (or would hold), each with its sizes and languages. */
export function LaunchAdList({ ads, label }: { ads: LaunchAdView[]; label: string }) {
  return (
    <ul aria-label={label} className="space-y-1.5 text-sm">
      {ads.map((a) => (
        <li key={a.variantId} data-launch-ad="" className="wrap-anywhere">
          <span className="font-semibold">{a.adNumber > 0 ? `Ad ${a.adNumber}` : "An ad no longer in the gallery"}</span>
          {a.headline && <>: &ldquo;{a.headline}&rdquo;</>}{" "}
          <span className="text-ink-2">
            ({plural(a.sizes.length, "size")} in {languageList(a.langs)})
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A refused (or expired) launch request: who refused it, when, and why, as plain text. */
export function LaunchRefusal({ reason, by, at, expired = false }: { reason: string; by: string | null; at: Date | null; expired?: boolean }) {
  const when = at ? formatWhen(at) : null;
  return (
    <p className="max-w-prose rounded-field bg-attention-soft px-4 py-3 text-attention-ink wrap-anywhere" data-launch-refusal="">
      <span className="font-semibold">
        {expired ? "Closed" : `Refused by ${by ?? "a member of this workspace"}`}
        {when ? `, ${when}` : ""}:
      </span>{" "}
      {reason}
    </p>
  );
}
