import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/repo";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { AddDemoBrands, DemoBrandsProvider } from "./add-demo-brands";
import { BrandLogo } from "./brand-logo";

export const metadata = { title: "Brands" };

// Loading the demo brands writes about 29,000 rows in one transaction. Its
// server action runs under this page's limit (S2-4 #6; review finding 2).
export const maxDuration = 60;

async function BrandsPageContent() {
  const member = await requireMember();
  const brands = await listBrands(member.userId, member.workspaceId);
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-title font-strong">Brands</h1>
        <p className="mt-2 max-w-prose text-lg text-ink-2">
          Each brand&apos;s kit is what keeps every agent on-brand: its voice, colours, rules and legal lines, with its
          products and customers.
        </p>
      </div>

      {brands.length === 0 ? (
        <EmptyState title="No brands yet" headingLevel={2} action={<AddDemoBrands />}>
          Add the two fictional demo brands to try Studio: an outdoor clothing brand and a personal finance app, each
          with a full brand kit, about 20 products and 2,000 simulated customers with two years of orders.
        </EmptyState>
      ) : (
        <>
          <ul className="grid gap-4 md:grid-cols-2" aria-label="Brands in this workspace">
            {brands.map((b) => (
              <li key={b.id} className="min-w-0">
                <Link
                  href={`/brands/${b.id}`}
                  className="flex h-full min-w-0 flex-col gap-4 rounded-card border-2 border-transparent bg-surface p-5 transition-colors hover:border-primary-soft sm:p-6"
                >
                  <BrandLogo name={b.name} svg={b.logoSvg} decorative className="h-12 w-auto max-w-60 self-start" />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="min-w-0 text-xl font-strong tracking-tight wrap-anywhere">{b.name}</span>
                      {b.isSimulated && <Pill tone="review">Simulated data</Pill>}
                    </span>
                    {b.category && <span className="text-ink-2 wrap-anywhere">{b.category}</span>}
                  </span>
                  {b.description && <span className="line-clamp-2 text-sm text-ink-2 wrap-anywhere">{b.description}</span>}
                </Link>
              </li>
            ))}
          </ul>

          <Card as="section" aria-labelledby="demo" className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 id="demo" className="font-semibold">
                Demo brands
              </h2>
              <p className="mt-1 max-w-prose text-sm text-ink-2">
                Two fictional brands with simulated customers and orders, for trying Studio. They are added once per
                workspace.
              </p>
            </div>
            <AddDemoBrands variant="quiet" />
          </Card>
        </>
      )}
    </div>
  );
}

export default function BrandsPage() {
  // The provider sits outside the content, which swaps its empty state for the
  // list when the demo brands arrive, so the action's result survives the swap.
  return (
    <DemoBrandsProvider>
      <Suspense fallback={<PageSkeleton label="Loading brands" />}>
        <BrandsPageContent />
      </Suspense>
    </DemoBrandsProvider>
  );
}
