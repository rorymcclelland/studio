// U10-2: a campaign opens on its overview (answer Q2): where it is, what
// needs a person, and one short card per stage. Everything here is worked out
// from the same facts as the stage bar (src/lib/campaigns/stages.ts), read once
// by loadCampaign() through asUser() (rule 7). The overview only links to the
// places where things are decided (rule 3), and every simulated figure it
// repeats says so (rule 1). The stages are their own pages: brief/, audience/,
// creative/, launch/ and performance/.
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill, type PillTone } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { campaignStatusLabel } from "@/lib/campaigns/status";
import { belowThresholdLine, campaignStages, needsYou, type StageId, type StageView } from "@/lib/campaigns/stages";
import { BrandLine, campaignOr404, campaignTitle } from "./campaign-frame";
import { NeedsYou } from "./needs-you";
import { OldLinkRedirect } from "./old-link-redirect";
import { StageBar } from "./stage-bar";

const RUNNING = new Set(["queued", "running"]);

/** What each stage holds, in a line, for its card. */
const STAGE_WHAT: Record<StageId, string> = {
  brief: "The brief, its sign-off and its versions.",
  audience: "Synthetic personas and the test plan.",
  creative: "The ads, their checks and the launch pack.",
  launch: "The simulated launch and its clock.",
  performance: "Healthy spend share, alerts and questions (simulated).",
};

function stateTone(label: string): PillTone {
  if (label.startsWith("Live")) return "good";
  if (label === "Waiting for sign-off" || label === "Launch waiting") return "review";
  if (label === "Writing the brief") return "active";
  return "neutral";
}

function StageCard({ stage }: { stage: StageView }) {
  return (
    <Card as="li" data-stage-card={stage.id} className="flex flex-col gap-2">
      <h3 className="text-lg font-strong">{stage.name}</h3>
      <p className="font-semibold text-ink-2">{stage.label}</p>
      {stage.locked ? (
        <p className="text-sm text-ink-2">
          {stage.locked.reason} <TextLink href={stage.locked.href}>{stage.locked.link}</TextLink>
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-2">{STAGE_WHAT[stage.id]}</p>
          <p className="mt-auto">
            <TextLink href={stage.href}>
              Open {stage.name}
              <span aria-hidden> →</span>
            </TextLink>
          </p>
        </>
      )}
    </Card>
  );
}

async function OverviewContent(props: PageProps<"/campaigns/[id]">) {
  const { id } = await props.params;
  const { data } = await campaignOr404(id);
  const { campaign, facts } = data;
  const state = campaignStatusLabel(facts);
  const stages = campaignStages(facts);
  const shown = facts.launches.some((l) => l.status === "live" || l.status === "ended");
  const below = shown ? belowThresholdLine(facts.performance?.belowThreshold ?? []) : null;
  const writing = !campaign.brief && !!campaign.run && (RUNNING.has(campaign.run.status) || campaign.run.status === "completed");

  return (
    <div className="space-y-6">
      <OldLinkRedirect campaignId={campaign.id} />
      <AutoRefresh active={writing} />
      <div className="space-y-4">
        <div>
          <TextLink href="/campaigns">
            <span aria-hidden>← </span>All campaigns
          </TextLink>
          <Card size="hero" className="mt-3">
            <BrandLine data={data} />
            <h1 className="mt-3 text-title font-strong wrap-anywhere">{campaignTitle(data)}</h1>
            {campaign.brief && (
              <p className="mt-3 max-w-prose text-ink-2 wrap-anywhere sm:text-lg">
                <span className="font-semibold text-ink">Objective: </span>
                {campaign.objective}
              </p>
            )}
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Pill tone={stateTone(state)} dot={state.startsWith("Live")} wrap>
                <span data-campaign-state="">{state}</span>
              </Pill>
              {below && (
                <span className="font-semibold text-attention-ink wrap-anywhere" data-below-threshold="">
                  {below}
                </span>
              )}
            </p>
          </Card>
        </div>
        <StageBar stages={stages} current={null} />
      </div>
      <NeedsYou items={needsYou(facts)} />
      <section aria-labelledby="stages-heading" className="space-y-3">
        <h2 id="stages-heading" className="text-2xl font-strong tracking-tight">
          Stages
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stages.map((s) => (
            <StageCard key={s.id} stage={s} />
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function CampaignOverviewPage(props: PageProps<"/campaigns/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the campaign" />}>
      <OverviewContent {...props} />
    </Suspense>
  );
}
