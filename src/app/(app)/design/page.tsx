import { ConfigProblems } from "@/components/config-gate";
import { StatusBadge } from "@/components/status-badge";
import { Button, ButtonLink, TextLink } from "@/components/ui/button";
import { Card, type CardTone } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Ring, type RingTone } from "@/components/ui/ring";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastDemo } from "./toast-demo";

export const metadata = { title: "Components" };

// Every value on this page is a sample for checking the components by eye
// and by screenshot (rule 1). The brand is fictional (rule 2).

const SWATCHES = [
  ["bg", "bg-bg"],
  ["surface", "bg-surface"],
  ["surface-2", "bg-surface-2"],
  ["ink", "bg-ink"],
  ["ink-2", "bg-ink-2"],
  ["line", "bg-line"],
  ["field-line", "bg-field-line"],
  ["primary", "bg-primary"],
  ["primary-soft", "bg-primary-soft"],
  ["good", "bg-good"],
  ["good-soft", "bg-good-soft"],
  ["good-ink", "bg-good-ink"],
  ["review", "bg-review"],
  ["review-soft", "bg-review-soft"],
  ["review-ink", "bg-review-ink"],
  ["attention", "bg-attention"],
  ["attention-soft", "bg-attention-soft"],
  ["attention-ink", "bg-attention-ink"],
] as const;

const SAMPLE_RING: RingTone[] = Array.from({ length: 24 }, (_, i) => (i < 19 ? "good" : i < 22 ? "review" : "attention"));

const STATUSES = ["queued", "running", "awaiting_approval", "completed", "rejected", "expired", "failed", "stopped_cap"];

const LONG_NAME = `Fernhollow ${"Outfitters ".repeat(27)}`.slice(0, 300);
const SCRIPT_NAME = "<script>alert('sample')</script> Fernhollow";

