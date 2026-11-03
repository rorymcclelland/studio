// S5-4 on the campaign page: the Creative section. Shown in full once the
// brief is signed off: Make creative with its estimate, the gallery of ads
// (each a PNG drawn in code from a picture, a set of words and a layout), the
// words for text-only channels, the discarded ads and words, and the AI cost
// so far with its runs. Mock pictures are badged "Simulated image" (rule 1).
// F-27: the gallery is grouped by audience when the brief has several. F-26:
// ads made with an older kit say so and offer a redraw with the current kit.
import type { CopySetView } from "@/lib/creative/copy";
import { fieldsOf, type AnyCopy, type CopyChannel } from "@/lib/creative/copy-rules";
import type { Badge, CreativeRunView, CreativeView, VariantView } from "@/lib/creative/gallery";
import type { PackSummary } from "@/lib/creative/pack";
import type { GalleryCompliance } from "@/lib/compliance/compute";
import { Suspense } from "react";
import { agentDisplayName } from "@/lib/agents/names";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Pill, type PillTone } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPence, formatWhen } from "@/lib/format";
import {
  AdControls,
  CopySetControls,
  DiscardTranslationButton,
  KeepSetButtons,
  KeepWordsButtons,
  MakeCreativeButton,
  RedrawAllButton,
  RestoreButton,
  TranslateButton,
  type FieldSpec,
} from "./creative-controls";
import { LaunchPack, LaunchPackSkeleton } from "./launch-pack";
import { CompliancePillView } from "./ads/[variantId]/compliance/compliance-view";

const RUNNING = new Set(["queued", "running"]);

const BADGE_TONE: Record<Badge["tone"], PillTone> = { good: "good", warn: "review", info: "review" };

const RUN_KIND: Record<CreativeRunView["kind"], string> = {
  make: "Make creative",
  picture: "New picture",
  words: "New words",
  imagery: "Imagery agent",
  copy: "Copy agent",
  translate: "Translate",
};

