import { Pill, type PillTone } from "@/components/ui/pill";

const LABELS: Record<string, { text: string; tone: PillTone }> = {
  queued: { text: "Queued", tone: "neutral" },
  running: { text: "Running", tone: "active" },
  awaiting_approval: { text: "Awaiting approval", tone: "review" },
  completed: { text: "Completed", tone: "good" },
  rejected: { text: "Rejected", tone: "neutral" },
  expired: { text: "Expired", tone: "neutral" },
  failed: { text: "Failed", tone: "attention" },
  stopped_cap: { text: "Stopped: daily cap", tone: "attention" },
  succeeded: { text: "Succeeded", tone: "good" },
  pending: { text: "Pending", tone: "review" },
  approved: { text: "Approved", tone: "good" },
  skipped: { text: "Skipped", tone: "neutral" },
};

/** The status of a run, step or approval, in words. */
export function StatusBadge({ status }: { status: string }) {
  const l = LABELS[status] ?? { text: status, tone: "neutral" as const };
  return (
    <Pill tone={l.tone} dot>
      {l.text}
    </Pill>
  );
}

/** Where a status sits on the health ring. */
export function statusRingTone(status: string): "good" | "review" | "attention" {
  const tone = LABELS[status]?.tone;
  if (tone === "good") return "good";
  if (tone === "attention") return "attention";
  return "review";
}

export const ACTIVE_STATUSES = new Set(["queued", "running", "awaiting_approval"]);
