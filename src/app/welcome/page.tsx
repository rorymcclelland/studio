import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Wordmark } from "@/components/ui/wordmark";

// F-3: the public page at / for anyone without a session (src/proxy.ts
// rewrites / here). Static: it reads no session and shows no app data, no
// screenshots, no figures and no testimonials (rule 1).

export const metadata: Metadata = {
  title: "A multi-agent campaign studio",
  description: "Strategy agents turn a campaign objective into an evidenced brief; synthetic personas critique it; a person signs it off.",
};

const STEPS = [
  {
    title: "Market notes from the web",
    text: "The Market agent searches the web about the brand's category and writes short notes on trends, timing, rivals and gaps. Every note links to the pages it rests on and says when they were checked.",
  },
  {
    title: "An evidenced brief",
    text: "The Brief agent turns an objective into a brief that cites the shared Business Context store: segments, insights, products and market notes. Code checks that every citation is real and every figure is in its source.",
  },
  {
    title: "Personas and a test plan",
    text: "Synthetic personas, built from the brand's segments and labelled as synthetic, score the brief and say what puts them off. A test plan turns the brief into hypotheses and cells to test.",
  },
  {
    title: "A person signs it off",
    text: "The brief waits in an approvals inbox until someone approves a specific version. Agents propose; people approve anything that spends, publishes or replaces creative.",
  },
];

export default function WelcomePage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 pt-5 pb-2 sm:px-8">
        <Wordmark />
        <ButtonLink href="/signin" variant="quiet" size="sm">
          Sign in
        </ButtonLink>
      </header>
      <main id="main" className="mx-auto max-w-5xl space-y-10 px-4 pt-6 pb-16 sm:px-8">
        <Card size="hero">
          <p className="flex flex-wrap gap-2">
            <Pill tone="review">Fictional brands</Pill>
            <Pill tone="review">Simulated data</Pill>
          </p>
          <h1 className="mt-4 max-w-3xl text-display font-strong">A multi-agent campaign studio for marketing teams</h1>
          <p className="mt-4 max-w-prose text-lg text-ink-2">
            Three squads of AI agents share one store of business context. The Strategy squad takes a campaign from an
            objective to a signed-off brief and test plan, and the Creative squad turns that brief into ads; the Performance
            squad comes next. A person approves every consequential move.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <ButtonLink href="/signin" size="lg">
              Sign in
            </ButtonLink>
            <p className="text-ink-2">Access is by invitation. Invited before? Ask Rory for a new sign-in link.</p>
          </div>
        </Card>

        <section aria-labelledby="how" className="space-y-4">
          <h2 id="how" className="text-2xl font-strong tracking-tight">
            What the Strategy squad does today
          </h2>
          <ol className="grid gap-4 md:grid-cols-2">
            {STEPS.map((s, i) => (
              <Card as="li" key={s.title} className="flex gap-4">
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-pebble bg-primary-soft font-strong text-ink tabular-nums"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-strong">{s.title}</h3>
                  <p className="mt-1 text-ink-2">{s.text}</p>
                </div>
              </Card>
            ))}
          </ol>
        </section>

        <section aria-labelledby="creative" className="space-y-4">
          <h2 id="creative" className="text-2xl font-strong tracking-tight">
            What the Creative squad does today
          </h2>
          <Card className="space-y-2">
            <h3 className="text-lg font-strong">Ads composed in code</h3>
            <p className="max-w-prose text-ink-2">
              From a signed-off brief, the Imagery agent draws four pictures, each checked for text, and the Copy agent writes
              words for each channel within its character limits, through the same checks as the brief. Code puts each
              picture and set of words into an ad with the logo and the legal line, and checks contrast and fit. A person
              picks, discards, edits the words or asks for a new picture. Nothing is published.
            </p>
          </Card>
        </section>

        <section aria-labelledby="next" className="grid gap-4 md:grid-cols-2">
          <Card>
            <h2 id="next" className="text-xl font-strong tracking-tight">
              Coming next
            </h2>
            <p className="mt-2 text-ink-2">
              More sizes for each ad, and a compliance agent that checks creative before it goes anywhere. Then the
              Performance squad will watch how creative does and propose replacements, which a person approves.
            </p>
          </Card>
          <Card>
            <h2 className="text-xl font-strong tracking-tight">What to expect inside</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-2 marker:text-ink-2">
              <li>The brands are fictional, and their customers and orders are simulated: segment sizes and sales figures are generated for the demo. Market notes come from real web pages and link to them.</li>
              <li>Every agent run keeps its trail: inputs, outputs, model, tokens, cost and time.</li>
              <li>AI spend is capped each day, and runs stop at the cap.</li>
              <li>Each invited person gets their own workspace, with the demo brands one click away.</li>
            </ul>
          </Card>
        </section>

        <p className="text-sm text-ink-2">
          Studio is a working title. If you have been sent an invite link, open it to sign in.
        </p>
      </main>
    </div>
  );
}