export default function DesignPage() {
  return (
    <div className="space-y-14">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title font-strong">Components</h1>
          <Pill tone="review">Sample values</Pill>
        </div>
        <p className="max-w-prose text-lg text-ink-2">
          Every part of the Soft machine design system, in its light theme. Figures, names and messages on this page
          are samples for checking the components; none of them are real. The prototype it came from is at{" "}
          <TextLink href="/directions">the design direction page</TextLink>.
        </p>
      </header>

      <Section id="colour" title="Colour">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {SWATCHES.map(([name, cls]) => (
            <li key={name} className="rounded-field bg-surface p-2">
              <span aria-hidden className={`block h-12 rounded-field ring-1 ring-line ${cls}`} />
              <span className="mt-1.5 block px-1 font-mono text-xs">{name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="type" title="Type">
        <Card className="space-y-3">
          <p className="text-display font-strong">Your winter campaign is mostly healthy.</p>
          <p className="text-title font-strong">Screen title</p>
          <p className="text-2xl font-strong tracking-tight">Section heading</p>
          <p className="text-lg text-ink-2">Lead paragraph in the secondary ink.</p>
          <p>Body text in Figtree. Plain, specific British English: buttons say what they do.</p>
          <p className="text-sm text-ink-2">Small print and metadata · 25 Oct, 10:42</p>
        </Card>
      </Section>

      <Section id="buttons" title="Buttons">
        <Card className="space-y-4">
          {(["primary", "quiet", "danger"] as const).map((v) => (
            <div key={v} className="flex flex-wrap items-center gap-3">
              <span className="w-20 text-sm text-ink-2">{v}</span>
              <Button type="button" variant={v} size="sm">
                Small
              </Button>
              <Button type="button" variant={v}>
                {v === "danger" ? "Delete sample" : v === "quiet" ? "Not now" : "Approve"}
              </Button>
              <Button type="button" variant={v} size="lg">
                Large
              </Button>
              <Button type="button" variant={v} disabled>
                Disabled
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-20 text-sm text-ink-2">links</span>
            <ButtonLink href="/design" variant="quiet" size="sm">
              A link that looks like a button
            </ButtonLink>
            <TextLink href="/design">A text link</TextLink>
          </div>
        </Card>
      </Section>

      <Section id="pills" title="Pills and statuses">
        <Card className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Pill tone="good">On brand</Pill>
            <Pill tone="review">Needs review</Pill>
            <Pill tone="attention">Below threshold</Pill>
            <Pill tone="neutral">Paused</Pill>
            <Pill tone="active">Live</Pill>
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </Card>
      </Section>

      <Section id="cards" title="Cards">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(["plain", "primary", "good", "review", "attention"] as CardTone[]).map((t) => (
            <Card key={t} tone={t}>
              <p className="font-semibold">Card, {t}</p>
              <p className="mt-1 text-sm text-ink-2">A soft panel. The tone adds a pale border.</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="fields" title="Fields">
        <Card className="grid gap-6 md:grid-cols-2">
          <Field id="sample-brand" label="Brand name" hint="As customers see it. Sample field.">
            <Input defaultValue="Fernhollow Outfitters" />
          </Field>
          <Field id="sample-hex" label="Primary colour" error="Enter a hex colour such as #4f50cf.">
            <Input defaultValue="#12345" />
          </Field>
          <Field id="sample-voice" label="Voice notes" hint="Sample text.">
            <Textarea defaultValue="Warm, plain and outdoorsy. Never jokey about safety." />
          </Field>
          <Field id="sample-category" label="Category">
            <Select defaultValue="outdoor">
              <option value="outdoor">Outdoor clothing</option>
              <option value="fintech">Personal finance app</option>
            </Select>
          </Field>
        </Card>
      </Section>

      <Section id="nav" title="Segmented navigation">
        <Card>
          <SegmentedNav
            label="Sample navigation"
            items={[
              { href: "/", label: "Home", match: "exact" },
              { href: "/runs", label: "Agent runs" },
              { href: "/design", label: "Components" },
            ]}
          />
        </Card>
      </Section>

      <Section id="ring" title="Health ring">
        <Card className="flex flex-wrap items-center gap-8">
          <Ring
            segments={SAMPLE_RING}
            value="78%"
            caption="of spend is healthy"
            label="Sample: 24 live variants, 19 healthy, 3 slipping, 2 below threshold; 78% of spend is healthy"
            size="lg"
          />
          <Ring segments={["good", "good", "review"]} value="2/3" caption="sample runs done" label="Sample: 2 of 3 runs completed, 1 waiting" />
          <Ring segments={[]} value="0" caption="nothing live" label="Sample: nothing live yet" size="sm" />
        </Card>
      </Section>

      <Section id="empty" title="Empty state">
        <EmptyState
          title="No brands yet"
          action={
            <Button type="button" variant="quiet" size="sm">
              Add a sample brand
            </Button>
          }
        >
          Sample copy: say what will appear here and the one thing to do next.
        </EmptyState>
      </Section>

      <Section id="skeleton" title="Skeleton">
        <Card className="space-y-3" aria-label="Sample loading placeholder">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </Card>
      </Section>

      <Section id="toast" title="Toast">
        <ToastDemo />
      </Section>

      <Section id="long" title="Long and hostile names">
        <div className="grid gap-3">
          <Card>
            <p className="text-sm text-ink-2">Sample: a 300-character name</p>
            <p className="mt-1 text-xl font-strong wrap-anywhere" data-testid="sample-long-name">
              {LONG_NAME}
            </p>
          </Card>
          <Card>
            <p className="text-sm text-ink-2">Sample: a name with markup, shown as text</p>
            <p className="mt-1 text-xl font-strong wrap-anywhere" data-testid="sample-script-name">
              {SCRIPT_NAME}
            </p>
          </Card>
        </div>
      </Section>

      <Section id="config" title="Configuration page">
        <ConfigProblems
          headingLevel={3}
          problems={["Sample: SESSION_SECRET is missing. Set it to 32 or more random characters."]}
        />
      </Section>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-2xl font-strong tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}