const CHANNEL_NAME: Record<string, string> = {
  "paid social": "Paid social",
  display: "Display",
  search: "Search",
  email: "Email",
  "app push": "App push",
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The editor's fields for a set of words, from the channel limits. */
function specFor(channel: CopyChannel, copy: AnyCopy): { fields: FieldSpec[]; values: Record<string, string> } {
  const list = fieldsOf(channel, copy);
  return {
    fields: list.map((f) => ({
      path: f.field,
      label: capitalise(f.label),
      limit: f.limit,
      multiline: /^(body|description|preview)/.test(f.field),
    })),
    values: Object.fromEntries(list.map((f) => [f.field, f.text])),
  };
}

type ComplianceP = Promise<GalleryCompliance | null> | null;

export function CreativeSection({ view, pack, compliance = null }: { view: CreativeView; pack: Promise<PackSummary | null> | null; compliance?: ComplianceP }) {
  const make = view.makeCreative;
  const running = !!make.runningRunId;
  const anyBusy =
    running ||
    view.variants.some((v) => v.busy.picture || v.busy.words) ||
    Object.keys(view.busySets).length > 0 ||
    view.runs.some((r) => RUNNING.has(r.status)) ||
    !!view.translate.runningRunId;
  const lastMake = view.runs.find((r) => r.kind === "make") ?? null;
  const makeProblem = lastMake && !RUNNING.has(lastMake.status) && lastMake.status !== "completed" ? lastMake : null;
  const usedIn = new Map<string, number>();
  for (const v of view.variants) usedIn.set(v.words.setId, (usedIn.get(v.words.setId) ?? 0) + 1);
  const picked = view.variants.filter((v) => v.picked).length;
  // Ads are numbered through the whole gallery, across the audiences' headings, so each name is unique.
  const numbers = new Map(view.variants.map((v, i) => [v.id, i + 1]));
  const grouped = view.audiences.length > 1;

  return (
    <section id="creative" aria-labelledby="creative-heading" className="scroll-mt-6 space-y-5" data-creative="">
      <AutoRefresh active={anyBusy} intervalMs={2000} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="creative-heading" className="text-2xl font-strong tracking-tight">
            Creative
          </h2>
          <p className="mt-1 max-w-prose text-ink-2">
            Pictures from the Imagery agent and words from the Copy agent, composed into 1080 × 1080 ads in code: the
            image model never draws the words, the logo or the legal line. Picking and discarding are marks only; nothing
            is published and no ad money is spent.
          </p>
        </div>
        {view.signedOff && (
          <MakeCreativeButton
            campaignId={view.campaignId}
            estimate={make.estimate.label}
            allowed={make.allowed}
            reason={make.reason}
            running={running}
          />
        )}
      </div>

      {!view.signedOff ? (
        <Card data-creative-locked="">
          <p className="font-semibold">Sign off the brief to make creative</p>
          <p className="mt-1 max-w-prose text-ink-2">
            Creative is made only from a signed-off version of the brief, so the pictures and words rest on what was
            approved.
            {view.version !== null && view.variants.length + view.discarded.length > 0 && (
              <> The ads made for version {view.version} are kept.</>
            )}
          </p>
        </Card>
      ) : (
        <>
          {view.simulated && (
            <p className="rounded-field bg-review-soft px-4 py-3 text-review-ink" data-simulated-note="">
              <span className="font-semibold">Simulated images.</span> These pictures come from the mock image model, drawn
              from the brand&apos;s palette for the demo, not from a real image model. Each ad says so, and the costs shown are
              simulated too.
            </p>
          )}

          {running && (
            <Card tone="primary" className="space-y-4">
              <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StatusBadge status="running" />
                <span>Drawing four pictures and writing the words, then composing the ads. This takes a minute or so.</span>
                <TextLink href={`/runs/${make.runningRunId}`} className="text-sm">
                  See the run
                </TextLink>
              </p>
              <div aria-hidden className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="aspect-square" />
                ))}
              </div>
            </Card>
          )}

          {makeProblem && view.variants.length === 0 && !running && (
            <Card tone="attention" className="bg-attention-soft">
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-semibold text-attention-ink">Make creative didn&apos;t finish</p>
                <StatusBadge status={makeProblem.status} />
              </div>
              <p className="mt-1 max-w-prose wrap-anywhere">{makeProblem.error ?? "The run stopped before it finished."}</p>
              <p className="mt-1 text-sm">
                {makeProblem.status === "stopped_cap" ? "Nothing more was charged. Try again tomorrow. " : ""}
                <TextLink href={makeProblem.href}>See what happened in the trail</TextLink>
              </p>
            </Card>
          )}

          {view.variants.length > 0 ? (
            <div className="space-y-3">
              <p className="text-ink-2" data-gallery-summary="">
                {plural(view.variants.length, "ad")}, {picked} picked. Each shows its checks: contrast, fit and the legal line.
              </p>
              {compliance && (
                <Suspense fallback={<Skeleton className="h-6 w-72" />}>
                  <ComplianceSummaryLine compliance={compliance} />
                </Suspense>
              )}
              <Languages view={view} />
              {pack && (
                <Suspense fallback={<LaunchPackSkeleton />}>
                  <LaunchPack summary={pack} />
                </Suspense>
              )}
              {view.olderKitCount > 0 && (
                <div
                  className="flex flex-col gap-3 rounded-field bg-review-soft px-4 py-3 text-review-ink sm:flex-row sm:items-center sm:justify-between"
                  data-older-kit=""
                >
                  <p className="max-w-prose">
                    <span className="font-semibold">
                      {view.olderKitCount === view.variants.length && view.olderKitCount > 1
                        ? `All ${view.olderKitCount} ads were made with an older kit.`
                        : `${plural(view.olderKitCount, "ad was", "ads were")} made with an older kit.`}
                    </span>{" "}
                    The brand&apos;s palette, fonts or logo have changed since. Redrawing keeps each ad&apos;s picture, words and
                    layout, costs nothing in AI, and can be undone under Discarded.
                  </p>
                  <RedrawAllButton campaignId={view.campaignId} count={view.olderKitCount} />
                </div>
              )}
              {grouped ? (
                view.audiences.map((g, i) => (
                  <section key={g.segmentRef ?? "all"} aria-labelledby={`audience-${i}`} className="space-y-3 pt-2" data-audience-group="">
                    <h3 id={`audience-${i}`} className="text-xl font-strong tracking-tight wrap-anywhere">
                      For {g.title} <span className="text-base font-normal text-ink-2">({plural(g.variants.length, "ad")})</span>
                    </h3>
                    <Gallery view={view} variants={g.variants} label={`Ads for ${g.title} (${g.variants.length})`} numbers={numbers} usedIn={usedIn} level={4} compliance={compliance} />
                  </section>
                ))
              ) : (
                <Gallery view={view} variants={view.variants} label={`Ads (${view.variants.length})`} numbers={numbers} usedIn={usedIn} level={3} compliance={compliance} />
              )}
            </div>
          ) : (
            !running && (
              <Card>
                <p className="max-w-prose text-ink-2">
                  No ads yet. Make creative draws four pictures, has the Copy agent write the paid-social words if the brief
                  has none yet, and composes each picture with each set of words.
                </p>
              </Card>
            )
          )}

          <CopyLists view={view} />
          <Discarded view={view} />
        </>
      )}

      {view.runs.length > 0 && <Runs view={view} />}
    </section>
  );
}

