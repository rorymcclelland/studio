import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getBrand } from "@/lib/brands/repo";
import { getCustomerSummary } from "@/lib/brands/summary";
import { brandTabHref } from "@/lib/brands/tabs";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { PROFILE_LIMITS } from "@/lib/demo/profile";
import { HAS_CUSTOMERS } from "@/lib/demo/simulated";
import { SimulatedDataForm } from "./simulated-data-form";

export const metadata = { title: "Generate simulated data" };

// Up to 20,000 customers and their orders in one transaction; the action runs under this page's limit.
export const maxDuration = 60;

async function SimulatedDataContent(props: PageProps<"/brands/[id]/simulated-data">) {
  const { id } = await props.params;
  const member = await requireMember();
  const brand = await getBrand(member.userId, id);
  if (!brand) notFound();
  const summary = await getCustomerSummary(member.userId, brand.id);
  const hasCustomers = !!summary && summary.customers > 0;

  return (
    <div className="space-y-6">
      <div>
        <TextLink href={brandTabHref(brand.id, "products")}>
          <span aria-hidden>← </span>Back to {brand.name}
        </TextLink>
        <h1 className="mt-3 text-title font-strong">Generate simulated data</h1>
        <p className="mt-2 max-w-prose text-lg text-ink-2 wrap-anywhere">
          {brand.name}. Describe the products and customers in a few lines, and Studio makes two years of simulated customers and
          orders from them, so the Audience agent can size segments and the brief can cite them. No AI is used.
        </p>
      </div>
      {hasCustomers ? (
        <Card>
          <p className="font-medium">{HAS_CUSTOMERS}</p>
        </Card>
      ) : (
        <>
          <p className="max-w-prose text-ink-2">
            Everything made here is labelled as simulated data wherever it is shown: these are not real people or sales.
          </p>
          <SimulatedDataForm brandId={brand.id} limits={PROFILE_LIMITS} />
        </>
      )}
    </div>
  );
}

export default function SimulatedDataPage(props: PageProps<"/brands/[id]/simulated-data">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the simulated data form" />}>
      <SimulatedDataContent {...props} />
    </Suspense>
  );
}
