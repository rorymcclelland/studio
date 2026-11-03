import type { AdCompliance, ItemCompliance } from "@/lib/compliance/compute";
import type { Judged } from "@/lib/compliance/rules";
import { Pill, type PillTone } from "@/components/ui/pill";
import { formatWhen } from "@/lib/format";
import { DecisionForm } from "./decision-form";

// C8-1: the Compliance view of one ad. The brand's don't rules first (once
// for the whole ad, for a person to confirm), then every rule for every size
// and language, each with its status, the reason and a suggested fix. A
// review item has Accept and Not acceptable, recorded with the person's name
// and the time. Every word a person or the kit wrote (a don't rule, a note) is
// rendered as text, never as markup.

const OUTCOME: Record<Judged["outcome"] | "na", { label: string; tone: PillTone }> = {
  pass: { label: "Pass", tone: "good" },
  accepted: { label: "Accepted", tone: "good" },
  review: { label: "Review", tone: "review" },
  fail: { label: "Fail", tone: "attention" },
  na: { label: "Not applied", tone: "neutral" },
};

const statusOf = (f: Judged) => (f.status === "na" ? "na" : f.status === "review" && f.outcome === "fail" ? "fail" : f.outcome);
const labelOf = (f: Judged) => (f.status === "review" && f.outcome === "fail" ? "Not acceptable" : OUTCOME[statusOf(f)].label);

const LAYOUT: Record<string, string> = { "full-bleed": "Full bleed", split: "Split", card: "Card", banner: "Banner" };

export function ComplianceView({ ad, campaignId }: { ad: AdCompliance; campaignId: string }) {
  const langs = [...new Map(ad.items.map((i) => [i.lang, i.langName])).entries()];
  return (
    <div className="space-y-8">
      {ad.perAd.length > 0 && (
        <section aria-labelledby="whole-ad" className="space-y-3" data-compliance-ad="">
          <div>
            <h2 id="whole-ad" className="text-lg font-strong">
              The brand&apos;s don&apos;t rules
            </h2>
            <p className="mt-1 max-w-prose text-ink-2">
              No code can check these, so each is listed once for the whole ad, in every size and language, for a person to
              confirm. A redraw or new words make them new again.
            </p>
          </div>
          <ul className="space-y-3">
            {ad.perAd.map((f) => (
              <FindingRow key={f.key} f={f} ad={ad} campaignId={campaignId} />
            ))}
          </ul>
        </section>
      )}
      {langs.map(([lang, name]) => (
        <section key={lang} aria-labelledby={`lang-${lang}`} className="space-y-4" data-compliance-lang={lang}>
          <h2 id={`lang-${lang}`} className="text-lg font-strong">
            {name}
          </h2>
          <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {ad.items
              .filter((i) => i.lang === lang)
              .map((i) => (
                <SizeBlock key={i.size} item={i} ad={ad} campaignId={campaignId} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SizeBlock({ item, ad, campaignId }: { item: ItemCompliance; ad: AdCompliance; campaignId: string }) {
  const id = `size-${item.lang}-${item.size}`;
  return (
    <li aria-labelledby={id} className="min-w-0 space-y-3 rounded-card bg-surface p-4" data-compliance-size={item.size} data-outcome={item.refused ? "not drawn" : item.outcome}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 id={id} className="font-strong">
          {item.sizeName}
          <span className="sr-only">, {item.langName}</span>
        </h3>
        {item.layout && <span className="text-sm text-ink-2">{LAYOUT[item.layout]}</span>}
      </div>
      {item.refused ? (
        <p className="text-sm wrap-anywhere">
          <span className="font-semibold">Not drawn:</span> {item.refused}
        </p>
      ) : (
        <ul className="space-y-2">
          {item.findings.map((f) => (
            <FindingRow key={f.key} f={f} ad={ad} campaignId={campaignId} compact />
          ))}
        </ul>
      )}
    </li>
  );
}

function FindingRow({ f, ad, campaignId, compact = false }: { f: Judged; ad: AdCompliance; campaignId: string; compact?: boolean }) {
  const status = statusOf(f);
  const isDont = f.rule === "dont";
  return (
    <li className={compact ? "min-w-0 space-y-1 border-line pt-2 not-first:border-t" : "min-w-0 space-y-2 rounded-card bg-surface p-4"} data-rule={f.rule} data-key={f.key} data-status={status}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <Pill tone={OUTCOME[status].tone}>{labelOf(f)}</Pill>
        <span className="min-w-0 font-semibold wrap-anywhere" data-finding-title="">
          {isDont ? f.fix : f.name}
        </span>
      </div>
      <p className="text-sm text-ink-2 wrap-anywhere">{f.reason}</p>
      {!isDont && f.fix && f.status !== "pass" && f.status !== "na" && (
        <p className="text-sm wrap-anywhere" data-fix="">
          <span className="font-semibold">Suggested fix:</span> {f.fix}.
        </p>
      )}
      {f.decision && (
        <p className="text-sm wrap-anywhere" data-decision={f.decision.decision}>
          <span className="font-semibold">{f.decision.decision === "accept" ? "Accepted" : "Marked not acceptable"}</span> by {f.decision.decidedByName}, {formatWhen(f.decision.decidedAt)}.
          {f.decision.note && (
            <>
              {" "}
              <span className="font-semibold">Note:</span> <span data-decision-note="">{f.decision.note}</span>
            </>
          )}
        </p>
      )}
      {f.status === "review" && (
        <DecisionForm
          campaignId={campaignId}
          variantId={ad.variantId}
          lang={f.lang}
          size={f.size}
          rule={f.key}
          hash={f.hash}
          label={isDont ? `${f.name}: ${f.fix}` : `${f.name}${f.size ? ` at ${f.size}` : ""}${f.lang ? ` in ${f.lang}` : ""}`}
          decided={f.decision?.decision ?? null}
        />
      )}
    </li>
  );
}

/** The ad's pill: Passes, N to review, or Fails. */
export function CompliancePillView({ pill }: { pill: AdCompliance["pill"] }) {
  const tone: PillTone = pill.tone === "pass" ? "good" : pill.tone === "review" ? "review" : "attention";
  return (
    <Pill tone={tone} dot>
      {pill.label}
    </Pill>
  );
}
