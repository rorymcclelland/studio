import { HOW_LABELS, statusLabel, type UploadFinding, type UploadOutcome } from "@/lib/compliance/upload-rules";
import { PART_NAMES } from "@/lib/agents/read-ad";
import type { StoredWord } from "@/lib/uploads/repo";
import { Pill, type PillTone } from "@/components/ui/pill";

// C8-3: how an uploaded ad's check is shown. Each finding has its status
// (a model's "no" is "No issues found by AI", never "Pass"), how it was found
// ("Checked in code, on the words read by AI", "Estimated" or "Checked by
// AI"), the reason and a suggested fix. The words the AI read are listed in
// full, labelled "Read by AI". Everything from the upload or the kit is
// rendered as text, never as markup.

const OUTCOMES: Record<UploadOutcome, { label: string; tone: PillTone }> = {
  passes: { label: "Passes", tone: "good" },
  review: { label: "To review", tone: "review" },
  fails: { label: "Fails", tone: "attention" },
};

export function OutcomePill({ outcome }: { outcome: UploadOutcome }) {
  const o = OUTCOMES[outcome];
  return (
    <span data-outcome={outcome}>
      <Pill tone={o.tone}>{o.label}</Pill>
    </span>
  );
}

const TONES: Record<UploadFinding["status"], PillTone> = { pass: "good", review: "review", fail: "attention", na: "neutral" };

export function FindingList({ findings }: { findings: UploadFinding[] }) {
  return (
    <ul className="space-y-3" data-upload-findings="">
      {findings.map((f) => {
        const isDont = f.rule === "dont";
        return (
          <li key={f.key} className="min-w-0 space-y-2 rounded-card bg-surface p-4" data-rule={f.rule} data-status={f.status}>
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <Pill tone={TONES[f.status]}>{statusLabel(f)}</Pill>
              <span className="min-w-0 font-semibold wrap-anywhere" data-finding-title="">
                {isDont ? `${f.name}: ${f.fix}` : f.name}
              </span>
            </div>
            <p className="text-sm font-semibold text-ink-2" data-how={f.how}>
              {HOW_LABELS[f.how]}
            </p>
            <p className="text-sm wrap-anywhere" data-reason="">
              {f.reason}
            </p>
            {!isDont && f.fix && (f.status === "review" || f.status === "fail") && (
              <p className="text-sm wrap-anywhere" data-fix="">
                <span className="font-semibold">Suggested fix:</span> {f.fix}.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function WordsRead({ words }: { words: StoredWord[] }) {
  if (words.length === 0) return <p className="text-ink-2">The AI read no words in this ad.</p>;
  return (
    <ol className="space-y-2" data-words-read="">
      {words.map((w, i) => (
        <li key={i} className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:gap-3">
          <span className="w-28 shrink-0 text-sm font-semibold text-ink-2">{PART_NAMES[w.part]}</span>
          <span className="min-w-0 wrap-anywhere" data-word="">
            {w.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
