"use client";

// P9-1: the Launch (simulated) panel's controls. The settings form, which asks
// for a launch (an approval in the inbox, rule 3), and End the launch with its
// confirm step. P9-2: the simulated clock, Next day, Next week and Run to the
// end, each sending the day the page shows, so a double click moves it once.
// The rules are the server's own (launch-rules.ts, clock-rules.ts); the server
// checks everything again.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { clockLabel, SIM_AT_END, type ClockStep } from "@/lib/performance/clock-rules";
import {
  DEFAULT_VALUES,
  formatThreshold,
  HEALTHY_WHEN,
  isKpiMeasure,
  KPI_MEASURES,
  LAUNCH_LIMITS,
  MEASURE_NAMES,
  SIMULATED_DEFAULT,
  type KpiMeasure,
  type LaunchSettings,
} from "@/lib/performance/launch-rules";
import { ActionError } from "./brief-actions";
import { advanceClock, askToLaunch, endTheLaunch } from "./launch-actions";
import { useBriefAction } from "./use-brief-action";

const UNIT: Record<KpiMeasure, string> = {
  ctr: "A percentage of impressions, for example 1 for 1%.",
  conversion_rate: "A percentage of clicks, for example 2 for 2%.",
  cpa: "Simulated pounds for each conversion.",
  roas: "Simulated revenue for each £1 spent, for example 3 for £3.",
};

/** A number from a field, or 0 (which the server refuses with the field's reason) when it isn't one. */
const num = (s: string) => {
  const n = Number(s.trim() === "" ? Number.NaN : s);
  return Number.isFinite(n) ? n : 0;
};

export function LaunchForm({
  campaignId,
  defaults,
  variantIds,
  canAsk,
}: {
  campaignId: string;
  defaults: LaunchSettings;
  variantIds: string[];
  canAsk: boolean;
}) {
  const { run, pending, error } = useBriefAction();
  const [budget, setBudget] = useState(String(defaults.dailyBudgetPence / 100));
  const [days, setDays] = useState(String(defaults.days));
  const [startsOn, setStartsOn] = useState(defaults.startsOn);
  const [measure, setMeasure] = useState<KpiMeasure>(isKpiMeasure(defaults.kpiMeasure) ? defaults.kpiMeasure : "conversion_rate");
  const [value, setValue] = useState(String(defaults.kpiValue));
  const L = LAUNCH_LIMITS;
  const id = (f: string) => `launch-${f}-${campaignId}`;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          askToLaunch(campaignId, {
            dailyBudgetPence: Math.round(num(budget) * 100),
            days: num(days),
            startsOn,
            kpiMeasure: measure,
            kpiValue: num(value),
            variantIds,
          }),
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field id={id("budget")} label="Daily budget (simulated £)" hint="£5 to £500 a day, shared evenly by the ads.">
          <Input
            type="number"
            inputMode="decimal"
            min={L.budgetPence.min / 100}
            max={L.budgetPence.max / 100}
            step="0.01"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            disabled={!canAsk}
          />
        </Field>
        <Field id={id("days")} label="Length in days" hint="7 to 60 simulated days.">
          <Input
            type="number"
            inputMode="numeric"
            min={L.days.min}
            max={L.days.max}
            step="1"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={!canAsk}
          />
        </Field>
        <Field id={id("start")} label="Start date" hint="The first simulated day.">
          <Input type="date" min={L.startsOn.min} max={L.startsOn.max} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} disabled={!canAsk} />
        </Field>
        <Field id={id("measure")} label="KPI measure" hint={`Healthy when ${HEALTHY_WHEN[measure]} the threshold.`}>
          <Select
            value={measure}
            onChange={(e) => {
              const m = e.target.value;
              if (!isKpiMeasure(m)) return;
              setMeasure(m);
              // A new measure starts from its own suggested value.
              setValue(String(DEFAULT_VALUES[m]));
            }}
            disabled={!canAsk}
          >
            {KPI_MEASURES.map((m) => (
              <option key={m} value={m}>
                {MEASURE_NAMES[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={id("threshold")}
          label="Threshold"
          hint={
            <>
              {UNIT[measure]}{" "}
              <span data-threshold-default="">
                Suggested: {formatThreshold(measure, DEFAULT_VALUES[measure])}, {SIMULATED_DEFAULT}.
              </span>
            </>
          }
        >
          <Input type="number" inputMode="decimal" min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canAsk} />
        </Field>
      </div>
      <div className="flex flex-col items-start gap-2">
        <Button type="submit" disabled={!canAsk || pending}>
          {pending ? "Asking…" : "Ask to launch"}
        </Button>
        <p className="text-sm text-ink-2">A person approves it in the approvals inbox before anything runs.</p>
      </div>
      <ActionError error={error} />
    </form>
  );
}

/** End the launch, with a confirm step (Keep it live goes back). */
export function EndLaunchButton({ campaignId, launchId }: { campaignId: string; launchId: string }) {
  const { run, pending, error, clearError } = useBriefAction();
  const [confirming, setConfirming] = useState(false);
  const endButton = useRef<HTMLButtonElement>(null);

  if (confirming) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-field border-2 border-attention-soft px-4 py-3" role="group" aria-label="End the launch?">
        <p className="max-w-prose text-sm">
          <span className="font-semibold">End the launch now?</span> It stops on its current simulated day and can&apos;t be restarted. The
          campaign can ask to launch again afterwards.
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => run(() => endTheLaunch(campaignId, launchId))}>
            {pending ? "Ending…" : "Yes, end the launch"}
          </Button>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            disabled={pending}
            autoFocus
            onClick={() => {
              clearError();
              setConfirming(false);
              requestAnimationFrame(() => endButton.current?.focus());
            }}
          >
            Keep it live
          </Button>
        </div>
        <ActionError error={error} />
      </div>
    );
  }
  return (
    <Button ref={endButton} type="button" variant="quiet" size="sm" onClick={() => setConfirming(true)}>
      End the launch
    </Button>
  );
}

