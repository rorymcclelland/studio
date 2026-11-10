"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill, type PillTone } from "@/components/ui/pill";

export type BrandCampaignRow = {
  id: string;
  title: string | null;
  objective: string;
  /** campaignStatusLabel() (U10-1). */
  status: string;
  tone: PillTone;
  /** When it was last updated, already formatted. */
  updated: string;
};

/** How many campaigns show before "Show all": the most recent, so the brand page opens short (U10-7). */
export const RECENT_CAMPAIGNS = 3;

/**
 * U10-7: the top of the brand page. The brand's campaigns, newest first, with
 * their status and objective, and "New campaign", which opens the form in
 * place (the form arrives as children, built by the page).
 */
export function BrandCampaigns({ brandName, rows, children }: { brandName: string; rows: BrandCampaignRow[]; children: React.ReactNode }) {
  const [formOpen, setFormOpen] = useState(false);
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, rows.length - RECENT_CAMPAIGNS);
  return (
    <Card as="section" aria-labelledby="campaigns" data-brand-campaigns="">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="campaigns" className="text-2xl font-strong tracking-tight">
          Campaigns
        </h2>
        <Button type="button" data-new-campaign="" aria-expanded={formOpen} aria-controls="brand-new-campaign" onClick={() => setFormOpen((o) => !o)}>
          New campaign
        </Button>
      </div>

      <div id="brand-new-campaign" hidden={!formOpen} className="mt-4 rounded-field border border-line p-4 sm:p-5">
        <h3 className="text-lg font-strong">New campaign for {brandName}</h3>
        <p className="mt-1 max-w-prose text-ink-2">
          The Brief agent reads this brand&apos;s context store and writes the brief. This usually takes under a minute.
        </p>
        {children}
      </div>

      {rows.length > 0 ? (
        <>
          <ul aria-label={`Campaigns for ${brandName}, newest first`} className="mt-4 overflow-hidden rounded-field border border-line" data-campaign-list="">
            {rows.map((c, i) => (
              <li key={c.id} data-brand-campaign={c.id} hidden={i >= rows.length - hidden} className="border-line not-first:border-t">
                <Link href={`/campaigns/${c.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {c.title ? (
                      <>
                        <span className="line-clamp-1 font-semibold wrap-anywhere">{c.title}</span>
                        <span className="line-clamp-1 text-sm text-ink-2 wrap-anywhere" data-campaign-objective="">
                          {c.objective}
                        </span>
                      </>
                    ) : (
                      <span className="line-clamp-2 font-semibold wrap-anywhere" data-campaign-objective="">
                        {c.objective}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <Pill tone={c.tone} dot>
                      <span data-campaign-status="">{c.status}</span>
                    </Pill>
                    <span className="text-sm text-ink-2 tabular-nums">
                      <span className="sr-only">Updated </span>
                      {c.updated}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {rows.length > RECENT_CAMPAIGNS && (
            <Button type="button" variant="quiet" size="sm" className="mt-3" aria-expanded={all} onClick={() => setAll((a) => !a)}>
              {all ? `Show the ${RECENT_CAMPAIGNS} most recent` : `Show all ${rows.length} campaigns`}
            </Button>
          )}
        </>
      ) : (
        <p className="mt-1 text-ink-2">No campaigns for {brandName} yet.</p>
      )}
    </Card>
  );
}