function Gallery({
  view,
  variants,
  label,
  numbers,
  usedIn,
  level,
  compliance,
}: {
  view: CreativeView;
  variants: VariantView[];
  label: string;
  numbers: Map<string, number>;
  usedIn: Map<string, number>;
  level: 3 | 4;
  compliance: ComplianceP;
}) {
  return (
    // Wider than the page column on large screens, so four ads sit side by side at a readable size.
    <ul
      aria-label={label}
      data-gallery=""
      className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:mx-[calc(50%-min(50vw-3rem,38rem))] xl:grid-cols-4"
    >
      {variants.map((v) => (
        <AdCard key={v.id} view={view} v={v} number={numbers.get(v.id) ?? 0} usedIn={usedIn.get(v.words.setId) ?? 1} level={level} compliance={compliance} />
      ))}
    </ul>
  );
}

function AdCard({ view, v, number, usedIn, level, compliance }: { view: CreativeView; v: VariantView; number: number; usedIn: number; level: 3 | 4; compliance: ComplianceP }) {
  const titleId = `ad-${v.id}-title`;
  const Heading = level === 3 ? "h3" : "h4";
  const { fields } = specFor(v.channel, { headline: v.words.headline, body: v.words.body, cta: v.words.cta });
  return (
    <li
      aria-labelledby={titleId}
      data-ad={v.id}
      data-channel={v.channel}
      data-words={v.words.setId}
      data-picked={v.picked ? "" : undefined}
      className={cx("flex min-w-0 flex-col gap-3 rounded-card border-2 bg-surface p-3 sm:p-4", v.picked ? "border-primary" : "border-transparent")}
    >
      {/* The ad is drawn by the /ads route; the layout is in the address so a switch shows the new drawing. */}
      {/* Clicking the ad opens it full size (1080 × 1080) in a new tab (Rory's test, 27 Oct). */}
      <a
        href={`${v.src}?layout=${v.layout}`}
        target="_blank"
        rel="noopener"
        data-ad-full=""
        title="Open full size"
        className="group relative block rounded-field focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a drawn PNG behind the session, not a static asset */}
        <img
          src={`${v.src}?layout=${v.layout}`}
          width={1080}
          height={1080}
          loading="lazy"
          alt={`Ad ${number}, ${v.layoutName} layout, opens full size in a new tab. Headline: ${v.words.headline}. ${v.words.body} Button: ${v.words.cta}.`}
          className="block aspect-square h-auto w-full cursor-zoom-in rounded-field bg-surface-2"
        />
        <span className="pointer-events-none absolute right-2 bottom-2 rounded-full bg-ink/80 px-2.5 py-1 text-xs font-medium text-surface opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Full size
        </span>
      </a>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Heading id={titleId} className="font-strong">
          Ad {number}
        </Heading>
        <span className="text-sm text-ink-2">{v.layoutName}</span>
        <TextLink href={`/campaigns/${view.campaignId}/ads/${v.id}/sizes`} className="text-sm" data-ad-sizes="">
          Sizes<span className="sr-only"> of ad {number}</span>
        </TextLink>
        <TextLink href={`/campaigns/${view.campaignId}/ads/${v.id}/compliance`} className="text-sm" data-ad-compliance="">
          Compliance<span className="sr-only"> of ad {number}</span>
        </TextLink>
        {v.picked && (
          <Pill tone="active" dot className="ml-auto">
            Picked
          </Pill>
        )}
      </div>
      <ul aria-label={`Checks for ad ${number}`} className="flex flex-wrap gap-1.5">
        {compliance && (
          <li data-badge="compliance">
            <Suspense fallback={<Skeleton className="h-6 w-24 rounded-full" />}>
              <CompliancePill compliance={compliance} variantId={v.id} />
            </Suspense>
          </li>
        )}
        {v.badges.map((b) => (
          <li key={b.key} data-badge={b.key}>
            <Pill tone={BADGE_TONE[b.tone]} wrap>
              {b.label}
            </Pill>
          </li>
        ))}
      </ul>
      {v.busy.picture && (
        <p role="status" className="text-sm text-primary">
          Drawing a new picture. <TextLink href={`/runs/${v.busy.picture}`}>See the run</TextLink>
        </p>
      )}
      {v.busy.words && (
        <p role="status" className="text-sm text-primary">
          Writing new words. <TextLink href={`/runs/${v.busy.words}`}>See the run</TextLink>
        </p>
      )}
      {v.pendingWords && (
        <div className="space-y-2 rounded-field border-2 border-review-soft bg-review-soft/50 p-3" data-pending-words="">
          <p className="font-semibold text-review-ink">New words are ready</p>
          <dl className="space-y-1 text-sm">
            <WordsRow label="Headline" now={v.words.headline} next={v.pendingWords.headline} />
            <WordsRow label="Body" now={v.words.body} next={v.pendingWords.body} />
            <WordsRow label="Button" now={v.words.cta} next={v.pendingWords.cta} />
          </dl>
          <KeepWordsButtons campaignId={view.campaignId} variantId={v.id} usedIn={usedIn} />
        </div>
      )}
      <Translations view={view} v={v} number={number} />
      <AdControls
        campaignId={view.campaignId}
        variantId={v.id}
        number={number}
        picked={v.picked}
        layout={v.layout}
        layouts={view.layouts}
        estimates={{ newPicture: view.estimates.newPicture.label, newWords: view.estimates.newWords.label }}
        busy={v.busy}
        usedIn={usedIn}
        words={{ headline: v.words.headline, body: v.words.body, cta: v.words.cta }}
        fields={fields}
        pendingWords={!!v.pendingWords}
        olderKit={v.olderKit}
      />
      <details className="group text-sm">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full font-semibold text-primary">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ›
          </span>
          About ad {number}
        </summary>
        <ul className="mt-2 space-y-1.5 text-ink-2">
          {v.badges.map((b) => (
            <li key={b.key} className="wrap-anywhere">
              <span className="font-semibold text-ink">{b.label}:</span> {b.detail}
            </li>
          ))}
          {v.image.idea && (
            <li className="wrap-anywhere">
              <span className="font-semibold text-ink">Picture idea:</span> {v.image.idea}
            </li>
          )}
          <li>
            <span className="font-semibold text-ink">Words:</span> {v.words.source === "person" ? "edited by a person" : "by the Copy agent"},
            for {v.words.audience.title}.
          </li>
          {v.origin === "redrawn" && (
            <li>
              <span className="font-semibold text-ink">Redrawn</span> with a newer kit, from an ad made with an older one (the same
              picture, words and layout).
            </li>
          )}
          {v.words.legalLines.length > 0 && (
            <li className="wrap-anywhere">
              <span className="font-semibold text-ink">Legal line:</span> {v.words.legalLines.join(" ")}
            </li>
          )}
          {v.translations.map((t) => (
            <li key={t.lang} className="wrap-anywhere" data-translation-words={t.lang}>
              <span className="font-semibold text-ink">
                {t.name} ({t.badge.label.toLowerCase()}):
              </span>{" "}
              {t.headline}. {t.body} Button: {t.cta}. {t.legalLines.length > 0 && <>Legal lines: {t.legalLines.join(" ")}</>}
            </li>
          ))}
          {v.translations.length > 0 && (
            <li className="wrap-anywhere">
              <span className="font-semibold text-ink">{v.translations[0].badge.label}:</span> {v.translations[0].badge.detail}
            </li>
          )}
          <li className="flex flex-wrap gap-x-3 gap-y-1">
            {v.image.runId && <TextLink href={`/runs/${v.image.runId}`}>The picture&apos;s run</TextLink>}
            {v.words.runId && <TextLink href={`/runs/${v.words.runId}`}>The words&apos; run</TextLink>}
            {v.runId && v.runId !== v.image.runId && <TextLink href={`/runs/${v.runId}`}>The run that made this ad</TextLink>}
          </li>
        </ul>
      </details>
    </li>
  );
}

