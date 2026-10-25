import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getRun } from "@/lib/agents/runs";
import { AGENTS } from "@/lib/agents/registry";
import { StatusBadge, ACTIVE_STATUSES } from "@/components/status-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatMs, formatPence, formatWhen } from "@/lib/format";
import { ApprovalForm } from "./approval-form";

async function RunPageContent(props: PageProps<"/runs/[id]">) {
  const { id } = await props.params;
  const member = await requireMember();
  const run = await getRun(member.userId, id);
  if (!run) notFound();

  const agent = AGENTS[run.agent as keyof typeof AGENTS];
  const pending = run.approvals.find((a) => a.status === "pending");

  return (
    <div className="space-y-10">
      <AutoRefresh active={ACTIVE_STATUSES.has(run.status)} />
      <div>
        <TextLink href="/runs">
          <span aria-hidden>← </span>All runs
        </TextLink>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-title font-strong wrap-anywhere">{String(run.input.brandName ?? "Run")}</h1>
          <StatusBadge status={run.status} />
        </div>
        <p className="mt-2 text-ink-2">
          {agent?.name ?? run.agent} v{run.agent_version} · started {formatWhen(run.created_at)} · total cost{" "}
          <span className="tabular-nums">{formatPence(run.cost_pence)}</span>
        </p>
      </div>

      {run.status === "completed" && run.output && (
        <Card as="section" tone="good" aria-labelledby="result" className="bg-good-soft">
          <h2 id="result" className="font-semibold text-good-ink">
            Chosen tagline
          </h2>
          <p className="mt-1 text-2xl font-strong tracking-tight wrap-anywhere">{String(run.output.tagline)}</p>
        </Card>
      )}
      {run.error && (
        <Card as="section" tone="attention" aria-labelledby="problem" className="bg-attention-soft">
          <h2 id="problem" className="font-semibold text-attention-ink">
            What happened
          </h2>
          <p className="mt-1 wrap-anywhere">{run.error}</p>
        </Card>
      )}
      {pending && (
        <Card as="section" tone="primary" aria-labelledby="decide">
          <p className="text-sm font-semibold text-primary">Waiting for your OK</p>
          <h2 id="decide" className="mt-1 text-xl font-strong">
            {pending.question}
          </h2>
          <p className="mt-1 text-ink-2">
            The run is waiting for you. Choose one, or reject them all. This approval closes{" "}
            {formatWhen(pending.expires_at)}.
          </p>
          <ApprovalForm approvalId={pending.id} options={pending.options} />
        </Card>
      )}

      <section aria-labelledby="trail">
        <h2 id="trail" className="text-2xl font-strong tracking-tight">
          Decision trail
        </h2>
        <p className="mt-1 text-ink-2">Every step the run took, with its model, tokens, cost and time.</p>
        {run.steps.length === 0 ? (
          <p className="mt-4 rounded-card bg-surface p-6 text-ink-2">The run hasn&apos;t taken a step yet.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {run.steps.map((s) => (
              <Card as="li" key={s.id}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-sm text-ink-2 tabular-nums">Step {s.seq}</span>
                  <h3 className="font-semibold">{s.name}</h3>
                  <StatusBadge status={s.status} />
                  <span className="ml-auto text-sm text-ink-2 tabular-nums">{formatMs(s.duration_ms)}</span>
                </div>
                {s.kind === "model" && (
                  <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                    <Meta label="Model" value={s.model ? `${s.provider} · ${s.model}` : "—"} />
                    <Meta label="Tokens in / out" value={`${s.input_tokens} / ${s.output_tokens}`} />
                    <Meta label="Cost" value={formatPence(s.cost_pence)} />
                    <Meta label="Attempts" value={String(s.attempts)} />
                  </dl>
                )}
                {s.error && <p className="mt-3 text-sm font-medium text-attention-ink wrap-anywhere">{s.error}</p>}
                <details className="group mt-4 text-sm">
                  <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full font-semibold text-primary">
                    <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                      ›
                    </span>
                    Inputs and outputs
                  </summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Block title="Input" value={s.input} />
                    <Block title="Output" value={s.output ?? s.raw_output} />
                  </div>
                </details>
              </Card>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-medium tabular-nums wrap-anywhere">{value}</dd>
    </div>
  );
}

function Block({ title, value }: { title: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="min-w-0">
      <p className="font-semibold">{title}</p>
      <pre
        tabIndex={0}
        aria-label={`${title} of this step`}
        className="mt-1 max-h-72 overflow-auto rounded-field bg-bg p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere"
      >
        {text ?? "—"}
      </pre>
    </div>
  );
}

export default function RunPage(props: PageProps<"/runs/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RunPageContent {...props} />
    </Suspense>
  );
}
