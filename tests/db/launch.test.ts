// P9-1 Launch a simulated campaign, in the database and through the server
// actions (the session is the only thing mocked; the database is real).
// Test cases 1 (asked with the defaults and approved, a launch is live with
// exactly the eligible ads), 2 (eligibility is the pack's rule: an ad is in when
// the pack has a file for it, and a left-out ad carries the pack's reason;
// none eligible says "No picked ads pass compliance yet"), 3 (no sign-off: the
// panel and the action refuse), 4 (out-of-range input and a tampered ad), 5
// (refusal, and one open request), 6 (the guard trigger), 7 (End the launch
// records who), 8 (another workspace) and 9 (a hostile refusal reason). The
// browser parts of 1, 2 and 7 are tests/e2e/launch.spec.ts.
//
// ---------------------------------------------------------------- interface
// The builder follows this; the tests below pin it.
//
// Migration (the next file after 20261103000005_sprint8_review_fixes.sql, e.g.
// 20261106000001_launches.sql):
// - public.launches: id uuid pk, workspace_id (not null, RLS as the other business
//   tables: select/insert/update for members; revoke all from anon; revoke delete,
//   truncate from authenticated), campaign_id not null with
//   foreign key (campaign_id, workspace_id) references campaigns (id, workspace_id),
//   ads jsonb not null (a non-empty array of {variantId, sizes[], langs[]}, as the
//   pack), daily_budget_pence int check 500..50000, days int check 7..60,
//   starts_on date check '2026-01-01'..'2027-12-31', kpi_measure text check in
//   ('ctr','conversion_rate','cpa','roas'), kpi_value numeric check > 0 and, for
//   ctr and conversion_rate, <= 100 (percentages; cpa is simulated pounds, roas a
//   ratio), seed bigint not null, status text check in ('awaiting_approval',
//   'live','ended','refused'), approval_id uuid NOT NULL with foreign key
//   (approval_id, workspace_id) references approvals (id, workspace_id) (add that
//   unique key to approvals), created_by, ended_by (references auth.users),
//   ended_at, approved_at, created_at.
// - Unique partial indexes: one 'awaiting_approval' and one 'live' launch per campaign.
// - Guard trigger (before update): once old.status <> 'awaiting_approval', any change
//   to ads, daily_budget_pence, days, starts_on, kpi_measure, kpi_value or seed
//   raises errcode 42501, "A launch's ads, budget, length, start and threshold
//   can't change once it is approved". It fires for every role, the owner too.
//   Status may still move (live -> ended). No delete trigger: the tests clear
//   launches as the owner between tests.
// - approvals: a third kind 'launch' in the kind check, and in approvals_subject:
//   kind = 'launch' and campaign_id is not null and run_id is null and
//   brief_version is null. The LINK IS approvals.campaign_id (existing column and
//   FK) plus launches.approval_id; approvals gets no launch_id column.
//   approvals_guard applies unchanged. A refusal is approvals.status 'rejected'
//   with the reason in approvals.reason (already <= 500); the launch is 'refused'.
//
// src/lib/performance/launch.ts (all reads and writes through asUser(), rule 7):
// - KPI_MEASURES = ["ctr", "conversion_rate", "cpa", "roas"] as const; type KpiMeasure.
// - MEASURE_NAMES: ctr "Click-through rate", conversion_rate "Conversion rate",
//   cpa "Cost per acquisition (simulated £)", roas "Return on ad spend".
// - HEALTHY_WHEN: cpa "at or below"; the others "at or above".
// - SIMULATED_DEFAULT = "Studio's own simulated default, not a benchmark".
// - DEFAULT_VALUES = { ctr: 1, conversion_rate: 2, cpa: 20, roas: 3 }.
// - defaultThreshold(briefKpi: KpiMetric | null) => { measure, value, healthyWhen, label: SIMULATED_DEFAULT }:
//   click-through rate, reach -> ctr; conversions, sign-ups, reactivation rate,
//   cost per acquisition -> cpa; return on ad spend, revenue -> roas; null -> conversion_rate.
// - LAUNCH_LIMITS = { budgetPence: { min: 500, max: 50000, default: 5000 }, days: { min: 7, max: 60, default: 30 },
//   startsOn: { min: "2026-01-01", max: "2027-12-31" } }.
// - type LaunchSettings = { dailyBudgetPence: number; days: number; startsOn: string /* YYYY-MM-DD */; kpiMeasure: string; kpiValue: number };
//   type LaunchRequest = LaunchSettings & { variantIds: string[] }.
// - launchDefaults(briefKpi, now = new Date()): LaunchSettings: £50, 30 days, today in
//   Europe/London, and defaultThreshold's measure and value.
// - LAUNCH_REASONS (each exact, in this order when several apply):
//   budget "The daily budget must be between £5 and £500 (simulated)." (whole pence only),
//   days "A launch runs for 7 to 60 days." (whole days only),
//   startsOn "The start date must be between 1 January 2026 and 31 December 2027." (a real date),
//   measure "Pick one of the four measures: click-through rate, conversion rate, cost per acquisition or return on ad spend.",
//   threshold "The threshold must be a number above 0.",
//   percent "A rate can't be more than 100%." (ctr and conversion_rate only).
// - validateLaunchInput(settings: LaunchSettings): string[] (empty when valid).
// - Messages: NOT_SIGNED_OFF_LAUNCH "A campaign can launch only once its brief is signed off.",
//   NO_ELIGIBLE_ADS "No picked ads pass compliance yet", LAUNCH_NOT_VALID "The launch wasn't
//   asked for. Fix the problems below.", LAUNCH_CAMPAIGN_NOT_FOUND "That campaign isn't in
//   your workspace.", LAUNCH_AD_NOT_FOUND "That ad isn't in this campaign.", LAUNCH_ADS_CHANGED
//   "The ads that can launch changed since the page was opened. Reload to see them.",
//   LAUNCH_ALREADY_ASKED "This campaign already has a launch waiting for approval.",
//   LAUNCH_ALREADY_LIVE "This campaign already has a live launch.", LAUNCH_REQUEST_NOT_OPEN
//   "This launch request is no longer open.", REFUSAL_NEEDS_REASON "Say why, so the launch
//   can be fixed.", LAUNCH_NOT_LIVE "There's no live launch to end.".
// - class LaunchError extends Error { problems?: string[] }.
// - launchEligibility(userId, campaignId): null (not the user's, or a malformed id: a 404)
//   | { refused: NOT_SIGNED_OFF_LAUNCH } | LaunchEligibility, built on planPack():
//   { campaignId, briefKpi: KpiMetric | null, defaults: LaunchSettings,
//     ads: { variantId, adNumber, headline, sizes: SizeId[], langs: PackLang[] }[]   (the picked ads
//       with at least one pack item, in the pack's order; sizes and langs are the
//       distinct values of those items, in the pack's order),
//     leftOut: { variantId, adNumber, headline, reason, reasons: string[] }[]   (picked ads with no
//       item; reasons are the pack's left-out reasons for the ad, distinct, in the
//       pack's order; reason is the first),
//     canAsk: boolean, reason: string | null   (NO_ELIGIBLE_ADS, LAUNCH_ALREADY_ASKED or
//       LAUNCH_ALREADY_LIVE when canAsk is false) }.
//   Nothing picked counts as no eligible ads (NO_ELIGIBLE_ADS), not a refusal.
// - requestLaunch(member, campaignId, request: LaunchRequest) => { launchId, approvalId }.
//   Order of refusals: campaign not found; not signed off; invalid settings (LaunchError
//   LAUNCH_NOT_VALID with problems); an id that isn't a picked ad of this campaign
//   (malformed, another campaign's, another workspace's: LAUNCH_AD_NOT_FOUND, the same
//   for each); a left-out ad of this campaign ("Ad <n> can't launch: <its reason>");
//   none eligible (NO_ELIGIBLE_ADS); the ids not exactly the eligible set
//   (LAUNCH_ADS_CHANGED); an open request (LAUNCH_ALREADY_ASKED); a live launch
//   (LAUNCH_ALREADY_LIVE). Sizes and langs come from the server's eligibility, never
//   the request. A random positive seed; the approval expires in 14 days. Two
//   requests at once make one launch (the index, or a lock).
// - decideLaunch(member, approvalId, "approved" | "refused", reason?) => { campaignId, launchId, status }.
//   Approve: approval approved, launch 'live' with approved_at. Refuse: the reason is
//   trimmed and cut to 500 characters, kept as plain text, and required
//   (REFUSAL_NEEDS_REASON); approval 'rejected', launch 'refused'. Anything not
//   open, or not the member's, is LAUNCH_REQUEST_NOT_OPEN.
// - endLaunch(member, launchId) => void: live only, sets status 'ended', ended_by,
//   ended_at; anything else, or not the member's, is LAUNCH_NOT_LIVE.
// - launchesFor(userId, campaignId): LaunchView[] (newest first) | null (a 404). LaunchView:
//   { id, campaignId, status, ads: {variantId, sizes, langs}[], dailyBudgetPence, days,
//     startsOn: "YYYY-MM-DD", kpiMeasure, kpiValue: number, seed: string, approvalId,
//     createdBy, createdAt, approvedAt, endedBy, endedByName (the person's email, as
//     compliance decisions name people), endedAt,
//     decision: { status: "pending" | "approved" | "rejected" | "expired", reason, decidedBy, decidedAt } }.
// - The campaign's own status (brief sign-off) is unchanged by a launch.
//
// src/lib/approvals/repo.ts: InboxItem gains { kind: "launch", id, question, createdAt,
// expiresAt, campaignId, launchId, brand: { id, name }, objective, ads (as launchEligibility's
// ads), dailyBudgetPence, days, startsOn, kpiMeasure, kpiValue }; listInbox and
// inboxCount count open launch requests.
//
// Server actions (each returns BriefActionState from src/app/(app)/campaigns/actions.ts,
// turning a LaunchError into { error, problems? }):
// - src/app/(app)/campaigns/[id]/launch-actions.ts: askToLaunch(campaignId, request: LaunchRequest),
//   endTheLaunch(campaignId, launchId).
// - src/app/(app)/approvals/launch-actions.ts: decideLaunchRequest(approvalId, "approved" | "refused", reason?).
//
// src/app/(app)/campaigns/[id]/launch-view.tsx: LaunchRefusal({ reason, by, at }), a
// component without hooks that shows a refusal ("Refused by <by>, <when>: <reason>"),
// used on the campaign's Launch (simulated) panel.
//
// The page labels (tests/e2e/launch.spec.ts): panel [data-launch-panel] with heading
// "Launch (simulated)"; [data-launch-ad] per ad; [data-launch-left-out] "Ad <n>: <reason>";
// [data-launch-reason]; fields "Daily budget (simulated £)", "Length in days", "Start date",
// "KPI measure" (option values as KPI_MEASURES), "Threshold"; [data-threshold-default]
// with SIMULATED_DEFAULT; button "Ask to launch"; [data-launch-status] "Waiting for
// approval" | "Live (simulated)" | "Ended" | "Refused"; [data-launch-summary] "<n> ads,
// £50 a day for 30 days from <date> (simulated)"; "End the launch", then a confirm with
// "Yes, end the launch" and "Keep it live"; [data-launch-ended] "Ended by <email> before its
// first simulated day." (or "on simulated day N of D." once P9-2's clock has run). Inbox:
// [data-inbox-item=launch] with a link to the campaign, its [data-launch-ad]s, "£50 a day",
// "30 days", the threshold's measure name, "Simulated: no real money is spent", and
// buttons "Approve" and "Refuse" (Refuse asks "Why not launch?", then "Refuse with this reason").
// ----------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ member: null as null | { id: string; email: string; userId: string; workspaceId: string } }));
vi.mock("@/lib/auth/session", () => ({
  requireMember: async () => {
    if (!session.member) throw new Error("No one is signed in for this test");
    return session.member;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, refresh: () => {} }));

import { decideLaunchRequest } from "@/app/(app)/approvals/launch-actions";
import { askToLaunch, endTheLaunch } from "@/app/(app)/campaigns/[id]/launch-actions";
import { LaunchRefusal } from "@/app/(app)/campaigns/[id]/launch-view";
import { inboxCount, listInbox } from "@/lib/approvals/repo";
import { insertImage, toWebp } from "@/lib/assets/store";
import { adCompliance, decideFinding } from "@/lib/compliance/compute";
import { clearSizeCache } from "@/lib/creative/ad-sizes";
import { DEMO_LANGUAGES, insertDemoLanguages } from "@/lib/creative/languages";
import { clearPackFitCache, planPack, type PackPlan } from "@/lib/creative/pack";
import { renderAd } from "@/lib/creative/render/render";
import { loadParts, renderInputFor, type KitSnapshot, type LayoutId } from "@/lib/creative/variants";
import { closeSql, getSql } from "@/lib/db/client";
import { asAnon, asUser } from "@/lib/db/scoped";
import { FERNHOLLOW } from "@/lib/demo/briefs";
import { drawMockImage } from "@/lib/models/mock-image";
import {
  DEFAULT_VALUES,
  defaultThreshold,
  decideLaunch,
  endLaunch,
  HEALTHY_WHEN,
  KPI_MEASURES,
  LAUNCH_AD_NOT_FOUND,
  LAUNCH_ADS_CHANGED,
  LAUNCH_ALREADY_ASKED,
  LAUNCH_ALREADY_LIVE,
  LAUNCH_CAMPAIGN_NOT_FOUND,
  LAUNCH_LIMITS,
  LAUNCH_NOT_LIVE,
  LAUNCH_NOT_VALID,
  LAUNCH_REASONS,
  LAUNCH_REQUEST_NOT_OPEN,
  launchDefaults,
  launchEligibility,
  LaunchError,
  launchesFor,
  NO_ELIGIBLE_ADS,
  NOT_SIGNED_OFF_LAUNCH,
  REFUSAL_NEEDS_REASON,
  requestLaunch,
  SIMULATED_DEFAULT,
  validateLaunchInput,
  type LaunchRequest,
  type LaunchSettings,
} from "@/lib/performance/launch";
import { createMember, truncateAll } from "../helpers/db";
import { checkedVision } from "../helpers/vision";

type Member = { userId: string; workspaceId: string };

const kit: KitSnapshot = { brandName: FERNHOLLOW.kit.name, palette: FERNHOLLOW.kit.palette, fontPrimary: FERNHOLLOW.kit.fontPrimary, fontSecondary: FERNHOLLOW.kit.fontSecondary, logo: { svg: FERNHOLLOW.kit.logoSvg } };
const EN = { headline: "Made for the long way round", body: "A three-layer shell for wet days on high ground, built to be mended rather than replaced.", cta: "Shop jackets" };
const DE = { headline: "Für den langen Weg gemacht", body: "Eine Jacke für nasse Tage am Berg, gemacht zum Flicken statt zum Ersetzen.", cta: "Jacken ansehen" };
// The mock Brief agent's KPI (src/lib/agents/brief.ts), so the default measure is cost per acquisition.
const brief = (title: string) => ({
  title,
  summary: "Bring walkers back for autumn.",
  story: "Walkers come back when the kit lasts.",
  insights: [1, 2, 3].map((n) => ({ text: `Walkers say reason ${n} matters.`, cites: [`note-${n}`] })),
  audiences: [],
  channels: [{ channel: "paid social", role: "Reach walkers." }],
  kpi: { metric: "reactivation rate" },
  mustInclude: [],
  avoid: [],
});
const SOCIAL = ["1080x1080", "1080x1350", "1080x1920", "1200x628"];

let a: Member;
let b: Member;
let aEmail: string;
let bEmail: string;
let ids: {
  main: string;
  /** Picked, its don't rules accepted, with a German translation. */
  ok1: string;
  /** Picked, accepted, English only. */
  ok2: string;
  /** Picked, a don't rule marked not acceptable (a fail). */
  failing: string;
  /** Picked, its don't rules waiting for a person. */
  waiting: string;
  /** Not picked (accepted): never in a launch. */
  unpicked: string;
  /** Another signed-off campaign of A's, and its picked, accepted ad. */
  other: string;
  otherAd: string;
  /** Never signed off, with a picked ad. */
  draft: string;
  draftAd: string;
  /** Signed off, then edited: back to draft, version 1 still the signed-off one. */
  edited: string;
  editedAd: string;
  /** Signed off, its only picked ad waiting on its don't rules. */
  none: string;
  noneAd: string;
};

/** Today in London, as the panel's default start date. */
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function brandFor(m: Member, slug: string) {
  return asUser(m.userId, async (tx) => {
    const [br] = await tx`insert into public.brands (workspace_id, name, slug, legal_lines, banned_terms, dont_rules, palette, font_primary, font_secondary, logo_svg, created_by, is_simulated)
      values (${m.workspaceId}, ${FERNHOLLOW.kit.name}, ${slug}, ${FERNHOLLOW.kit.legalLines}, ${FERNHOLLOW.kit.bannedTerms}, ${FERNHOLLOW.kit.dontRules},
              ${tx.json(FERNHOLLOW.kit.palette)}, ${FERNHOLLOW.kit.fontPrimary}, ${FERNHOLLOW.kit.fontSecondary}, ${FERNHOLLOW.kit.logoSvg}, ${m.userId}, true) returning id`;
    await insertDemoLanguages(tx, m, br.id as string, "fernhollow");
    return br.id as string;
  });
}

/** A campaign signed off at version 1, never signed off, or signed off and then edited to version 2. */
async function campaignFor(m: Member, brandId: string, state: "signed off" | "draft" | "edited", objective: string) {
  return asUser(m.userId, async (tx) => {
    const versions = state === "edited" ? 2 : 1;
    const [c] = await tx`insert into public.campaigns (workspace_id, brand_id, objective, created_by, current_version)
      values (${m.workspaceId}, ${brandId}, ${objective}, ${m.userId}, 1) returning id`;
    for (let v = 1; v <= versions; v++) {
      await tx`update public.campaigns set current_version = ${v} where id = ${c.id}`;
      await tx`insert into public.brief_versions (workspace_id, campaign_id, version, brief, source, created_by)
        values (${m.workspaceId}, ${c.id}, ${v}, ${tx.json(brief(`Long way round ${v}`))}, 'agent', ${m.userId})`;
    }
    if (state === "signed off") await tx`update public.campaigns set status = 'approved', approved_version = 1, approved_at = now(), approved_by = ${m.userId} where id = ${c.id}`;
    if (state === "edited") await tx`update public.campaigns set status = 'draft', approved_version = 1, approved_at = now(), approved_by = ${m.userId} where id = ${c.id}`;
    return c.id as string;
  });
}

/** Builds a campaign's picture, words and ads, as Make creative records them. */
function builder(m: Member, brandId: string, campaignId: string) {
  return {
    image: async (prompt: string) => {
      const webp = await toWebp(await drawMockImage({ prompt, palette: FERNHOLLOW.kit.palette.map((p) => p.hex), size: "2K" }));
      return asUser(m.userId, (tx) =>
        insertImage(tx, { workspaceId: m.workspaceId, userId: m.userId, brandId, campaignId, runId: null, webp, simulated: true, createdByKind: "agent", meta: { picture: 1, briefVersion: 1, idea: "A walker on a ridge", vision: checkedVision(FERNHOLLOW.kit.dontRules) } }),
      );
    },
    words: (headline: string, german = false) =>
      asUser(m.userId, async (tx) => {
        const [s] = await tx`insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by)
          values (${m.workspaceId}, ${campaignId}, 1, 'paid social', 'Walkers', ${tx.json({ ...EN, headline })}, ${FERNHOLLOW.kit.legalLines}, 'agent', ${m.userId}) returning id`;
        if (german) {
          await tx`insert into public.copy_sets (workspace_id, campaign_id, brief_version, channel, segment_title, set, legal_lines, source, created_by, lang, translated_from, simulated)
            values (${m.workspaceId}, ${campaignId}, 1, 'paid social', 'Walkers', ${tx.json(DE)}, ${DEMO_LANGUAGES.fernhollow["de-DE"].legalLines}, 'agent', ${m.userId}, 'de-DE', ${s.id}, true)`;
        }
        return s.id as string;
      }),
    ad: (image: string, setId: string, layout: LayoutId, picked: boolean) =>
      asUser(m.userId, async (tx) => {
        const parts = await loadParts(tx, image, setId, kit);
        const drawn = await renderAd(renderInputFor(parts!, layout));
        if ("refused" in drawn) throw new Error(drawn.refused);
        const [v] = await tx`insert into public.ad_variants (workspace_id, campaign_id, brief_version, image_asset_id, copy_set_id, layout, checks, kit, origin, created_by, picked_at)
          values (${m.workspaceId}, ${campaignId}, 1, ${image}, ${setId}, ${layout}, ${tx.json(drawn.checks as never)}, ${tx.json(kit as never)}, 'composed', ${m.userId}, ${picked ? new Date() : null}) returning id`;
        return v.id as string;
      }),
  };
}

/** Accepts (or marks not acceptable) every open review item on an ad, as a person does on its Compliance view. */
async function decideReviews(m: Member, variantId: string, decision: "accept" | "reject" = "accept") {
  const ad = (await adCompliance(m.userId, variantId))!;
  for (const f of [...ad.perAd, ...ad.items.flatMap((i) => i.findings)]) {
    if (f.outcome !== "review") continue;
    await decideFinding(m, variantId, { lang: f.lang, size: f.size, rule: f.key, hash: f.hash, decision, note: "Checked by hand" });
  }
}

/** Signs a member in for the server actions (requireMember is the only mock). */
function signedInAs(m: Member, email: string) {
  session.member = { id: m.userId, email, userId: m.userId, workspaceId: m.workspaceId };
}

async function eligible(userId: string, campaignId: string) {
  const e = await launchEligibility(userId, campaignId);
  if (!e || "refused" in e) throw new Error(`Expected an eligibility, got ${JSON.stringify(e)}`);
  return e;
}

/** The request the panel sends with its defaults: every eligible ad. */
async function defaultRequest(m: Member, campaignId: string): Promise<LaunchRequest> {
  const e = await eligible(m.userId, campaignId);
  return { ...e.defaults, variantIds: e.ads.map((x) => x.variantId) };
}

/** How a call was refused: whether as a LaunchError, and its message (null when it wasn't refused). */
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (x: unknown) => ({ launchError: x instanceof LaunchError, message: (x as Error).message }),
  );

