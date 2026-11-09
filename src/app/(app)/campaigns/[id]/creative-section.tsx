// S5-4 on the campaign's Creative stage (U10-2): the Creative section. Shown in full once the
// brief is signed off: Make creative with its estimate, the gallery of ads
// (each a PNG drawn in code from a picture, a set of words and a layout), the
// words for text-only channels, the discarded ads and words, and the AI cost
// so far with its runs. Mock pictures are badged "Simulated image" (rule 1).
// F-27: the gallery is grouped by audience when the brief has several. F-26:
// ads made with an older kit say so and offer a redraw with the current kit.
// U10-3: a filter row above the gallery (All, Picked, Needs a decision,
// Launched, and each audience when there are several), kept in the address;
// audience groups that collapse to their heading and count; and compact cards
// that show the ad, its state and its scores, with Pick on the face and the
// other tools under "Edit" and "More", only those the ad's state allows. An ad
// in a live or waiting launch is locked and says so. The checks on the picked
// ads (compliance, languages, pre-test, pictures, the launch pack) follow the
// gallery, as they work on what was picked there.
// U10-3, Rory's choices of 9 November 2026, so the page fits its length
// budget: (a) those checks fold into one line with their state, open from the
// start on ?show=decide or when a link points inside; (b) the gallery's one
// group shows its first six ads, or each of several audience groups its first
// three (launched, then needing a decision, then picked, then the rest, newest
// first), then "Show all N ads"; a filter shows every ad it matches, and a
// link to an ad reveals its group in full.
import type { CopySetView } from "@/lib/creative/copy";
import { fieldsOf, type AnyCopy, type CopyChannel } from "@/lib/creative/copy-rules";
import type { Badge, CreativeRunView, CreativeView, VariantView } from "@/lib/creative/gallery";
import {
  AD_STATE_LABELS,
  adState,
  adTools,
  emptyLine,
  filterAds,
  GALLERY_SHOWS,
  galleryHref,
  galleryOrder,
  lockLine,
  pickedChecksLine,
  previewCount,
  SHOW_LABELS,
  showAllLabel,
  showCounts,
  TOOL_MENU,
  type AdFacts,
  type AdState,
  type AdTool,
  type GalleryShow,
} from "@/lib/creative/gallery-filter";
import type { PackSummary } from "@/lib/creative/pack";
import type { GalleryCompliance } from "@/lib/compliance/compute";
import Link from "next/link";
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
  CopySetControls,
  DiscardAdButton,
  DiscardTranslationButton,
  EditTools,
  KeepSetButtons,
  KeepWordsButtons,
  MakeCreativeButton,
  PickButton,
  RedrawAllButton,
  RestoreButton,
  TranslateButton,
  type FieldSpec,
} from "./creative-controls";
import { AdMenus } from "./ad-menus";
import { GalleryReveal, PickedChecks } from "./gallery-reveal";
import { LaunchPack, LaunchPackSkeleton } from "./launch-pack";
import { PictureCheckBar } from "./picture-check-bar";
import { PretestBar, PretestScores } from "./pretest-panel";
import { HistoryDetails } from "./history-details";
import { CompliancePillView } from "./ads/[variantId]/compliance/compliance-view";
import { BulkAcceptDontRules } from "./ads/[variantId]/compliance/bulk-accept";

const RUNNING = new Set(["queued", "running"]);

const BADGE_TONE: Record<Badge["tone"], PillTone> = { good: "good", warn: "review", info: "review" };

const STATE_TONE: Record<AdState, PillTone> = { discarded: "neutral", launched: "good", decide: "review", picked: "active" };

