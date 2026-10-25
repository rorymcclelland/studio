import Link from "next/link";
import type { CampaignSummary } from "@/lib/brief/repo";
import { cx } from "@/components/ui/cx";
import { Pill } from "@/components/ui/pill";
import { formatWhen } from "@/lib/format";

/** What a campaign's status says in lists: still drafting, or the draft version it is on. */
export function campaignStatus(c: { status: string; currentVersion: number }): string {
  return c.status === "drafting" || c.currentVersion === 0 ? "Writing the brief" : `Draft v${c.currentVersion}`;
}

/** Campaigns, newest first. On a brand page the brand name is left out. */
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
      {campaigns.map((c) => (
        <li key={c.id} className="border-line not-first:border-t">
          <Link
            href={`/campaigns/${c.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 hover:bg-surface-2 sm:px-6"
          >
            <span className="flex min-w-0 basis-full flex-col sm:flex-1 sm:basis-auto">
              <span className="font-semibold wrap-anywhere">{c.title ?? c.objective}</span>
              {showBrand && <span className="text-sm text-ink-2 wrap-anywhere">{c.brand.name}</span>}
            </span>
            <Pill tone={c.currentVersion === 0 ? "active" : "neutral"} dot>
              {campaignStatus(c)}
            </Pill>
            <span className="ml-auto text-sm text-ink-2 tabular-nums">
              <span className="sr-only">Updated </span>
              {formatWhen(c.updatedAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