const countLaunches = async (campaignId: string) => {
  const [r] = await getSql()`select count(*)::int as n from public.launches where campaign_id = ${campaignId}`;
  const [p] = await getSql()`select count(*)::int as n from public.approvals where campaign_id = ${campaignId} and kind = 'launch'`;
  return { launches: r.n as number, approvals: p.n as number };
};

/**
 * A launch written straight to the database as a member (with its approval,
 * decided as the status needs), for the tests of the table itself.
 */
async function rawLaunch(m: Member, campaignId: string, over: Record<string, unknown> = {}) {
  const status = (over.status as string | undefined) ?? "awaiting_approval";
  return asUser(m.userId, async (tx) => {
    const decided = status === "awaiting_approval" ? null : status === "refused" ? "rejected" : "approved";
    const [ap] = await tx`
      insert into public.approvals (workspace_id, kind, campaign_id, question, options, expires_at, status, decided_by, decided_at)
      values (${m.workspaceId}, 'launch', ${campaignId}, 'Launch (simulated)', '[]'::jsonb, now() + interval '14 days',
              ${decided ?? "pending"}, ${decided ? m.userId : null}, ${decided ? new Date() : null})
      returning id`;
    const row: Record<string, unknown> = {
      workspace_id: m.workspaceId,
      campaign_id: campaignId,
      ads: tx.json([{ variantId: ids.ok1, sizes: SOCIAL, langs: ["en-GB"] }]),
      daily_budget_pence: 5000,
      days: 30,
      starts_on: "2026-11-06",
      kpi_measure: "cpa",
      kpi_value: 20,
      seed: "42",
      status,
      approval_id: ap.id,
      created_by: m.userId,
      approved_at: status === "awaiting_approval" || status === "refused" ? null : new Date(),
      ended_by: status === "ended" ? m.userId : null,
      ended_at: status === "ended" ? new Date() : null,
      ...over,
    };
    const [l] = await tx`insert into public.launches ${tx(row as never)} returning id`;
    return { launchId: l.id as string, approvalId: ap.id as string };
  });
}

