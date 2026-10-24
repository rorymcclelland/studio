const LABELS: Record<string, { text: string; tone: "neutral" | "active" | "good" | "warn" | "bad" }> = {
  queued: { text: "Queued", tone: "neutral" },
  running: { text: "Running", tone: "active" },
  awaiting_approval: { text: "Awaiting approval", tone: "warn" },
  completed: { text: "Completed", tone: "good" },
  rejected: { text: "Rejected", tone: "neutral" },
  expired: { text: "Expired", tone: "neutral" },
  failed: { text: "Failed", tone: "bad" },
  stopped_cap: { text: "Stopped: daily cap", tone: "bad" },
  succeeded: { text: "Succeeded", tone: "good" },
  pending: { text: "Pending", tone: "warn" },
  approved: { text: "Approved", tone: "good" },
  skipped: { text: "Skipped", tone: "neutral" },
};

const TONES = {
  neutral: "border-line text-ink-2",
  active: "border-accent text-accent",
  good: "border-good text-good",
  warn: "border-warn text-warn",
  bad: "border-bad text-bad",
};

export function StatusBadge({ status }: { status: string }) {
  const l = LABELS[status] ?? { text: status, tone: "neutral" as const };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[l.tone]}`}>
      {l.text}
    </span>
  );
}

export const ACTIVE_STATUSES = new Set(["queued", "running", "awaiting_approval"]);