const STEPS: { by: ClockStep; label: string }[] = [
  { by: 1, label: "Next day" },
  { by: 7, label: "Next week" },
  { by: "end", label: "Run to the end" },
];

/** The simulated clock: where it is, how far through the launch, and the steps that move it on. */
export function SimClock({ campaignId, launchId, simDay, days }: { campaignId: string; launchId: string; simDay: number; days: number }) {
  const { run, pending, error } = useBriefAction();
  const atEnd = simDay >= days;
  const percent = days > 0 ? Math.round((Math.min(simDay, days) / days) * 100) : 0;
  return (
    <div className="space-y-3 rounded-field border border-line px-4 py-3" role="group" aria-label="Simulated clock">
      <div className="space-y-2">
        <p className="font-semibold" data-sim-clock="">
          {clockLabel(simDay, days)}
        </p>
        <div aria-hidden className="h-2 w-full max-w-md overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((s) => (
          <Button
            key={String(s.by)}
            type="button"
            variant={s.by === 1 ? "primary" : "quiet"}
            size="sm"
            disabled={atEnd || pending}
            aria-describedby={atEnd ? `sim-at-end-${launchId}` : undefined}
            onClick={() => run(() => advanceClock(campaignId, launchId, s.by, simDay))}
          >
            {s.label}
          </Button>
        ))}
        <span className="text-sm text-ink-2" aria-live="polite">
          {pending ? "Moving the simulation on…" : ""}
        </span>
      </div>
      {atEnd ? (
        <p id={`sim-at-end-${launchId}`} className="text-sm" data-sim-at-end="">
          {SIM_AT_END}
        </p>
      ) : (
        <p className="text-sm text-ink-2">Each step writes the simulated results of every ad for each new day. Nothing real is spent.</p>
      )}
      <ActionError error={error} />
    </div>
  );
}