/**
 * C7-2: the brand's languages and Translate on the whole pick. Each language
 * is allowed, or refused with the reason (no legal lines for it); the cost is
 * on the button (rule 3).
 */
function Languages({ view }: { view: CreativeView }) {
  const t = view.translate;
  const running = !!t.runningRunId;
  const demo = t.languages.some((l) => l.writtenForDemo);
  return (
    <div className="flex flex-col gap-3 rounded-field bg-surface px-4 py-3 sm:flex-row sm:items-start sm:justify-between" data-languages="">
      <div className="min-w-0 max-w-prose space-y-1.5">
        <p className="font-semibold">Languages</p>
        {t.languages.length === 0 ? (
          <p className="text-sm text-ink-2">
            The brand has no languages yet.{" "}
            <TextLink href={`/brands/${view.brandId}/languages`}>Choose them on the brand&apos;s Languages page</TextLink>, with the legal lines
            for each.
          </p>
        ) : (
          <>
            <ul aria-label="The brand's languages" className="flex flex-wrap gap-1.5">
              {t.languages.map((l) => (
                <li key={l.lang} data-language={l.lang} title={l.reason ?? undefined}>
                  <Pill tone={l.allowed ? "neutral" : "attention"} wrap>
                    {l.name}
                    {l.allowed ? "" : ": no legal lines"}
                  </Pill>
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-2">
              The Localise agent translates the words of picked ads; each translation is checked in every size and badged
              &ldquo;Machine translation&rdquo;. Legal lines are the brand&apos;s own for each language
              {demo ? " (written by Claude for the demo)" : ""}, never machine-translated.{" "}
              <TextLink href={`/brands/${view.brandId}/languages`}>Languages page</TextLink>
            </p>
          </>
        )}
        {running && (
          <p role="status" className="text-sm text-primary">
            Translating. <TextLink href={`/runs/${t.runningRunId}`}>See the run</TextLink>
          </p>
        )}
      </div>
      {t.languages.length > 0 && (
        <TranslateButton
          campaignId={view.campaignId}
          label="Translate the picked ads"
          estimate={t.picked.estimate}
          reason={t.picked.reason}
          note={t.refusedNote}
          running={running}
          align="end"
        />
      )}
    </div>
  );
}

/** C7-2: an ad's translations, each a thumbnail that opens its sizes, badged "Machine translation" (rule 1); Translate on a picked ad. */
function Translations({ view, v, number }: { view: CreativeView; v: VariantView; number: number }) {
  if (v.translations.length === 0 && !v.picked) return null;
  const running = !!view.translate.runningRunId;
  return (
    <div className="space-y-2" data-translations="">
      {v.translations.length > 0 && (
        <ul aria-label={`Ad ${number} in other languages`} className="grid grid-cols-3 gap-2">
          {v.translations.map((t) => (
            <li key={t.lang} data-translation={t.lang} className="min-w-0">
              <a
                href={t.sizesHref}
                title={`${t.name}: every size, with its checks`}
                className="block rounded-field focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t.thumb ? (
                  // The first size these words fit, at its own width and height (review fix 8).
                  // eslint-disable-next-line @next/next/no-img-element -- a drawn PNG behind the session, not a static asset
                  <img
                    src={t.thumb.src}
                    width={t.thumb.width}
                    height={t.thumb.height}
                    loading="lazy"
                    alt={`Ad ${number} in ${t.name}, a machine translation, opens its sizes. Headline: ${t.headline}. Button: ${t.cta}.`}
                    className="block h-auto w-full rounded-field bg-surface-2"
                  />
                ) : (
                  <span className="block rounded-field bg-surface-2 p-2 text-sm text-ink-2 wrap-anywhere" data-translation-reason="">
                    {t.thumbReason}
                  </span>
                )}
                <span className="mt-1 block text-sm font-semibold">{t.name}</span>
              </a>
              <DiscardTranslationButton campaignId={view.campaignId} setId={t.setId} what={`the ${t.name} translation of ad ${number}`} />
            </li>
          ))}
        </ul>
      )}
      {v.translations.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5" data-badge="translation" title={v.translations[0].badge.detail}>
          <Pill tone="review" wrap>
            {v.translations.some((t) => t.simulated) ? "Machine translation (simulated)" : "Machine translation"}
          </Pill>
        </p>
      )}
      {v.picked && v.translate.todo > 0 && (
        <TranslateButton
          campaignId={view.campaignId}
          variantId={v.id}
          label={v.translations.length ? "Translate the rest" : "Translate"}
          estimate={v.translate.estimate}
          reason={v.translate.reason}
          running={running}
        />
      )}
      {v.picked && v.translate.todo === 0 && v.translations.length === 0 && v.translate.reason && (
        <p className="text-sm text-ink-2 wrap-anywhere" data-translate-reason="">
          {v.translate.reason}
        </p>
      )}
    </div>
  );
}

