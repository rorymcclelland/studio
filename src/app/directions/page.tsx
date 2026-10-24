import Link from "next/link";

export const metadata = { title: "Design directions" };

const DIRECTIONS = [
  {
    href: "/directions/press-check",
    name: "A. Press check",
    line: "A print studio's proofing desk: a white sheet on a light table, crop marks, colour bars and sign-off stamps.",
    type: "Fraunces for headlines, Instrument Sans for everything else",
    fits: "Feels like craft and judgement. Strongest on the Creative screens; calmest for approvals.",
    risk: "The print metaphor has to stretch to cover live performance data.",
  },
  {
    href: "/directions/control-desk",
    name: "B. Control desk",
    line: "A broadcast gallery at dusk: dense panels, condensed type, status lights and a rundown of every variant by day.",
    type: "IBM Plex Sans Condensed throughout, with tabular figures",
    fits: "Makes the self-healing loop visible at a glance. Strongest on the Performance screens.",
    risk: "Dense by design; less welcoming for a first-time marketing user.",
  },
  {
    href: "/directions/soft-machine",
    name: "C. Soft machine",
    line: "Calm and light: one plain sentence says how things are, a health ring shows every live variant, and soft forms do the rest.",
    type: "Figtree throughout",
    fits: "The most approachable. Reads like a product a CMO would open on a phone.",
    risk: "Carries less detail per screen; analysts may want more density.",
  },
];

export default function DirectionsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="text-sm text-accent">Back to the app</Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Three design directions</h1>
      <p className="mt-3 max-w-prose text-ink-2">
        Each prototype shows the same two screens with the same sample data: the campaign home and the creative
        review. Click through both, switch the theme, approve or send back a change. Pick one, or a blend, and
        Sprint 2 builds the design system from it. The brand and every figure are invented for the prototypes.
      </p>
      <ul className="mt-8 space-y-4">
        {DIRECTIONS.map((d) => (
          <li key={d.href}>
            <Link href={d.href} className="block rounded-lg border border-line bg-surface p-5 hover:border-accent">
              <h2 className="text-xl font-semibold">{d.name}</h2>
              <p className="mt-1">{d.line}</p>
              <dl className="mt-3 grid gap-1 text-sm text-ink-2 sm:grid-cols-[7rem_1fr]">
                <dt className="font-medium text-ink">Type</dt>
                <dd>{d.type}</dd>
                <dt className="font-medium text-ink">Where it shines</dt>
                <dd>{d.fits}</dd>
                <dt className="font-medium text-ink">Watch out for</dt>
                <dd>{d.risk}</dd>
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