beforeAll(async () => {
  await truncateAll();
  a = await createMember();
  b = await createMember();
  [{ email: aEmail }] = await getSql()`select email from auth.users where id = ${a.userId}`;
  [{ email: bEmail }] = await getSql()`select email from auth.users where id = ${b.userId}`;
  const brand = await brandFor(a, "fernhollow");

  const main = await campaignFor(a, brand, "signed off", "Bring walkers back for autumn, launched in a simulation");
  const m = builder(a, brand, main);
  const image = await m.image("launch one");
  const ok1 = await m.ad(image, await m.words(EN.headline, true), "card", true);
  const ok2 = await m.ad(image, await m.words("Kit for the long way round"), "full-bleed", true);
  const failing = await m.ad(image, await m.words("Jackets for the high ground"), "split", true);
  const waiting = await m.ad(image, await m.words("Mend it, don't replace it"), "card", true);
  const unpicked = await m.ad(image, await m.words("Walk further this autumn"), "card", false);
  for (const v of [ok1, ok2, unpicked]) await decideReviews(a, v);
  await decideReviews(a, failing, "reject");

  const other = await campaignFor(a, brand, "signed off", "Another campaign of the same brand");
  const o = builder(a, brand, other);
  const otherAd = await o.ad(await o.image("launch other"), await o.words(EN.headline), "card", true);
  await decideReviews(a, otherAd);

  const draft = await campaignFor(a, brand, "draft", "A brief nobody has signed off");
  const d = builder(a, brand, draft);
  const draftAd = await d.ad(await d.image("launch draft"), await d.words(EN.headline), "card", true);

  const edited = await campaignFor(a, brand, "edited", "A brief edited after its sign-off");
  const e = builder(a, brand, edited);
  const editedAd = await e.ad(await e.image("launch edited"), await e.words(EN.headline), "card", true);

  const none = await campaignFor(a, brand, "signed off", "Signed off, but nothing passes yet");
  const n = builder(a, brand, none);
  const noneAd = await n.ad(await n.image("launch none"), await n.words(EN.headline), "card", true);

  ids = { main, ok1, ok2, failing, waiting, unpicked, other, otherAd, draft, draftAd, edited, editedAd, none, noneAd };
}, 300_000);