const RUN_KIND: Record<CreativeRunView["kind"], string> = {
  make: "Make creative",
  picture: "New picture",
  words: "New words",
  imagery: "Imagery agent",
  copy: "Copy agent",
  translate: "Translate",
  pretest: "Pre-test",
  pictures: "Check pictures",
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

/** U10-3: what the gallery shows: the filter from the address and each ad's facts (from its compliance and launch). */
export type GalleryChoice = { show: GalleryShow; audience: string | null; facts: AdFacts[] };

export function CreativeSection({
  view,
  pack,
  compliance = null,
  gallery,
}: {
  view: CreativeView;
  pack: Promise<PackSummary | null> | null;
  compliance?: ComplianceP;
  gallery: GalleryChoice;
}) {
  const make = view.makeCreative;
  const running = !!make.runningRunId;
  const anyBusy =
    running ||
    view.variants.some((v) => v.busy.picture || v.busy.words) ||
    Object.keys(view.busySets).length > 0 ||
    view.runs.some((r) => RUNNING.has(r.status)) ||
    !!view.translate.runningRunId ||
    !!view.pretest.runningRunId ||
    !!view.pictureCheck.runningRunId;
  const lastMake = view.runs.find((r) => r.kind === "make") ?? null;
  const makeProblem = lastMake && !RUNNING.has(lastMake.status) && lastMake.status !== "completed" ? lastMake : null;
  const usedIn = new Map<string, number>();
  for (const v of view.variants) usedIn.set(v.words.setId, (usedIn.get(v.words.setId) ?? 0) + 1);
  const picked = view.variants.filter((v) => v.picked).length;
  // Ads are numbered through the whole gallery, across the audiences' headings, so each name is unique.
  const numbers = new Map(view.variants.map((v, i) => [v.id, i + 1]));
  const grouped = view.audiences.length > 1;
  const facts = new Map(gallery.facts.map((f) => [f.id, f]));
  const shown = new Set(filterAds(gallery.facts, gallery.show, gallery.audience).map((f) => f.id));
  // Each group in the gallery's order (launched, needing a decision, picked, the rest; newest first).
  const ordered = (vs: VariantView[]) =>
    galleryOrder(vs.map((v) => ({ ...(facts.get(v.id) ?? factsOf(v)), createdAt: v.createdAt, runId: v.runId, v }))).map((x) => x.v);
  const groups = (grouped ? view.audiences : [{ segmentRef: null, title: "", variants: view.variants }])
    .map((g) => ({ ...g, variants: ordered(g.variants.filter((v) => shown.has(v.id))) }))
    .filter((g) => g.variants.length > 0);
  const pickedFacts = gallery.facts.filter((f) => f.picked);
  const pickedViews = view.variants.filter((v) => v.picked);
  const pretested = pickedViews.filter((v) => v.pretest?.state === "current");
  const translated = pickedViews.filter((v) => v.translations.length > 0);
  const checksFacts = {
    picked: pickedFacts.length,
    toDecide: pickedFacts.filter((f) => f.toDecide).length,
    pretested: { count: pretested.length, simulated: pretested.some((v) => v.pretest?.simulated) },
    translated: { count: translated.length, simulated: translated.some((v) => v.translations.some((t) => t.simulated)) },
    picturesUnchecked: view.pictureCheck.todo,
  };

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
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-ink-2" data-gallery-summary="">
                  {plural(view.variants.length, "ad")}, {picked} picked. Each shows its checks: contrast, fit and the legal line.
                </p>
                <GalleryFilter view={view} gallery={gallery} grouped={grouped} />
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
                {groups.length === 0 ? (
                  <p className="rounded-field bg-surface px-4 py-3 text-ink-2" data-gallery-empty="">
                    {emptyLine(gallery.show)}
                  </p>
                ) : grouped ? (
                  groups.map((g, i) => (
                    <details key={g.segmentRef ?? "all"} open className="group/audience space-y-3 pt-2" data-audience-group={g.segmentRef ?? ""}>
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-field [&::-webkit-details-marker]:hidden">
                        <svg aria-hidden viewBox="0 0 16 16" className="size-5 shrink-0 text-primary transition-transform group-open/audience:rotate-90 motion-reduce:transition-none">
                          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <h3 id={`audience-${i}`} className="min-w-0 text-xl font-strong tracking-tight wrap-anywhere">
                          For {g.title}{" "}
                          <span className="text-base font-normal text-ink-2">
                            (<span data-audience-count="">{g.variants.length}</span> {g.variants.length === 1 ? "ad" : "ads"})
                          </span>
                        </h3>
                      </summary>
                      <Gallery
                        view={view}
                        variants={g.variants}
                        facts={facts}
                        label={`Ads for ${g.title} (${g.variants.length})`}
                        numbers={numbers}
                        usedIn={usedIn}
                        level={4}
                        compliance={compliance}
                        show={gallery.show}
                        groups={groups.length}
                      />
                    </details>
                  ))
                ) : (
                  <Gallery
                    view={view}
                    variants={groups[0].variants}
                    facts={facts}
                    label={`Ads (${groups[0].variants.length})`}
                    numbers={numbers}
                    usedIn={usedIn}
                    level={3}
                    compliance={compliance}
                    show={gallery.show}
                    groups={1}
                  />
                )}
              </div>

              <PickedChecks
                defaultOpen={gallery.show === "decide"}
                summary={
                  <Suspense fallback={<PickedChecksHeading facts={{ ...checksFacts, packReady: null }} />}>
                    <PickedChecksSummary facts={checksFacts} pack={pack} />
                  </Suspense>
                }
              >
                {compliance && (
                  <div id="picked-compliance" className="scroll-mt-6">
                    <Suspense fallback={<Skeleton className="h-6 w-72" />}>
                      <ComplianceSummaryLine compliance={compliance} campaignId={view.campaignId} />
                    </Suspense>
                  </div>
                )}
                <Languages view={view} />
                <PretestBar view={view} />
                <PictureCheckBar view={view} />
                {pack && (
                  <Suspense fallback={<LaunchPackSkeleton />}>
                    <LaunchPack summary={pack} />
                  </Suspense>
                )}
              </PickedChecks>
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

/**
 * U10-3: the filter row: All, Picked, Needs a decision and Launched with their
 * counts (over the chosen audience), then each audience when there are
 * several. Links, so the choice is in the address and survives a reload.
 */
function GalleryFilter({ view, gallery, grouped }: { view: CreativeView; gallery: GalleryChoice; grouped: boolean }) {
  const inAudience = gallery.audience === null ? gallery.facts : gallery.facts.filter((f) => f.segmentRef === gallery.audience);
  const counts = showCounts(inAudience);
  const audiences = grouped ? view.audiences.filter((g) => g.segmentRef !== null) : [];
  const chip = (current: boolean) =>
    cx(
      "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none",
      current ? "bg-primary-soft text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
    );
  return (
    <nav aria-label="Filter the ads" data-gallery-filter="" className="rounded-card bg-surface p-1.5">
      <ul className="flex flex-wrap gap-1">
        {GALLERY_SHOWS.map((show) => {
          const current = show === gallery.show;
          return (
            <li key={show}>
              <Link
                href={galleryHref(view.campaignId, { show, audience: gallery.audience })}
                scroll={false}
                data-gallery-show={show}
                aria-current={current ? "page" : undefined}
                className={chip(current)}
              >
                {SHOW_LABELS[show]}
                <span className={cx("rounded-full px-1.5 text-xs leading-5 tabular-nums", current ? "bg-surface text-ink" : "bg-surface-2 text-ink-2")} data-gallery-count="">
                  {counts[show]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {audiences.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1 border-t border-line pt-1" aria-label="Audiences">
          {[{ segmentRef: "", title: "Every audience" }, ...audiences.map((g) => ({ segmentRef: g.segmentRef as string, title: g.title }))].map((a) => {
            const current = (gallery.audience ?? "") === a.segmentRef;
            return (
              <li key={a.segmentRef || "every"} className="min-w-0">
                <Link
                  href={galleryHref(view.campaignId, { show: gallery.show, audience: a.segmentRef || null })}
                  scroll={false}
                  data-gallery-audience={a.segmentRef}
                  aria-current={current ? "page" : undefined}
                  className={cx(chip(current), "max-w-full whitespace-normal wrap-anywhere")}
                >
                  {a.title}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

function Gallery({
  view,
  variants,
  facts,
  label,
  numbers,
  usedIn,
  level,
  compliance,
  show,
  groups,
}: {
  view: CreativeView;
  variants: VariantView[];
  facts: Map<string, AdFacts>;
  label: string;
  numbers: Map<string, number>;
  usedIn: Map<string, number>;
  level: 3 | 4;
  compliance: ComplianceP;
  show: GalleryShow;
  /** How many groups the gallery shows: more than one shows fewer ads in each before Show all. */
  groups: number;
}) {
  return (
    // Wider than the page column on large screens, so four ads sit side by side.
    // Keyed by the filter, so going back to All starts at the first few again.
    <GalleryReveal
      key={show}
      label={label}
      total={variants.length}
      preview={previewCount(show, variants.length, groups)}
      showAllLabel={showAllLabel(variants.length)}
      wrapClassName="xl:mx-[calc(50%-min(50vw-3rem,38rem))]"
      className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {variants.map((v) => (
        <AdCard
          key={v.id}
          view={view}
          v={v}
          facts={facts.get(v.id)}
          number={numbers.get(v.id) ?? 0}
          usedIn={usedIn.get(v.words.setId) ?? 1}
          level={level}
          compliance={compliance}
        />
      ))}
    </GalleryReveal>
  );
}

/** An ad's facts when the page has none for it (it always does): from the ad itself. */
function factsOf(v: VariantView): AdFacts {
  return { id: v.id, picked: v.picked, toDecide: false, launch: v.launch?.status ?? null, segmentRef: v.words.audience.segmentRef };
}

/** The folded checks' summary: "Checks on the 4 picked ads: 1 needs a decision, launch pack ready". */
function PickedChecksHeading({ facts }: { facts: Parameters<typeof pickedChecksLine>[0] }) {
  const line = pickedChecksLine(facts);
  return (
    <h3 id="picked-heading" className="min-w-0 wrap-anywhere" data-picked-checks-line="">
      <span className="text-lg font-strong tracking-tight">{line.title}</span>
      <span className="text-ink-2">: {line.state}</span>
    </h3>
  );
}

async function PickedChecksSummary({ facts, pack }: { facts: Omit<Parameters<typeof pickedChecksLine>[0], "packReady">; pack: Promise<PackSummary | null> | null }) {
  const summary = pack ? await pack : null;
  return <PickedChecksHeading facts={{ ...facts, packReady: summary ? summary.allowed : null }} />;
}

function AdCard({
  view,
  v,
  facts,
  number,
  usedIn,
  level,
  compliance,
}: {
  view: CreativeView;
  v: VariantView;
  facts: AdFacts | undefined;
  number: number;
  usedIn: number;
  level: 3 | 4;
  compliance: ComplianceP;
}) {
  const titleId = `ad-${v.id}-title`;
  const Heading = level === 3 ? "h3" : "h4";
  const { fields } = specFor(v.channel, { headline: v.words.headline, body: v.words.body, cta: v.words.cta });
  const f: AdFacts = facts ?? factsOf(v);
  const state = adState(f);
  const lock = lockLine(f.launch);
  const tools = new Set<AdTool>(adTools({ picked: v.picked, launch: f.launch, olderKit: v.olderKit, translate: v.translate.todo > 0 }));
  const has = (menu: "edit" | "more") => [...tools].some((t) => TOOL_MENU[t] === menu);
  // A waiting choice of words on an ad a launch holds: only the old words can be kept until the launch ends or is decided.
  const keepLocked = f.launch === "live" ? "The new words can be kept once the launch ends." : f.launch ? "The new words can be kept once the launch is decided." : null;
  return (
    <li
      id={`ad-${number}`}
      aria-labelledby={titleId}
      data-ad={v.id}
      data-channel={v.channel}
      data-words={v.words.setId}
      data-picked={v.picked ? "" : undefined}
      data-locked={f.launch ?? undefined}
      className={cx("flex min-w-0 scroll-mt-6 flex-col gap-2.5 rounded-card border-2 bg-surface p-3", v.picked ? "border-primary" : "border-transparent")}
    >
      <div className="flex min-w-0 gap-3 sm:flex-col sm:gap-2">
        {/* The ad is drawn by the /ads route; the layout is in the address so a switch shows the new drawing. */}
        {/* Clicking the ad opens it full size (1080 × 1080) in a new tab (Rory's test, 27 Oct). */}
        <a
          href={`${v.src}?layout=${v.layout}`}
          target="_blank"
          rel="noopener"
          data-ad-full=""
          title="Open full size"
          className="group relative block w-28 shrink-0 self-start rounded-field focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-full"
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
          <span className="pointer-events-none absolute right-2 bottom-2 hidden rounded-full bg-ink/80 px-2.5 py-1 text-xs font-medium text-surface opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:block">
            Full size
          </span>
        </a>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Heading id={titleId} className="font-strong">
              Ad {number}
            </Heading>
            {state && (
              <span className="ml-auto flex flex-wrap gap-1">
                {/* Picked, and waiting on a compliance decision: both are true, so both are shown. */}
                {state === "decide" && <Pill tone="active">Picked</Pill>}
                <Pill tone={STATE_TONE[state]} dot>
                  <span data-ad-state="">{AD_STATE_LABELS[state]}</span>
                </Pill>
              </span>
            )}
          </div>
          <p className="line-clamp-3 text-sm font-medium wrap-anywhere" data-ad-headline="">
            {v.words.headline}
          </p>
          {lock && (
            <p className="text-sm font-semibold text-good-ink" data-ad-locked="">
              {lock}
            </p>
          )}
        </div>
      </div>
      {/* The compliance result, the simulated label and anything worth a look as pills; the checks it passed as one line. */}
      <ul aria-label={`Checks for ad ${number}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {compliance && (
          <li data-badge="compliance">
            <Suspense fallback={<Skeleton className="h-6 w-24 rounded-full" />}>
              <CompliancePill compliance={compliance} variantId={v.id} />
            </Suspense>
          </li>
        )}
        {v.badges
          .filter((b) => b.tone !== "good")
          .map((b) => (
            <li key={b.key} data-badge={b.key}>
              <Pill tone={BADGE_TONE[b.tone]} wrap>
                {b.label}
              </Pill>
            </li>
          ))}
        {v.badges
          .filter((b) => b.tone === "good")
          .map((b) => (
            <li key={b.key} data-badge={b.key} className="inline-flex items-center gap-1 px-1 text-sm font-semibold text-good-ink">
              <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0">
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {b.label}
            </li>
          ))}
      </ul>
      <PretestScores v={v} number={number} />
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
          <KeepWordsButtons campaignId={view.campaignId} variantId={v.id} usedIn={usedIn} locked={keepLocked} />
        </div>
      )}
      <AdMenus
        number={number}
        pick={<PickButton campaignId={view.campaignId} variantId={v.id} number={number} picked={v.picked} />}
        edit={
          has("edit") ? (
            <EditTools
              campaignId={view.campaignId}
              variantId={v.id}
              number={number}
              layout={v.layout}
              layouts={view.layouts}
              estimates={{ newPicture: view.estimates.newPicture.label, newWords: view.estimates.newWords.label }}
              busy={v.busy}
              usedIn={usedIn}
              words={{ headline: v.words.headline, body: v.words.body, cta: v.words.cta }}
              fields={fields}
              pendingWords={!!v.pendingWords}
              olderKit={v.olderKit && tools.has("redraw")}
            />
          ) : null
        }
        more={
          has("more") ? (
            <div className="flex flex-col gap-3">
              <Translations view={view} v={v} number={number} translate={tools.has("translate")} locked={f.launch !== null} />
              <p className="flex flex-wrap gap-x-4 gap-y-1">
                <TextLink href={`/campaigns/${view.campaignId}/ads/${v.id}/sizes`} className="text-sm" data-ad-sizes="">
                  Sizes<span className="sr-only"> of ad {number}</span>
                </TextLink>
                <TextLink href={`/campaigns/${view.campaignId}/ads/${v.id}/compliance`} className="text-sm" data-ad-compliance="">
                  Compliance<span className="sr-only"> of ad {number}</span>
                </TextLink>
              </p>
              {tools.has("discard") && <DiscardAdButton campaignId={view.campaignId} variantId={v.id} number={number} />}
              <About view={view} v={v} number={number} />
            </div>
          ) : null
        }
      />
    </li>
  );
}

/** What an ad is made of, opening in place, with the runs that made it. */
function About({ view, v, number }: { view: CreativeView; v: VariantView; number: number }) {
  return (
    <details className="group text-sm" data-ad-about="">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full font-semibold text-primary">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">
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
        {v.launch && (
          <li>
            <span className="font-semibold text-ink">Launch:</span>{" "}
            {v.launch.status === "live" ? "running in the launch (simulated)" : "in a launch waiting for approval (simulated)"}.{" "}
            <TextLink href={`/campaigns/${view.campaignId}/launch`}>The Launch stage</TextLink>
          </li>
        )}
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
    <div className="flex flex-col gap-3 rounded-field bg-surface px-4 py-3 sm:flex-row sm:items-start sm:justify-between" id="languages" data-languages="">
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
/** U10-3: `locked`, a launch holds the ad, so its translations can't be discarded until it ends or is decided. */
function Translations({ view, v, number, translate, locked }: { view: CreativeView; v: VariantView; number: number; translate: boolean; locked: boolean }) {
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
              {!locked && <DiscardTranslationButton campaignId={view.campaignId} setId={t.setId} what={`the ${t.name} translation of ad ${number}`} />}
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
      {translate && (
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

/** U10-2: discarded ads and words, one line with a count until opened. */
function Discarded({ view }: { view: CreativeView }) {
  if (view.discarded.length === 0 && view.discardedSets.length === 0) return null;
  return (
    <HistoryDetails kind="discarded" id="discarded" title="Discarded" count={view.discarded.length + view.discardedSets.length}>
      <p className="max-w-prose text-ink-2">Nothing is deleted. Restore an ad or a set of words to bring it back.</p>
      <ul aria-label="Discarded ads and words" className="overflow-hidden rounded-field border border-line">
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
    </HistoryDetails>
  );
}

/** U10-2: the creative runs and their AI cost, one line with a count until opened. */
function Runs({ view }: { view: CreativeView }) {
  return (
    <HistoryDetails kind="runs" id="creative-runs" title="Runs and AI cost" count={view.runs.length}>
      <p className="font-semibold" data-creative-cost="">
        AI cost of the creative so far: <span className="tabular-nums">{formatPence(view.totalCostPence)}</span>
      </p>
      <ul aria-label="Creative runs, newest first" className="overflow-hidden rounded-field border border-line">
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
    </HistoryDetails>
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
async function ComplianceSummaryLine({ compliance, campaignId }: { compliance: NonNullable<ComplianceP>; campaignId: string }) {
  const c = await compliance;
  if (!c?.summary) return null;
  return (
    <div className="space-y-3">
      <p className="text-ink-2" data-compliance-summary="">
        <span className="font-semibold text-ink">Compliance of the picked ads:</span> {c.summary.text}, over every size and language. Only
        ads that pass, or whose review items a person accepted, go in the launch pack.
      </p>
      <BulkAcceptDontRules campaignId={campaignId} rules={c.dontRules} />
    </div>
  );
}