function WordsRow({ label, now, next }: { label: string; now: string; next: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-semibold">{label}</dt>
      <dd className="wrap-anywhere">
        <span className="sr-only">New: </span>
        {next}
      </dd>
      {now !== next && (
        <dd className="text-ink-2 wrap-anywhere">
          <span className="font-medium">Now: </span>
          {now}
        </dd>
      )}
    </div>
  );
}

/** The words for text-only channels, and ad words with no ads in the gallery, as lists beside the gallery. */
function CopyLists({ view }: { view: CreativeView }) {
  const textSets = view.textSets.filter((s) => !s.replaces);
  const adSets = view.setsWithoutAds.filter((s) => !s.replaces);
  const waiting = new Map([...view.textSets, ...view.setsWithoutAds].filter((s) => s.replaces).map((s) => [s.replaces as string, s]));
  if (textSets.length === 0 && adSets.length === 0) return null;
  return (
    <div className="space-y-5">
      {textSets.length > 0 && (
        <section aria-labelledby="text-sets" className="space-y-3">
          <h3 id="text-sets" className="text-xl font-strong tracking-tight">
            Words for other channels
          </h3>
          <p className="max-w-prose text-ink-2">The brief&apos;s channels without a picture, written by the Copy agent with their limits.</p>
          <ul aria-label="Words for other channels" className="grid gap-4 md:grid-cols-2">
            {textSets.map((s) => (
              <CopySetCard key={s.id} view={view} set={s} replacement={waiting.get(s.id) ?? null} newWords />
            ))}
          </ul>
        </section>
      )}
      {adSets.length > 0 && (
        <section aria-labelledby="sets-without-ads" className="space-y-3">
          <h3 id="sets-without-ads" className="text-xl font-strong tracking-tight">
            Ad words without ads
          </h3>
          <p className="max-w-prose text-ink-2">
            Paid-social and display words with no ad in the gallery: every ad on them was discarded, or the ads were made
            before each audience got its own.
          </p>
          <ul aria-label="Ad words without ads" className="grid gap-4 md:grid-cols-2">
            {adSets.map((s) => (
              <CopySetCard key={s.id} view={view} set={s} replacement={waiting.get(s.id) ?? null} newWords />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CopySetCard({ view, set, replacement, newWords }: { view: CreativeView; set: CopySetView; replacement: CopySetView | null; newWords: boolean }) {
  const channel = CHANNEL_NAME[set.channel] ?? set.channel;
  const title = `the ${channel.toLowerCase()} words for ${set.audience.title}`;
  const { fields, values } = specFor(set.channel, set.copy);
  const busy = view.busySets[set.id];
  return (
    <Card as="li" className="space-y-3" data-copy-set={set.channel}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-strong">{channel}</h4>
        <span className="min-w-0 text-sm text-ink-2 wrap-anywhere">{set.audience.title}</span>
        {set.source === "person" && <Pill tone="neutral">Edited by a person</Pill>}
      </div>
      <SetFields fields={fields} values={values} />
      {set.addedByPerson.length > 0 && (
        <p className="text-sm text-review-ink">
          Added by a person, not in the brief&apos;s evidence: {set.addedByPerson.map((a) => a.figure).join(", ")}.
        </p>
      )}
      {set.legalLines.length > 0 && <p className="text-sm text-ink-2 wrap-anywhere">Legal line: {set.legalLines.join(" ")}</p>}
      {busy && (
        <p role="status" className="text-sm text-primary">
          Writing new words. <TextLink href={`/runs/${busy}`}>See the run</TextLink>
        </p>
      )}
      {replacement && (
        <div className="space-y-2 rounded-field border-2 border-review-soft bg-review-soft/50 p-3" data-pending-words="">
          <p className="font-semibold text-review-ink">New words are ready</p>
          <SetFields {...specFor(replacement.channel, replacement.copy)} />
          <KeepSetButtons campaignId={view.campaignId} oldSetId={set.id} newSetId={replacement.id} />
        </div>
      )}
      <CopySetControls
        campaignId={view.campaignId}
        setId={set.id}
        title={title}
        fields={fields}
        initial={values}
        newWordsEstimate={newWords ? view.estimates.newWords.label : null}
        busy={!!busy}
        waiting={!!replacement}
      />
    </Card>
  );
}

function SetFields({ fields, values }: { fields: FieldSpec[]; values: Record<string, string> }) {
  return (
    <dl className="space-y-2">
      {fields.map((f) => (
        <div key={f.path} className="min-w-0">
          <dt className="text-sm font-semibold">
            {f.label}{" "}
            <span className="font-normal text-ink-2 tabular-nums">
              ({(values[f.path] ?? "").length} of {f.limit})
            </span>
          </dt>
          <dd className="wrap-anywhere">{values[f.path]}</dd>
        </div>
      ))}
    </dl>
  );
}

function Discarded({ view }: { view: CreativeView }) {
  if (view.discarded.length === 0 && view.discardedSets.length === 0) return null;
  return (
    <section aria-labelledby="discarded" className="space-y-3">
      <h3 id="discarded" className="text-xl font-strong tracking-tight">
        Discarded
      </h3>
      <p className="max-w-prose text-ink-2">Nothing is deleted. Restore an ad or a set of words to bring it back.</p>
      <ul aria-label="Discarded ads and words" className="overflow-hidden rounded-card bg-surface">
        {view.discarded.map((v) => {
          const drawable = !v.image.discarded && !v.words.discarded;
          const what = `the ad "${v.words.headline}"`;
          return (
            <li key={v.id} data-discarded-ad={v.id} className="flex flex-wrap items-center gap-4 border-line px-4 py-3 not-first:border-t sm:px-6">
              {drawable ? (
                // eslint-disable-next-line @next/next/no-img-element -- a drawn PNG behind the session
                <img src={`${v.src}?layout=${v.layout}`} width={64} height={64} loading="lazy" alt="" className="size-16 shrink-0 rounded-field bg-surface-2" />
              ) : (
                <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-field bg-surface-2 text-xs text-ink-2">
                  Replaced
                </span>
              )}
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-semibold wrap-anywhere">Ad: {v.words.headline}</p>
                <p className="text-sm text-ink-2">
                  {v.layoutName}
                  {v.discardedAt ? `, ${v.redrawnBy ? "redrawn with the current kit" : "discarded"} ${formatWhen(v.discardedAt)}` : ""}
                  {v.restore.reason ? `. ${v.restore.reason}` : ""}
                  {v.redrawnBy && v.restore.allowed ? ". Restoring it brings back the older kit and discards the redrawn ad." : ""}
                </p>
              </div>
              {v.restore.allowed && <RestoreButton campaignId={view.campaignId} id={v.id} kind="ad" what={what} />}
            </li>
          );
        })}
        {view.discardedSets.map((s) => {
          const channel = CHANNEL_NAME[s.channel] ?? s.channel;
          const first = fieldsOf(s.channel, s.copy)[0]?.text ?? "";
          return (
            <li key={s.id} data-discarded-set={s.id} className="flex flex-wrap items-center gap-4 border-line px-4 py-3 not-first:border-t sm:px-6">
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-semibold wrap-anywhere">
                  {channel} words: {first}
                </p>
                <p className="text-sm text-ink-2">
                  For {s.audience.title}
                  {s.discardedAt ? `, discarded ${formatWhen(s.discardedAt)}` : ""}
                </p>
              </div>
              <RestoreButton campaignId={view.campaignId} id={s.id} kind="set" what={`the ${channel.toLowerCase()} words "${first}"`} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Runs({ view }: { view: CreativeView }) {
  return (
    <section aria-labelledby="creative-runs" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="creative-runs" className="text-xl font-strong tracking-tight">
          Runs and AI cost
        </h3>
        <p className="font-semibold" data-creative-cost="">
          AI cost of the creative so far: <span className="tabular-nums">{formatPence(view.totalCostPence)}</span>
        </p>
      </div>
      <ul aria-label="Creative runs, newest first" className="overflow-hidden rounded-card bg-surface">
        {view.runs.map((r) => (
          <li key={r.runId} className="border-line px-4 py-3 not-first:border-t sm:px-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <TextLink href={r.href} className="font-semibold">
                {RUN_KIND[r.kind]}
              </TextLink>
              <StatusBadge status={r.status} />
              <span className="ml-auto text-sm text-ink-2 tabular-nums">
                {formatPence(r.costPence)} · {formatWhen(r.createdAt)}
              </span>
            </div>
            {r.children.length > 0 && (
              <ul aria-label={`Runs inside ${RUN_KIND[r.kind]}`} className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {r.children.map((c) => (
                  <li key={c.runId} className="flex items-center gap-2">
                    <TextLink href={c.href}>{agentDisplayName(c.agent)}</TextLink>
                    <span className="text-ink-2 tabular-nums">{formatPence(c.costPence)}</span>
                  </li>
                ))}
              </ul>
            )}
            {r.error && !RUNNING.has(r.status) && r.status !== "completed" && <p className="mt-1 text-sm text-attention-ink wrap-anywhere">{r.error}</p>}
          </li>
        ))}
      </ul>
      {view.simulated && (
        <p className="text-sm text-ink-2" data-simulated-cost="">
          Simulated costs: the mock models are priced like the real ones so the daily cap can be tried out, and nothing is paid.
        </p>
      )}
    </section>
  );
}

/** C8-1: an ad's compliance pill (Passes, N to review, Fails), once the gallery's compliance is worked out. */
async function CompliancePill({ compliance, variantId }: { compliance: NonNullable<ComplianceP>; variantId: string }) {
  const c = await compliance;
  const pill = c?.pills[variantId];
  if (!pill) return null;
  return (
    <span data-compliance-pill="" title="Compliance in every size and language: open Compliance for the rules">
      <CompliancePillView pill={pill} />
    </span>
  );
}

/** C8-1: the picked ads' compliance, over every size and language: "40 ads pass, 6 to review, 2 fail". */
async function ComplianceSummaryLine({ compliance }: { compliance: NonNullable<ComplianceP> }) {
  const c = await compliance;
  if (!c?.summary) return null;
  return (
    <p className="text-ink-2" data-compliance-summary="">
      <span className="font-semibold text-ink">Compliance of the picked ads:</span> {c.summary.text}, over every size and language. Only
      ads that pass, or whose review items a person accepted, go in the launch pack.
    </p>
  );
}
