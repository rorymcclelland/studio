import { Suspense } from "react";
import { requireMember } from "@/lib/auth/session";
import { TextLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/skeleton";
import { NewBrandForm } from "./new-brand-form";

export const metadata = { title: "New brand" };

async function NewBrandContent() {
  // Signed in only: the brand goes into the reader's own workspace (rule 7).
  await requireMember();
  return (
    <div className="space-y-6">
      <div>
        <TextLink href="/brands">
          <span aria-hidden>← </span>Back to brands
        </TextLink>
        <h1 className="mt-3 text-title font-strong">New brand</h1>
        <p className="mt-2 max-w-prose text-lg text-ink-2">
          Start with its name. You fill in its voice, colours, rules and legal lines in the kit editor next.
        </p>
      </div>
      <NewBrandForm />
    </div>
  );
}

export default function NewBrandPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the new brand form" />}>
      <NewBrandContent />
    </Suspense>
  );
}