beforeEach(async () => {
  clearSizeCache();
  clearPackFitCache();
  session.member = null;
  // Each test starts with no launches (as the table's owner: the app can't delete them).
  await getSql()`delete from public.launches`;
  await getSql()`delete from public.approvals where kind = 'launch'`;
});
afterAll(closeSql);

describe("P9-1 the launch settings: defaults and limits", () => {
  it("#1 the defaults: £50 a day for 30 days from today, and the threshold the brief's KPI suggests, labelled as Studio's own simulated default", () => {
    expect(KPI_MEASURES).toEqual(["ctr", "conversion_rate", "cpa", "roas"]);
    expect(LAUNCH_LIMITS).toEqual({ budgetPence: { min: 500, max: 50_000, default: 5_000 }, days: { min: 7, max: 60, default: 30 }, startsOn: { min: "2026-01-01", max: "2027-12-31" } });
    expect(SIMULATED_DEFAULT).toBe("Studio's own simulated default, not a benchmark");
    expect(HEALTHY_WHEN).toEqual({ ctr: "at or above", conversion_rate: "at or above", cpa: "at or below", roas: "at or above" });
    // The refinement's table: the default measure from the brief's KPI; conversion rate is there for any KPI.
    const measureFor = {
      "click-through rate": "ctr",
      reach: "ctr",
      conversions: "cpa",
      "sign-ups": "cpa",
      "reactivation rate": "cpa",
      "cost per acquisition": "cpa",
      "return on ad spend": "roas",
      revenue: "roas",
    } as const;
    for (const [kpi, measure] of Object.entries(measureFor)) {
      expect(defaultThreshold(kpi as keyof typeof measureFor), kpi).toEqual({ measure, value: DEFAULT_VALUES[measure], healthyWhen: HEALTHY_WHEN[measure], label: SIMULATED_DEFAULT });
    }
    expect(defaultThreshold(null)).toEqual({ measure: "conversion_rate", value: DEFAULT_VALUES.conversion_rate, healthyWhen: "at or above", label: SIMULATED_DEFAULT });
    for (const m of KPI_MEASURES) expect(DEFAULT_VALUES[m], m).toBeGreaterThan(0);
    expect(launchDefaults("reactivation rate", new Date("2026-11-06T23:30:00Z"))).toEqual({ dailyBudgetPence: 5000, days: 30, startsOn: "2026-11-06", kpiMeasure: "cpa", kpiValue: DEFAULT_VALUES.cpa });
    // Today is London's: just after midnight in British Summer Time is still the day before in UTC.
    expect(launchDefaults("reach", new Date("2026-07-01T23:30:00Z")).startsOn).toBe("2026-07-02");
    // The defaults are themselves valid.
    expect(validateLaunchInput(launchDefaults("revenue"))).toEqual([]);
  });

  it("#4 out-of-range input is refused with a plain reason, and the limits themselves are allowed", () => {
    const ok: LaunchSettings = { dailyBudgetPence: 5000, days: 30, startsOn: "2026-11-06", kpiMeasure: "cpa", kpiValue: 20 };
    const R = LAUNCH_REASONS;
    expect(R).toEqual({
      budget: "The daily budget must be between £5 and £500 (simulated).",
      days: "A launch runs for 7 to 60 days.",
      startsOn: "The start date must be between 1 January 2026 and 31 December 2027.",
      measure: "Pick one of the four measures: click-through rate, conversion rate, cost per acquisition or return on ad spend.",
      threshold: "The threshold must be a number above 0.",
      percent: "A rate can't be more than 100%.",
    });
    const refused: [Partial<LaunchSettings>, string][] = [
      // The case's own examples: £0 or £501, 0 or 61 days, before 1 January 2026 or after 31 December 2027, a threshold of 0, a CTR over 100%.
      [{ dailyBudgetPence: 0 }, R.budget],
      [{ dailyBudgetPence: 50_100 }, R.budget],
      [{ days: 0 }, R.days],
      [{ days: 61 }, R.days],
      [{ startsOn: "2025-12-31" }, R.startsOn],
      [{ startsOn: "2028-01-01" }, R.startsOn],
      [{ kpiValue: 0 }, R.threshold],
      [{ kpiMeasure: "ctr", kpiValue: 100.5 }, R.percent],
      // Just outside the limits, and what a tampered form could send.
      [{ dailyBudgetPence: 499 }, R.budget],
      [{ dailyBudgetPence: 50_001 }, R.budget],
      [{ dailyBudgetPence: 5000.5 }, R.budget],
      [{ dailyBudgetPence: Number.NaN }, R.budget],
      [{ dailyBudgetPence: -5000 }, R.budget],
      [{ days: 6 }, R.days],
      [{ days: 7.5 }, R.days],
      [{ startsOn: "2026-02-30" }, R.startsOn],
      [{ startsOn: "6 November 2026" }, R.startsOn],
      [{ startsOn: "" }, R.startsOn],
      [{ kpiMeasure: "clicks" }, R.measure],
      [{ kpiMeasure: "" }, R.measure],
      [{ kpiValue: -1 }, R.threshold],
      [{ kpiValue: Number.NaN }, R.threshold],
      [{ kpiValue: Number.POSITIVE_INFINITY }, R.threshold],
      [{ kpiMeasure: "conversion_rate", kpiValue: 101 }, R.percent],
    ];
    for (const [change, reason] of refused) expect(validateLaunchInput({ ...ok, ...change }), JSON.stringify(change)).toEqual([reason]);
    // The limits themselves, and a CTR of exactly 100%; a cost per acquisition or a return on ad spend has no 100 cap.
    const allowed: Partial<LaunchSettings>[] = [
      { dailyBudgetPence: 500 },
      { dailyBudgetPence: 50_000 },
      { dailyBudgetPence: 1234 },
      { days: 7 },
      { days: 60 },
      { startsOn: "2026-01-01" },
      { startsOn: "2027-12-31" },
      { startsOn: "2027-02-28" },
      { startsOn: "2026-11-06" },
      { kpiMeasure: "ctr", kpiValue: 100 },
      { kpiMeasure: "ctr", kpiValue: 0.5 },
      { kpiMeasure: "conversion_rate", kpiValue: 2.5 },
      { kpiMeasure: "cpa", kpiValue: 150 },
      { kpiMeasure: "roas", kpiValue: 12 },
    ];
    for (const change of allowed) expect(validateLaunchInput({ ...ok, ...change }), JSON.stringify(change)).toEqual([]);
    // Several at once: every reason, in the form's order.
    expect(validateLaunchInput({ dailyBudgetPence: 0, days: 61, startsOn: "2028-01-01", kpiMeasure: "ctr", kpiValue: 0 })).toEqual([R.budget, R.days, R.startsOn, R.threshold]);
    // Plain English: no code words, no pence, no NaN.
    for (const r of Object.values(R)) expect(r).not.toMatch(/NaN|null|undefined|constraint|pence|kpi_|_/i);
  });
});

