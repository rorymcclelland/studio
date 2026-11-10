import Link from "next/link";
import type { CampaignSummary } from "@/lib/brief/repo";
import { cx } from "@/components/ui/cx";
import { Pill, type PillTone } from "@/components/ui/pill";
import { CAMPAIGN_STATUS_LABELS, campaignStatusLabel } from "@/lib/campaigns/status";
import { formatWhen } from "@/lib/format";

const L = CAMPAIGN_STATUS_LABELS;

/** The pill's colour only supports the words (U10-1): running, waiting for a person, being written, or none of these. */
export function statusTone(label: string): PillTone {
  if (label.startsWith("Live")) return "good";
  if (label === L.waiting || label === L.launchWaiting) return "review";
  if (label === L.writing) return "active";
  return "neutral";
}

/** Campaigns, newest first, each with the status a person would act on (U10-1). On a brand page the brand name is left out. */
export function CampaignList({
  campaigns,
  showBrand = true,
  label,
  className,
}: {
  campaigns: CampaignSummary[];
  showBrand?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <ul aria-label={label} className={cx("overflow-hidden bg-surface", className ?? "rounded-card")} data-campaign-list="">
      {campaigns.map((c) => {
        const status = campaignStatusLabel(c);
        return (
          <li key={c.id} className="border-line not-first:border-t" data-campaign-row={c.id}>
            <Link
              href={`/campaigns/${c.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 hover:bg-surface-2 sm:px-6"
            >
              <span className="flex min-w-0 basis-full flex-col sm:flex-1 sm:basis-auto">
                <span className="font-semibold wrap-anywhere">{c.title ?? c.objective}</span>
                {showBrand && <span className="text-sm text-ink-2 wrap-anywhere">{c.brand.name}</span>}
              </span>
              <Pill tone={statusTone(status)} dot>
                <span data-campaign-status="">{status}</span>
              </Pill>
              <span className="ml-auto text-sm text-ink-2 tabular-nums">
                <span className="sr-only">Updated </span>
                {formatWhen(c.updatedAt)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
