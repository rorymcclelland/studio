import Link from "next/link";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";

export const metadata = { title: "Design direction" };

// Sprint 1 built three directions; Soft machine was chosen (decision 0006)
// and the other two were removed in Sprint 2 (F-6). This one stays as the
// reference for the design system until Sprint 3.
const DIRECTION = {
  href: "/directions/soft-machine",
  name: "Soft machine",
  line: "Calm and light: one plain sentence says how things are, a health ring shows every live variant, and soft forms do the rest.",
  type: "Figtree throughout",
  fits: "The most approachable. Reads like a product a marketing lead would open on a phone.",
  risk: "Carries less detail per screen; analysts may want more density.",
};

export default function DirectionsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <TextLink href="/">
        <span aria-hidden>← </span>Back to the app
      </TextLink>
      <h1 className="mt-4 text-title font-strong">The design direction</h1>
      <p className="mt-3 max-w-prose text-lg text-ink-2">
        Studio uses Soft machine (decision 0006). The Sprint 1 prototype stays here as the reference for the design
        system: two screens with sample data for an invented brand. The other two directions were retired in Sprint 2.
      </p>
      <Link href={DIRECTION.href} className="mt-8 block rounded-card">
        <Card className="transition-colors hover:border-primary-soft">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-strong">{DIRECTION.name}</h2>
            <Pill tone="good">Chosen</Pill>
            <Pill tone="review">Sample data</Pill>
          </div>
          <p className="mt-2">{DIRECTION.line}</p>
          <dl className="mt-4 grid gap-x-4 gap-y-1 text-sm text-ink-2 sm:grid-cols-[8rem_1fr]">
            <dt className="font-semibold text-ink">Type</dt>
            <dd>{DIRECTION.type}</dd>
            <dt className="font-semibold text-ink">Where it shines</dt>
            <dd>{DIRECTION.fits}</dd>
            <dt className="font-semibold text-ink">Watch out for</dt>
            <dd>{DIRECTION.risk}</dd>
          </dl>
        </Card>
      </Link>
    </main>
  );
}
