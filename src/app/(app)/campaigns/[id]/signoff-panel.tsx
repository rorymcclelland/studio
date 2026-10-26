// S4-1: where the brief stands with sign-off, and what can be done about it.
import type { SignoffState } from "@/lib/approvals/repo";
import { Card, type CardTone } from "@/components/ui/card";
import { formatDay } from "@/components/format-day";
import { Pill, type PillTone } from "@/components/ui/pill";
import { TextLink } from "@/components/ui/button";
import { SignoffDecision } from "../../approvals/signoff-decision";
import { SendForSignoffButton, WithdrawSignoffButton } from "./signoff-actions";

/** A market note cited by the current brief that is getting old for a sign-off. */
export type OldMarketSource = { title: string; checkedAt: Date | string; days: number };

export const MARKET_WARNING_DAYS = 30;

function describe(state: SignoffState, currentVersion: number): { text: string; tone: PillTone; card: CardTone } {
  if (state.status === "awaiting_signoff" && state.open) {
    return { text: `Waiting for sign-off, closes ${formatDay(state.open.expiresAt)}`, tone: "review", card: "review" };
  }
  if (state.approvedVersion !== null && state.approvedVersion === currentVersion) {
    const on = state.approvedAt ? ` on ${formatDay(state.approvedAt)}` : "";
    return { text: `Signed off: version ${state.approvedVersion}${on}`, tone: "good", card: "good" };
  }
  if (state.approvedVersion !== null) {
    return {
      text: `Signed off: version ${state.approvedVersion}; version ${currentVersion} not yet signed off`,
      tone: "review",
      card: "plain",
    };
  }
  return { text: "Draft", tone: "neutral", card: "plain" };
}

export function SignoffPanel({
  campaignId,
  currentVersion,
  state,
  oldMarketSources,
}: {
  campaignId: string;
  currentVersion: number;
  state: SignoffState;
  oldMarketSources: OldMarketSource[];
}) {
  const { text, tone, card } = describe(state, currentVersion);
  const waiting = state.status === "awaiting_signoff" && !!state.open;
  const signedOffNow = state.approvedVersion === currentVersion;
  return (
    <Card as="section" aria-labelledby="signoff" tone={card} data-signoff-panel="" className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
        <h2 id="signoff" className="text-xl font-strong tracking-tight">
          Sign-off
        </h2>
        <Pill tone={tone} dot wrap className="self-start sm:self-auto">
          <span data-signoff-status="">{text}</span>
        </Pill>
      </div>

      {state.note && !waiting && (
        <p className="max-w-prose rounded-field bg-bg px-4 py-3 wrap-anywhere" data-signoff-note="">
          {state.note}
        </p>
      )}

      {waiting && state.open && (
        <p className="max-w-prose text-ink-2">
          Version {state.open.version} is in the <TextLink href="/approvals">approvals inbox</TextLink>. Nothing creative can
          use the brief until it is signed off. Editing the brief closes this request.
        </p>
      )}
      {!waiting && !signedOffNow && (
        <p className="max-w-prose text-ink-2">
          Signing off records who approved which version, and when. Sending also asks the personas and writes a test plan
          for this version, if it has none.
        </p>
      )}

      {oldMarketSources.length > 0 && !signedOffNow && (
        <div className="max-w-prose rounded-field bg-review-soft px-4 py-3 text-review-ink" data-market-warning="">
          <p className="font-semibold">Some market evidence is getting old</p>
          <p className="mt-1">
            {oldMarketSources.length === 1 ? "A market note this brief cites was" : "Market notes this brief cites were"} checked
            more than {MARKET_WARNING_DAYS} days ago:{" "}
            {oldMarketSources.map((s) => `“${s.title}”, on ${formatDay(s.checkedAt)}`).join("; ")}. It can still be signed off;
            refreshing the brand&apos;s market notes first would be safer.
          </p>
        </div>
      )}

      {waiting && state.open ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <SignoffDecision approvalId={state.open.id} version={state.open.version} />
          <WithdrawSignoffButton campaignId={campaignId} />
        </div>
      ) : (
        !signedOffNow && <SendForSignoffButton campaignId={campaignId} version={currentVersion} />
      )}
    </Card>
  );
}