describe("P9-1 Launch a simulated campaign", () => {
  it("#1 Ask to launch with the defaults, then Approve in the inbox: the launch is live with exactly the eligible ads, £50 a day for 30 days", async () => {
    const e = await eligible(a.userId, ids.main);
    expect(e).toMatchObject({ campaignId: ids.main, briefKpi: "reactivation rate", canAsk: true, reason: null });
    expect(e.defaults).toEqual({ dailyBudgetPence: 5000, days: 30, startsOn: londonToday(), kpiMeasure: "cpa", kpiValue: DEFAULT_VALUES.cpa });
    const before = await inboxCount(a.userId);
    const { launchId, approvalId } = await requestLaunch(a, ids.main, { ...e.defaults, variantIds: e.ads.map((x) => x.variantId) });

    const [asked] = (await launchesFor(a.userId, ids.main))!;
    expect(asked).toMatchObject({
      id: launchId,
      campaignId: ids.main,
      status: "awaiting_approval",
      approvalId,
      dailyBudgetPence: 5000,
      days: 30,
      startsOn: londonToday(),
      kpiMeasure: "cpa",
      kpiValue: DEFAULT_VALUES.cpa,
      createdBy: a.userId,
      approvedAt: null,
      endedBy: null,
      endedAt: null,
      decision: { status: "pending", reason: null, decidedBy: null, decidedAt: null },
    });
    // The ads, their sizes and languages are the eligibility's, which is the pack's.
    expect(asked.ads).toEqual(e.ads.map((x) => ({ variantId: x.variantId, sizes: x.sizes, langs: x.langs })));
    expect(asked.seed).toMatch(/^[1-9]\d*$/);

    // The inbox lists it, with what the person approves.
    expect(await inboxCount(a.userId)).toBe(before + 1);
    const item = (await listInbox(a.userId)).find((i) => i.id === approvalId);
    expect(item).toMatchObject({ kind: "launch", campaignId: ids.main, launchId, dailyBudgetPence: 5000, days: 30, startsOn: londonToday(), kpiMeasure: "cpa", kpiValue: DEFAULT_VALUES.cpa, brand: { name: FERNHOLLOW.kit.name } });
    expect(item && "ads" in item ? item.ads.map((x: { variantId: string }) => x.variantId) : null).toEqual([ids.ok1, ids.ok2]);
    expect(((item!.expiresAt.getTime() - item!.createdAt.getTime()) / 86_400_000)).toBeCloseTo(14, 0);

    // Approve: live, with when; out of the inbox; the brief's own sign-off is untouched.
    expect(await decideLaunch(a, approvalId, "approved")).toEqual({ campaignId: ids.main, launchId, status: "live" });
    const [live] = (await launchesFor(a.userId, ids.main))!;
    expect(live).toMatchObject({ id: launchId, status: "live", decision: { status: "approved", decidedBy: a.userId } });
    expect(live.approvedAt).toBeInstanceOf(Date);
    expect(live.ads).toEqual(asked.ads);
    expect(await inboxCount(a.userId)).toBe(before);
    const [c] = await getSql()`select status, approved_version from public.campaigns where id = ${ids.main}`;
    expect(c).toEqual({ status: "approved", approved_version: 1 });
    expect(await eligible(a.userId, ids.main)).toMatchObject({ canAsk: false, reason: LAUNCH_ALREADY_LIVE });
  });

  it("#1 through the server actions: Ask to launch, then Approve, as the signed-in person", async () => {
    signedInAs(a, aEmail);
    const asked = await askToLaunch(ids.main, await defaultRequest(a, ids.main));
    expect(asked).toMatchObject({ done: expect.any(String) });
    const [l] = (await launchesFor(a.userId, ids.main))!;
    expect(l.status).toBe("awaiting_approval");
    expect(await decideLaunchRequest(l.approvalId, "approved")).toMatchObject({ done: expect.any(String) });
    expect((await launchesFor(a.userId, ids.main))![0].status).toBe("live");
  });

  it("#2 the launch's ads are the pack's: an ad is in when the pack has a file for it, with those sizes and languages; a fail or an unaccepted review is left out with the pack's reason", async () => {
    const plan = (await planPack(a.userId, ids.main)) as PackPlan;
    expect("items" in plan).toBe(true);
    const e = await eligible(a.userId, ids.main);
    const distinct = <T,>(xs: T[]) => [...new Set(xs)];

    // In: the picked ads the pack holds a file for, in the pack's order, with the pack's sizes and languages.
    const inPack = distinct(plan.items.map((i) => i.adId));
    expect(e.ads.map((x) => x.variantId)).toEqual(inPack);
    expect(e.ads.map((x) => x.variantId)).toEqual([ids.ok1, ids.ok2]);
    for (const ad of e.ads) {
      const items = plan.items.filter((i) => i.adId === ad.variantId);
      const planned = plan.ads.find((x) => x.id === ad.variantId)!;
      expect(ad, ad.variantId).toMatchObject({ adNumber: planned.number, headline: planned.headline, sizes: distinct(items.map((i) => i.size)), langs: distinct(items.map((i) => i.lang)) });
    }
    // Ad 1 is translated into German; ad 2 is English only. Every social size fits both.
    expect(e.ads[0]).toMatchObject({ sizes: SOCIAL, langs: ["en-GB", "de-DE"] });
    expect(e.ads[1]).toMatchObject({ sizes: SOCIAL, langs: ["en-GB"] });

    // Out: the ad marked not acceptable and the one still waiting, each with the pack's reason; the unpicked ad is neither.
    expect(e.leftOut.map((x) => x.variantId)).toEqual([ids.failing, ids.waiting]);
    for (const lo of e.leftOut) {
      const reasons = distinct(plan.leftOut.filter((l) => l.adId === lo.variantId).map((l) => l.reason));
      expect(lo.reasons, lo.variantId).toEqual(reasons);
      expect(lo.reason).toBe(reasons[0]);
      expect(lo.adNumber).toBe(plan.ads.find((x) => x.id === lo.variantId)!.number);
    }
    expect(e.leftOut[0].reason).toMatch(new RegExp(`^Fails: don't rule ".+", marked not acceptable by ${aEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.$`));
    expect(e.leftOut[1].reason).toMatch(/^Awaiting review: don't rule/);
    expect([...e.ads, ...e.leftOut].map((x) => x.variantId)).not.toContain(ids.unpicked);
    expect(e.canAsk).toBe(true);

    // Change the compliance, and the launch's list changes with the pack's: the waiting ad accepted joins it.
    await decideReviews(a, ids.waiting);
    try {
      clearPackFitCache();
      const after = await eligible(a.userId, ids.main);
      const afterPlan = (await planPack(a.userId, ids.main)) as PackPlan;
      expect(after.ads.map((x) => x.variantId)).toEqual(distinct(afterPlan.items.map((i) => i.adId)));
      expect(after.ads.map((x) => x.variantId)).toContain(ids.waiting);
      expect(after.leftOut.map((x) => x.variantId)).toEqual([ids.failing]);
    } finally {
      // Back to waiting: a decision is kept against the ad's hash, so a layout switch there and back would also reset it;
      // here the decisions are removed as the table's owner, so later tests see the ad waiting again.
      await getSql()`delete from public.compliance_decisions where variant_id = ${ids.waiting}`;
    }
  });

  it("#2 with no eligible ads, Ask to launch is refused: No picked ads pass compliance yet", async () => {
    expect(NO_ELIGIBLE_ADS).toBe("No picked ads pass compliance yet");
    const e = await eligible(a.userId, ids.none);
    expect(e).toMatchObject({ ads: [], canAsk: false, reason: NO_ELIGIBLE_ADS });
    expect(e.leftOut.map((x) => [x.variantId, x.reason])).toEqual([[ids.noneAd, expect.stringMatching(/^Awaiting review: don't rule/)]]);
    const request = { ...e.defaults, variantIds: [ids.noneAd] };
    // The left-out ad itself is refused with its reason; with nothing at all, the message is the panel's.
    await expect(requestLaunch(a, ids.none, request)).rejects.toThrow(`Ad ${e.leftOut[0].adNumber} can't launch: ${e.leftOut[0].reason}`);
    await expect(requestLaunch(a, ids.none, { ...request, variantIds: [] })).rejects.toThrow(NO_ELIGIBLE_ADS);
    signedInAs(a, aEmail);
    expect(await askToLaunch(ids.none, { ...request, variantIds: [] })).toEqual({ error: NO_ELIGIBLE_ADS });
    expect(await countLaunches(ids.none)).toEqual({ launches: 0, approvals: 0 });
  });

  it("#3 a campaign whose brief isn't signed off can't ask to launch: the panel says why, and the server action refuses", async () => {
    expect(NOT_SIGNED_OFF_LAUNCH).toBe("A campaign can launch only once its brief is signed off.");
    signedInAs(a, aEmail);
    for (const [campaign, ad] of [
      [ids.draft, ids.draftAd],
      [ids.edited, ids.editedAd],
    ]) {
      // The panel: the reason, and no form.
      expect(await launchEligibility(a.userId, campaign), campaign).toEqual({ refused: NOT_SIGNED_OFF_LAUNCH });
      // The server: refused before anything is stored, whatever the request says.
      const request: LaunchRequest = { ...launchDefaults("reach"), variantIds: [ad] };
      await expect(requestLaunch(a, campaign, request)).rejects.toThrow(NOT_SIGNED_OFF_LAUNCH);
      expect(await askToLaunch(campaign, request)).toEqual({ error: NOT_SIGNED_OFF_LAUNCH });
      expect(await countLaunches(campaign)).toEqual({ launches: 0, approvals: 0 });
    }
  });

  it("#4 the action refuses out-of-range input with every reason and stores nothing; the database refuses it too", async () => {
    signedInAs(a, aEmail);
    const good = await defaultRequest(a, ids.main);
    const r = await askToLaunch(ids.main, { ...good, dailyBudgetPence: 50_100, days: 0, kpiMeasure: "ctr", kpiValue: 101 });
    expect(r).toEqual({ error: LAUNCH_NOT_VALID, problems: [LAUNCH_REASONS.budget, LAUNCH_REASONS.days, LAUNCH_REASONS.percent] });
    const thrown = await requestLaunch(a, ids.main, { ...good, startsOn: "2028-01-01" }).catch((x: unknown) => x);
    expect(thrown).toBeInstanceOf(LaunchError);
    expect((thrown as LaunchError).message).toBe(LAUNCH_NOT_VALID);
    expect((thrown as LaunchError).problems).toEqual([LAUNCH_REASONS.startsOn]);
    expect(await countLaunches(ids.main)).toEqual({ launches: 0, approvals: 0 });

    // Straight to the database: the same limits are check constraints.
    for (const over of [
      { daily_budget_pence: 0 },
      { daily_budget_pence: 50_100 },
      { days: 0 },
      { days: 61 },
      { starts_on: "2025-12-31" },
      { starts_on: "2028-01-01" },
      { kpi_value: 0 },
      { kpi_measure: "ctr", kpi_value: 100.5 },
      { kpi_measure: "conversion_rate", kpi_value: 101 },
      { kpi_measure: "clicks" },
      { status: "paused" },
    ]) {
      await expect(rawLaunch(a, ids.main, over), JSON.stringify(over)).rejects.toMatchObject({ code: "23514" });
    }
    // The limits themselves are allowed.
    await expect(rawLaunch(a, ids.main, { daily_budget_pence: 50_000, days: 60, starts_on: "2027-12-31", kpi_measure: "ctr", kpi_value: 100 })).resolves.toMatchObject({ launchId: expect.any(String) });
  });

  it("#4 a tampered request with another campaign's ad is refused like a 404, and stores nothing", async () => {
    expect(LAUNCH_AD_NOT_FOUND).toBe("That ad isn't in this campaign.");
    signedInAs(a, aEmail);
    const good = await defaultRequest(a, ids.main);
    const e = await eligible(a.userId, ids.main);
    // Another campaign's ad (A's own), a made-up id and a malformed one: the same refusal.
    for (const extra of [ids.otherAd, randomUUID(), "not-an-id", "1' or '1'='1", ids.unpicked]) {
      const request = { ...good, variantIds: [...good.variantIds, extra] };
      await expect(requestLaunch(a, ids.main, request), extra).rejects.toThrow(LAUNCH_AD_NOT_FOUND);
      expect(await askToLaunch(ids.main, request), extra).toEqual({ error: LAUNCH_AD_NOT_FOUND });
    }
    expect(await askToLaunch(ids.main, { ...good, variantIds: [ids.otherAd] })).toEqual({ error: LAUNCH_AD_NOT_FOUND });
    // A left-out ad of this campaign: refused with its reason, as the panel shows it.
    const failing = e.leftOut.find((x) => x.variantId === ids.failing)!;
    expect(await askToLaunch(ids.main, { ...good, variantIds: [...good.variantIds, ids.failing] })).toEqual({ error: `Ad ${failing.adNumber} can't launch: ${failing.reason}` });
    // Fewer ads than can launch (the page was open while an ad changed): reload.
    expect(await askToLaunch(ids.main, { ...good, variantIds: [ids.ok1] })).toEqual({ error: LAUNCH_ADS_CHANGED });
    // A campaign that isn't there, or is another workspace's: the same as a missing one.
    const missing = await askToLaunch(randomUUID(), good);
    expect(missing).toEqual({ error: LAUNCH_CAMPAIGN_NOT_FOUND });
    expect(await askToLaunch("../../etc/passwd", good)).toEqual(missing);
    signedInAs(b, bEmail);
    expect(await askToLaunch(ids.main, good)).toEqual(missing);
    expect(await countLaunches(ids.main)).toEqual({ launches: 0, approvals: 0 });
    // Sizes and languages are the server's: the request carries none, and a launch asked for properly has the pack's.
    signedInAs(a, aEmail);
    const tampered = { ...good, sizes: ["300x250"], langs: ["xx-XX"], ads: [{ variantId: ids.otherAd, sizes: [], langs: [] }] } as LaunchRequest;
    expect(await askToLaunch(ids.main, tampered)).toMatchObject({ done: expect.any(String) });
    expect((await launchesFor(a.userId, ids.main))![0].ads).toEqual(e.ads.map((x) => ({ variantId: x.variantId, sizes: x.sizes, langs: x.langs })));
  });

  it("#5 Refuse in the inbox leaves the campaign unlaunched, with the refusal and its reason; it can be asked for again", async () => {
    const { launchId, approvalId } = await requestLaunch(a, ids.main, await defaultRequest(a, ids.main));
    // A reason is needed.
    await expect(decideLaunch(a, approvalId, "refused", "   ")).rejects.toThrow(REFUSAL_NEEDS_REASON);
    await expect(decideLaunch(a, approvalId, "refused")).rejects.toThrow(REFUSAL_NEEDS_REASON);
    expect(await decideLaunch(a, approvalId, "refused", "  Wait for the spring range  ")).toEqual({ campaignId: ids.main, launchId, status: "refused" });
    const [l] = (await launchesFor(a.userId, ids.main))!;
    expect(l).toMatchObject({ id: launchId, status: "refused", approvedAt: null, decision: { status: "rejected", reason: "Wait for the spring range", decidedBy: a.userId } });
    expect(l.decision.decidedAt).toBeInstanceOf(Date);
    // Not launched: nothing live, nothing in the inbox, and a decided request stays decided.
    expect((await launchesFor(a.userId, ids.main))!.filter((x) => x.status === "live")).toEqual([]);
    expect((await listInbox(a.userId)).some((i) => i.id === approvalId)).toBe(false);
    await expect(decideLaunch(a, approvalId, "approved")).rejects.toThrow(LAUNCH_REQUEST_NOT_OPEN);
    expect((await launchesFor(a.userId, ids.main))![0].status).toBe("refused");
    // Asked again: a new request, and the refused one stays in the history.
    const again = await requestLaunch(a, ids.main, await defaultRequest(a, ids.main));
    expect(again.launchId).not.toBe(launchId);
    expect((await launchesFor(a.userId, ids.main))!.map((x) => [x.id, x.status])).toEqual([
      [again.launchId, "awaiting_approval"],
      [launchId, "refused"],
    ]);
    // Through the inbox's action, as the person.
    signedInAs(a, aEmail);
    expect(await decideLaunchRequest(again.approvalId, "refused", "")).toEqual({ error: REFUSAL_NEEDS_REASON });
    expect(await decideLaunchRequest(again.approvalId, "refused", "Not this month")).toMatchObject({ done: expect.any(String) });
    expect((await launchesFor(a.userId, ids.main))![0]).toMatchObject({ status: "refused", decision: { reason: "Not this month" } });
  });

  it("#5 a second Ask to launch while one is open is refused, in the app and by the database's indexes", async () => {
    const request = await defaultRequest(a, ids.main);
    const first = await requestLaunch(a, ids.main, request);
    await expect(requestLaunch(a, ids.main, request)).rejects.toThrow(LAUNCH_ALREADY_ASKED);
    expect(await eligible(a.userId, ids.main)).toMatchObject({ canAsk: false, reason: LAUNCH_ALREADY_ASKED });
    signedInAs(a, aEmail);
    expect(await askToLaunch(ids.main, request)).toEqual({ error: LAUNCH_ALREADY_ASKED });
    expect(await countLaunches(ids.main)).toEqual({ launches: 1, approvals: 1 });
    // Live: no second launch while it runs.
    await decideLaunch(a, first.approvalId, "approved");
    await expect(requestLaunch(a, ids.main, request)).rejects.toThrow(LAUNCH_ALREADY_LIVE);
    expect(await countLaunches(ids.main)).toEqual({ launches: 1, approvals: 1 });
    // The database holds the line even without the app: one open and one live launch per campaign.
    await expect(rawLaunch(a, ids.main, { status: "live" })).rejects.toMatchObject({ code: "23505" });
    await rawLaunch(a, ids.other);
    await expect(rawLaunch(a, ids.other)).rejects.toMatchObject({ code: "23505" });
    // Ended or refused launches don't count.
    await rawLaunch(a, ids.other, { status: "ended" });
    await rawLaunch(a, ids.other, { status: "ended" });
    await rawLaunch(a, ids.other, { status: "refused" });
  });

  it("#5 two Ask to launch clicks at once make one launch request", async () => {
    const request = await defaultRequest(a, ids.main);
    const results = await Promise.allSettled([requestLaunch(a, ids.main, request), requestLaunch(a, ids.main, request)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(LaunchError);
    expect((failed.reason as Error).message).toBe(LAUNCH_ALREADY_ASKED);
    expect(await countLaunches(ids.main)).toEqual({ launches: 1, approvals: 1 });
  });

  it("#6 an approved launch's budget, ads and threshold can't be changed, even by an update straight to the database", async () => {
    const { launchId, approvalId } = await requestLaunch(a, ids.main, await defaultRequest(a, ids.main));
    // Before approval the row isn't guarded (the app never changes it, but the trigger allows it).
    await getSql()`update public.launches set daily_budget_pence = 6000 where id = ${launchId}`;
    await getSql()`update public.launches set daily_budget_pence = 5000 where id = ${launchId}`;
    await decideLaunch(a, approvalId, "approved");
    const [before] = (await launchesFor(a.userId, ids.main))!;

    const changes: [string, string][] = [
      ["ads", `'[]'::jsonb`],
      ["ads", `jsonb_build_array(jsonb_build_object('variantId', '${ids.otherAd}', 'sizes', jsonb_build_array('1080x1080'), 'langs', jsonb_build_array('en-GB')))`],
      ["daily_budget_pence", "10000"],
      ["days", "60"],
      ["starts_on", "'2027-01-01'"],
      ["kpi_measure", "'roas'"],
      ["kpi_value", "1"],
      ["seed", "seed + 1"],
    ];
    const guarded = /can't change once it is approved/;
    const attempt = (run: (q: string) => Promise<unknown>, column: string, value: string) => run(`update public.launches set ${column} = ${value} where id = '${launchId}'`);
    for (const status of ["live", "ended"] as const) {
      if (status === "ended") await endLaunch(a, launchId);
      for (const [column, value] of changes) {
        // As the member, through row-level security, and as the table's owner: the trigger refuses both.
        await expect(asUser(a.userId, (tx) => attempt((q) => tx.unsafe(q), column, value)), `${status} ${column} as the member`).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(guarded) });
        await expect(attempt((q) => getSql().unsafe(q), column, value), `${status} ${column} as the owner`).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(guarded) });
      }
    }
    // Nothing changed but the status.
    const [after] = (await launchesFor(a.userId, ids.main))!;
    const kept = (l: typeof before) => ({ ads: l.ads, dailyBudgetPence: l.dailyBudgetPence, days: l.days, startsOn: l.startsOn, kpiMeasure: l.kpiMeasure, kpiValue: l.kpiValue, seed: l.seed });
    expect(after.status).toBe("ended");
    expect(kept(after)).toEqual(kept(before));

    // A refused launch is guarded too.
    const refused = await rawLaunch(a, ids.other, { status: "refused" });
    await expect(getSql()`update public.launches set daily_budget_pence = 6000 where id = ${refused.launchId}`).rejects.toMatchObject({ code: "42501" });

    // The launch's approval is decided, and approvals_guard keeps it so.
    await expect(getSql()`update public.approvals set reason = 'changed later' where id = ${approvalId}`).rejects.toThrow(/A decided approval cannot be changed/);
    await expect(getSql()`update public.approvals set campaign_id = ${ids.other} where id = ${approvalId}`).rejects.toThrow(/subject cannot be changed/);
    // A launch approval must be about a campaign, and nothing else; an unknown kind is refused.
    const approval = (kind: string, campaignId: string | null, briefVersion: number | null) =>
      asUser(a.userId, (tx) => tx`insert into public.approvals (workspace_id, kind, campaign_id, brief_version, question, options, expires_at)
        values (${a.workspaceId}, ${kind}, ${campaignId}, ${briefVersion}, 'x', '[]'::jsonb, now() + interval '1 day')`);
    await expect(approval("launch", null, null)).rejects.toMatchObject({ code: "23514" });
    await expect(approval("launch", ids.other, 1)).rejects.toMatchObject({ code: "23514" });
    await expect(approval("rocket", ids.other, null)).rejects.toMatchObject({ code: "23514" });
  });

  it("#7 End the launch records who ended it and when; only a live launch can end, and the campaign can launch again", async () => {
    expect(LAUNCH_NOT_LIVE).toBe("There's no live launch to end.");
    const { launchId, approvalId } = await requestLaunch(a, ids.main, await defaultRequest(a, ids.main));
    // Not live yet: nothing to end.
    await expect(endLaunch(a, launchId)).rejects.toThrow(LAUNCH_NOT_LIVE);
    await decideLaunch(a, approvalId, "approved");
    signedInAs(a, aEmail);
    expect(await endTheLaunch(ids.main, launchId)).toMatchObject({ done: expect.any(String) });
    const [l] = (await launchesFor(a.userId, ids.main))!;
    expect(l).toMatchObject({ id: launchId, status: "ended", endedBy: a.userId, endedByName: aEmail });
    expect(l.endedAt).toBeInstanceOf(Date);
    expect(l.endedAt!.getTime()).toBeGreaterThanOrEqual(l.approvedAt!.getTime());
    // Ended once: a second End changes nothing.
    await expect(endLaunch(a, launchId)).rejects.toThrow(LAUNCH_NOT_LIVE);
    expect(await endTheLaunch(ids.main, launchId)).toEqual({ error: LAUNCH_NOT_LIVE });
    expect((await launchesFor(a.userId, ids.main))![0].endedAt).toEqual(l.endedAt);
    // The campaign can ask again.
    expect(await eligible(a.userId, ids.main)).toMatchObject({ canAsk: true, reason: null });
  });

  it("#8 another workspace can't see, approve or end a launch: the same refusal as a missing one, and RLS in the database", async () => {
    const { launchId, approvalId } = await requestLaunch(a, ids.main, await defaultRequest(a, ids.main));

    // Through the app, as B: the campaign, its eligibility and its launches are a 404; B's inbox doesn't list it.
    expect(await launchesFor(b.userId, ids.main)).toBeNull();
    expect(await launchEligibility(b.userId, ids.main)).toBeNull();
    expect(await launchEligibility(a.userId, "not-an-id")).toBeNull();
    expect((await listInbox(b.userId)).some((i) => i.id === approvalId)).toBe(false);
    expect(await inboxCount(b.userId)).toBe(0);
    // Approving or refusing A's request: the same refusal as a request that isn't there.
    const missing = await refusal(decideLaunch(b, randomUUID(), "approved"));
    expect(missing).toEqual({ launchError: true, message: LAUNCH_REQUEST_NOT_OPEN });
    for (const decision of ["approved", "refused"] as const) {
      expect(await refusal(decideLaunch(b, approvalId, decision, "Not mine to refuse")), decision).toEqual(missing);
    }
    signedInAs(b, bEmail);
    expect(await decideLaunchRequest(approvalId, "approved")).toEqual({ error: LAUNCH_REQUEST_NOT_OPEN });
    expect(await decideLaunchRequest("not-an-id", "approved")).toEqual({ error: LAUNCH_REQUEST_NOT_OPEN });
    expect((await launchesFor(a.userId, ids.main))![0]).toMatchObject({ status: "awaiting_approval", decision: { status: "pending" } });

    // Live, B can't end it: the same refusal as a launch that isn't there.
    await decideLaunch(a, approvalId, "approved");
    const noLaunch = await refusal(endLaunch(b, randomUUID()));
    expect(noLaunch).toEqual({ launchError: true, message: LAUNCH_NOT_LIVE });
    expect(await refusal(endLaunch(b, launchId))).toEqual(noLaunch);
    expect(await endTheLaunch(ids.main, launchId)).toEqual({ error: LAUNCH_NOT_LIVE });
    expect((await launchesFor(a.userId, ids.main))![0]).toMatchObject({ status: "live", endedBy: null });

    // In the database, as B: no rows to read or change, and none can be written into A's workspace or about A's campaign.
    expect(await asUser(b.userId, (tx) => tx`select id from public.launches`)).toHaveLength(0);
    expect((await asUser(b.userId, (tx) => tx`update public.launches set status = 'ended' where id = ${launchId}`)).count).toBe(0);
    expect((await asUser(b.userId, (tx) => tx`update public.approvals set status = 'rejected' where id = ${approvalId}`)).count).toBe(0);
    const insertAs = (workspaceId: string) =>
      asUser(b.userId, (tx) => tx`
        insert into public.launches (workspace_id, campaign_id, ads, daily_budget_pence, days, starts_on, kpi_measure, kpi_value, seed, status, approval_id, created_by)
        values (${workspaceId}, ${ids.main}, ${tx.json([{ variantId: ids.ok1, sizes: SOCIAL, langs: ["en-GB"] }])}, 5000, 30, '2026-11-06', 'cpa', 20, 7, 'awaiting_approval', ${approvalId}, ${b.userId})`);
    await expect(insertAs(a.workspaceId)).rejects.toThrow(/row-level security/);
    await expect(insertAs(b.workspaceId)).rejects.toMatchObject({ code: "23503" });
    // Nobody deletes a launch through the app, and the anonymous role has no access at all.
    await expect(asUser(a.userId, (tx) => tx`delete from public.launches where id = ${launchId}`)).rejects.toThrow(/permission denied/);
    expect(await asAnon((tx) => tx`select has_table_privilege('anon', 'public.launches', 'select') as ok`)).toEqual([{ ok: false }]);
    // A's launch is as it was.
    expect((await launchesFor(a.userId, ids.main))![0]).toMatchObject({ id: launchId, status: "live" });
  });

  it("#9 hostile: a refusal reason of 2,000 characters with <script> is capped at 500, kept as plain text and shown as text", async () => {
    const hostile = `<script>alert("x")</script>${"r".repeat(2000 - 27)}`;
    expect(hostile).toHaveLength(2000);
    // Through the inbox's action, as the person.
    const first = await requestLaunch(a, ids.main, await defaultRequest(a, ids.main));
    signedInAs(a, aEmail);
    expect(await decideLaunchRequest(first.approvalId, "refused", hostile)).toMatchObject({ done: expect.any(String) });
    const [l] = (await launchesFor(a.userId, ids.main))!;
    expect(l.status).toBe("refused");
    expect(l.decision.reason).toHaveLength(500);
    expect(l.decision.reason).toBe(hostile.slice(0, 500));
    // Stored as the person wrote it, not escaped or rewritten: escaping is the page's job.
    const [row] = await getSql()`select reason from public.approvals where id = ${first.approvalId}`;
    expect(row.reason).toBe(hostile.slice(0, 500));
    // Through decideLaunch too.
    const second = await requestLaunch(a, ids.main, await defaultRequest(a, ids.main));
    await decideLaunch(a, second.approvalId, "refused", hostile);
    expect((await launchesFor(a.userId, ids.main))![0].decision.reason).toBe(hostile.slice(0, 500));

    // Shown as text: the markup is escaped, never a script element.
    const html = renderToStaticMarkup(createElement(LaunchRefusal, { reason: l.decision.reason!, by: aEmail, at: l.decision.decidedAt }));
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(aEmail);
  });
});
