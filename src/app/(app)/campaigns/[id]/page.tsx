import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getCampaign, getVersion, type CampaignDetail, type Proposal } from "@/lib/brief/repo";
import type { StoredBrief } from "@/lib/brief/schema";
import { listContext } from "@/lib/context/store";
import { getSignoffState } from "@/lib/approvals/repo";
import { getReviews } from "@/lib/strategy/reviews";
import { listMarketNotes, type MarketNote } from "@/lib/strategy/market";
import { getCreative } from "@/lib/creative/gallery";
import { daysSince } from "@/components/format-day";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { ButtonLink, TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { formatWhen } from "@/lib/format";
import { DismissRevisionButton, ProposalButtons, RestoreVersionButton, RetryBriefButton } from "./brief-actions";
import { BriefWorkspace, type ContextOption } from "./brief-editor";
import {
  changedSections,
  KitLists,
  SECTION_LABEL,
  SectionBody,
  sectionPhrase,
  type Sources,
} from "./brief-view";
import { CreativeSection } from "./creative-section";
import { PersonasSection, TestPlanSection } from "./review-sections";
import { MARKET_WARNING_DAYS, SignoffPanel, type OldMarketSource } from "./signoff-panel";

const RUNNING = new Set(["queued", "running"]);
const CITABLE = new Set(["segment", "insight", "product", "result"]);

async function CampaignPageContent(props: PageProps<"/campaigns/[id]">) {
  const { id } = await props.params;
  const { version: versionParam } = await props.searchParams;
  const member = await requireMember();
  const campaign = await getCampaign(member.userId, id);
  if (!campaign) notFound();

  const requested = typeof versionParam === "string" && /^\d+$/.test(versionParam) ? Number(versionParam) : null;
  const viewing = requested !== null && requested !== campaign.currentVersion ? requested : null;
  const [context, old, signoff, reviews, market, creative] = await Promise.all([
    listContext(member.userId, campaign.brand.id),
    viewing !== null ? getVersion(member.userId, campaign.id, viewing) : Promise.resolve(null),
    getSignoffState(member.userId, campaign.id),
    getReviews(member.userId, campaign.id),
    listMarketNotes(member.userId, campaign.brand.id),
    getCreative(member.userId, campaign.id),
  ]);
  if (viewing !== null && !old) notFound();

  // Titles for every item a brief here can cite: the current brief and
  // proposals (from getCampaign), and an old version (from the store).
  const sources: Sources = { ...campaign.sources };
  for (const c of context) sources[c.id] ??= { kind: c.kind, title: c.title, text: c.body };
  // Market notes (S4-3) show their web pages and the date they were checked.
  const notes = new Map(market.map((n) => [n.id, n]));
  for (const [id, s] of Object.entries(sources)) {
    const n = notes.get(id);
    if (n) sources[id] = { ...s, text: n.text, web: webOrigin(n) };
  }

  const brief = campaign.brief;
  const drafting = !brief;
  const runActive = !!campaign.run && RUNNING.has(campaign.run.status);
  const revisingActive = campaign.revising.some((r) => RUNNING.has(r.status));
  const title = brief?.title ?? campaign.objective;
  const oldMarket = brief ? oldMarketSources(brief, notes) : [];

  return (
    <div className="space-y-8">
      <AutoRefresh active={(drafting && (runActive || campaign.run?.status === "completed")) || revisingActive} />
      <div>
        <TextLink href="/campaigns">
          <span aria-hidden>← </span>All campaigns
        </TextLink>
        <Card size="hero" className="mt-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-medium text-ink-2">
            <TextLink href={`/brands/${campaign.brand.id}`}>{campaign.brand.name}</TextLink>
            {campaign.brand.isSimulated && <Pill tone="review">Simulated data</Pill>}
          </p>
          <h1 className="mt-3 text-title font-strong wrap-anywhere">{title}</h1>
          {brief && (
            <p className="mt-3 max-w-prose text-lg text-ink-2 wrap-anywhere">
              <span className="font-semibold text-ink">Objective: </span>
              {campaign.objective}
            </p>
          )}
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-ink-2">
            {drafting ? (
              <Pill tone="active" dot>
                Writing the brief
              </Pill>
            ) : (
              <span className="font-semibold text-ink" data-version-label="">
                {viewing !== null ? `Viewing version ${viewing} of ${campaign.currentVersion}` : `Version ${campaign.currentVersion}`}
              </span>
            )}
            {campaign.run && <TextLink href={`/runs/${campaign.run.id}`}>See the Brief agent&apos;s trail</TextLink>}
          </p>
          {campaign.brand.isSimulated && (
            <p className="mt-3 max-w-prose text-sm text-ink-2">
              The brief draws on simulated customer data: segment sizes and figures are generated for the demo, not real
              people or sales.
            </p>
          )}
        </Card>
      </div>

      {!drafting && viewing === null && signoff && (
        <SignoffPanel campaignId={campaign.id} currentVersion={campaign.currentVersion} state={signoff} oldMarketSources={oldMarket} />
      )}

      {drafting ? (
        <Drafting campaign={campaign} />
      ) : viewing !== null && old ? (
        <OldVersion campaign={campaign} version={viewing} brief={old} sources={sources} />
      ) : (
        <>
          <Revisions campaign={campaign} />
          {campaign.proposals.map((p) => (
            <ProposalCard key={p.runId} campaign={campaign} proposal={p} sources={sources} />
          ))}
          <BriefWorkspace
            key={campaign.currentVersion}
            campaignId={campaign.id}
            brandId={campaign.brand.id}
            currentVersion={campaign.currentVersion}
            brief={brief}
            sources={sources}
            unsourced={campaign.unsourced}
            citeOptions={citeOptions(brief, context, sources)}
            segments={context.filter((c) => c.kind === "segment").map((c) => ({ id: c.id, kind: c.kind, title: c.title }))}
          />
          <PersonasSection campaignId={campaign.id} currentVersion={campaign.currentVersion} reviews={reviews} />
          <TestPlanSection campaignId={campaign.id} currentVersion={campaign.currentVersion} reviews={reviews} />
          {creative && <CreativeSection view={creative} />}
        </>
      )}

      {campaign.versions.length > 0 && <History campaign={campaign} viewing={viewing} />}
    </div>
  );
}

function webOrigin(n: MarketNote) {
  return { checkedAt: n.checkedAt.toISOString(), links: n.sources.map((x) => ({ url: x.url, title: x.title })) };
}

/** Market notes the current brief cites that were checked more than 30 days ago (a warning at sign-off, not a block). */
function oldMarketSources(brief: StoredBrief, notes: Map<string, MarketNote>): OldMarketSource[] {
  const out: OldMarketSource[] = [];
  for (const id of new Set(brief.insights.flatMap((i) => i.cites))) {
    const n = notes.get(id);
    if (!n) continue;
    const days = daysSince(n.checkedAt);
    if (days > MARKET_WARNING_DAYS) out.push({ title: n.title, checkedAt: n.checkedAt, days });
  }
  return out;
}

/** What an insight may cite: what it cites now, plus the brand's segments, insights and products. */
function citeOptions(brief: StoredBrief, context: { id: string; kind: string; title: string }[], sources: Sources): ContextOption[] {
  const out = new Map<string, ContextOption>();
  for (const id of brief.insights.flatMap((i) => i.cites)) {
    const s = sources[id];
    if (s) out.set(id, { id, kind: s.kind, title: s.title });
  }
  for (const c of context) if (CITABLE.has(c.kind)) out.set(c.id, { id: c.id, kind: c.kind, title: c.title });
  return [...out.values()];
}

function Drafting({ campaign }: { campaign: CampaignDetail }) {
  const run = campaign.run;
  if (run && (RUNNING.has(run.status) || run.status === "completed")) {
    return (
      <Card as="section" aria-labelledby="drafting" tone="primary">
        <h2 id="drafting" className="text-xl font-strong tracking-tight">
          Writing the brief
        </h2>
        <p role="status" className="mt-1 max-w-prose text-ink-2">
          The Brief agent is reading the context store and writing the brief. This usually takes under a minute.
        </p>
        {/* The shape of the brief to come. */}
        <div aria-hidden className="mt-6 space-y-3">
          <Skeleton className="h-6 w-2/3 max-w-md" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-4 w-5/6 max-w-lg" />
          <div className="grid gap-3 pt-3 sm:grid-cols-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card as="section" aria-labelledby="draft-problem" tone="attention" className="bg-attention-soft">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="draft-problem" className="text-xl font-strong tracking-tight text-attention-ink">
          The brief wasn&apos;t written
        </h2>
        {run && <StatusBadge status={run.status} />}
      </div>
      <p className="mt-2 max-w-prose wrap-anywhere">
        {!run
          ? "The Brief agent didn't start, so there is no brief yet. The daily spend cap may have been reached."
          : (run.error ?? "The Brief agent stopped before it finished.")}
        {run?.status === "stopped_cap" && " Nothing more was charged. Try again tomorrow, or raise the daily cap."}
      </p>
      <p className="mt-1 max-w-prose text-sm">
        The campaign and its objective are kept.
        {run && (
          <>
            {" "}
            <TextLink href={`/runs/${run.id}`}>See what happened in the trail</TextLink>.
          </>
        )}
      </p>
      <div className="mt-4">
        <RetryBriefButton campaignId={campaign.id} />
      </div>
    </Card>
  );
}

function Revisions({ campaign }: { campaign: CampaignDetail }) {
  if (campaign.revising.length === 0) return null;
  const active = campaign.revising.filter((r) => RUNNING.has(r.status));
  const failed = campaign.revising.filter((r) => !RUNNING.has(r.status));
  return (
    <section aria-labelledby="revisions" className="space-y-3">
      <h2 id="revisions" className="sr-only">
        Revisions in progress
      </h2>
      {active.length > 0 && (
        <Card tone="primary">
          <ul className="space-y-2" aria-label="Revisions in progress">
            {active.map((r) => (
              <li key={r.runId} role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StatusBadge status={r.status} />
                <span className="min-w-0 wrap-anywhere">
                  <span className="font-semibold">Revising {sectionPhrase(r.section)}:</span> {r.instruction}
                </span>
                <TextLink href={`/runs/${r.runId}`} className="text-sm">
                  Trail
                </TextLink>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-2">The proposal appears here when it is ready. Nothing changes until you use it.</p>
        </Card>
      )}
      {failed.map((r) => (
        <Card key={r.runId} tone="attention" className="bg-attention-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-attention-ink wrap-anywhere">
                The revision of {sectionPhrase(r.section)} failed: &ldquo;{r.instruction}&rdquo;
              </p>
              <p className="mt-1 wrap-anywhere">{r.error ?? "The Brief agent stopped before it finished."}</p>
              <p className="mt-1 text-sm">
                The current version is unchanged. <TextLink href={`/runs/${r.runId}`}>See the trail</TextLink>
              </p>
            </div>
            <DismissRevisionButton campaignId={campaign.id} runId={r.runId} />
          </div>
        </Card>
      ))}
    </section>
  );
}

function ProposalCard({ campaign, proposal, sources }: { campaign: CampaignDetail; proposal: Proposal; sources: Sources }) {
  const current = campaign.brief!;
  const changed = changedSections(current, proposal.brief);
  const unchanged = (Object.keys(SECTION_LABEL) as (keyof typeof SECTION_LABEL)[]).filter((s) => !changed.includes(s));
  const headingId = `proposal-${proposal.runId}`;
  return (
    <Card as="section" aria-labelledby={headingId} tone="review" data-proposal="" className="space-y-5">
      <div>
        <Pill tone="review">Proposed by the Brief agent</Pill>
        <h2 id={headingId} className="mt-2 text-2xl font-strong tracking-tight">
          Proposed revision of {sectionPhrase(proposal.section)}
        </h2>
        <blockquote className="mt-3 border-l-4 border-review pl-4 text-lg wrap-anywhere">
          <span className="sr-only">You asked: </span>&ldquo;{proposal.instruction}&rdquo;
        </blockquote>
        <p className="mt-2 text-sm text-ink-2">
          Asked for {formatWhen(proposal.createdAt)}, based on version {proposal.baseVersion}. Nothing changes until you use it.
        </p>
      </div>

      {changed.length === 0 ? (
        <p className="text-ink-2">This proposal is the same as the current version.</p>
      ) : (
        <div className="space-y-5">
          {changed.map((s) => (
            <div key={s} data-changed-section={s}>
              <h3 className="flex flex-wrap items-center gap-2 text-lg font-strong">
                {SECTION_LABEL[s]} <Pill tone="review">Changed</Pill>
              </h3>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <div className="min-w-0 rounded-field border border-line bg-bg p-4">
                  <p className="mb-2 text-sm font-semibold text-ink-2">Current, version {campaign.currentVersion}</p>
                  <SectionBody section={s} brief={current} sources={sources} idPrefix="Current" />
                </div>
                <div className="min-w-0 rounded-field border-2 border-review bg-review-soft/40 p-4">
                  <p className="mb-2 text-sm font-semibold text-review-ink">Proposed</p>
                  <SectionBody section={s} brief={proposal.brief} sources={sources} idPrefix="Proposed" />
                </div>
              </div>
            </div>
          ))}
          {unchanged.length > 0 && (
            <p className="text-sm text-ink-2">
              Unchanged: {unchanged.map((s) => SECTION_LABEL[s]).join(", ")}.
            </p>
          )}
        </div>
      )}
      <ProposalButtons campaignId={campaign.id} runId={proposal.runId} />
    </Card>
  );
}

function OldVersion({ campaign, version, brief, sources }: { campaign: CampaignDetail; version: number; brief: StoredBrief; sources: Sources }) {
  const meta = campaign.versions.find((v) => v.version === version);
  return (
    <>
      <Card as="section" aria-labelledby="old-version" tone="review" className="bg-review-soft">
        <h2 id="old-version" className="text-xl font-strong tracking-tight">
          You are looking at version {version}
        </h2>
        <p className="mt-1 max-w-prose">
          {meta ? `${versionSource(meta)}, ${formatWhen(meta.createdAt)}. ` : ""}
          It is read-only. Version {campaign.currentVersion} is the current version; making this one current again saves it
          as version {campaign.currentVersion + 1}, so nothing in the history is lost.
        </p>
        <div className="mt-4 flex flex-wrap items-start gap-3">
          <RestoreVersionButton campaignId={campaign.id} version={version} currentVersion={campaign.currentVersion} />
          <ButtonLink href={`/campaigns/${campaign.id}`} variant="quiet">
            Back to the current version
          </ButtonLink>
        </div>
      </Card>
      <section aria-labelledby="brief" className="space-y-4">
        <h2 id="brief" className="text-2xl font-strong tracking-tight">
          The brief, version {version}
        </h2>
        {(Object.keys(SECTION_LABEL) as (keyof typeof SECTION_LABEL)[]).map((s) => (
          <Card as="section" key={s} aria-labelledby={`old-${s}`}>
            <h3 id={`old-${s}`} className="text-lg font-strong">
              {SECTION_LABEL[s]}
            </h3>
            <div className="mt-3">
              <SectionBody section={s} brief={brief} sources={sources} />
            </div>
          </Card>
        ))}
        <KitLists brief={brief} brandId={campaign.brand.id} />
      </section>
    </>
  );
}

function versionSource(v: CampaignDetail["versions"][number]): string {
  switch (v.source) {
    case "agent":
      return "Brief agent";
    case "person":
      return v.note ? `Edited by you: ${v.note}` : "Edited by you";
    case "revision":
      return v.note ? `Revision: ${v.note}` : "Revision";
    case "restore":
      return v.restoredFrom ? `Restored from version ${v.restoredFrom}` : "Restored";
    default:
      return v.source;
  }
}

function History({ campaign, viewing }: { campaign: CampaignDetail; viewing: number | null }) {
  return (
    <section aria-labelledby="history">
      <h2 id="history" className="text-2xl font-strong tracking-tight">
        Version history
      </h2>
      <p className="mt-1 text-ink-2">Every version is kept, newest first. Open one to read it or make it current again.</p>
      <ol aria-label="Versions, newest first" className="mt-4 overflow-hidden rounded-card bg-surface">
        {campaign.versions.map((v) => {
          const current = v.version === campaign.currentVersion;
          const open = viewing === null ? current : viewing === v.version;
          return (
            <li
              key={v.version}
              data-version={v.version}
              aria-current={open ? "true" : undefined}
              className={cx(
                "flex flex-wrap items-center gap-x-4 gap-y-1.5 border-line px-5 py-4 not-first:border-t sm:px-6",
                open && "bg-primary-soft/50",
              )}
            >
              <span className="font-semibold tabular-nums">Version {v.version}</span>
              {current && <Pill tone="good">Current</Pill>}
              <span className="min-w-0 basis-full text-ink-2 wrap-anywhere sm:flex-1 sm:basis-auto">{versionSource(v)}</span>
              <span className="text-sm text-ink-2 tabular-nums">{formatWhen(v.createdAt)}</span>
              {open ? (
                <span className="text-sm font-medium text-ink-2">Showing</span>
              ) : (
                <TextLink href={current ? `/campaigns/${campaign.id}` : `/campaigns/${campaign.id}?version=${v.version}`} className="text-sm">
                  {current ? "View the current version" : `View version ${v.version}`}
                </TextLink>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function CampaignPage(props: PageProps<"/campaigns/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the campaign" />}>
      <CampaignPageContent {...props} />
    </Suspense>
  );
}
