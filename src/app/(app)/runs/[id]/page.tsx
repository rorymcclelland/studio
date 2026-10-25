import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getRun } from "@/lib/agents/runs";
import { AGENTS } from "@/lib/agents/registry";
import { StatusBadge, ACTIVE_STATUSES } from "@/components/status-badge";
import { AutoRefresh } from "@/components/auto-refresh";
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
    <div className="space-y-8">
      <AutoRefresh active={ACTIVE_STATUSES.has(run.status)} />
      <div>
        <Link href="/runs" className="text-sm text-accent">All runs</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{String(run.input.brandName ?? "Run")}</h1>
          <StatusBadge status={run.status} />
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {agent?.name ?? run.agent} v{run.agent_version} · started {formatWhen(run.created_at)} · total cost{" "}
          {formatPence(run.cost_pence)}
        </p>
      </div>

      {run.status === "completed" && run.output && (
        <section aria-labelledby="result" className="rounded-lg border border-good bg-surface p-4">
          <h2 id="result" className="text-sm font-medium text-good">Chosen tagline</h2>
          <p className="mt-1 text-xl">{String(run.output.tagline)}</p>
        </section>
      )}
      {run.error && (
        <section aria-labelledby="problem" className="rounded-lg border border-bad bg-surface p-4">
          <h2 id="problem" className="text-sm font-medium text-bad">What happened</h2>
          <p className="mt-1">{run.error}</p>
        </section>
      )}
      {pending && (
        <section aria-labelledby="decide" className="rounded-lg border border-warn bg-surface p-4">
          <h2 id="decide" className="font-semibold">{pending.question}</h2>
          <p className="mt-1 text-sm text-ink-2">
            The run is waiting for you. This approval closes {formatWhen(pending.expires_at)}.
          </p>
          <ApprovalForm approvalId={pending.id} options={pending.options} />
        </section>
      )}

      <section aria-labelledby="trail">
        <h2 id="trail" className="text-lg font-semibold">Decision trail</h2>
        {run.steps.length === 0 ? (
          <p className="mt-3 text-ink-2">The run hasn&apos;t taken a step yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {run.steps.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm tabular-nums text-ink-2">Step {s.seq}</span>
                  <h3 className="font-medium">{s.name}</h3>
                  <StatusBadge status={s.status} />
                  <span className="ml-auto text-sm tabular-nums text-ink-2">{formatMs(s.duration_ms)}</span>
                </div>
                {s.kind === "model" && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                    <Meta label="Model" value={s.model ? `${s.provider} · ${s.model}` : "—"} />
                    <Meta label="Tokens in / out" value={`${s.input_tokens} / ${s.output_tokens}`} />
                    <Meta label="Cost" value={formatPence(s.cost_pence)} />
                    <Meta label="Attempts" value={String(s.attempts)} />
                  </dl>
                )}
                {s.error && <p className="mt-3 text-sm text-bad">{s.error}</p>}
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-ink-2">Inputs and outputs</summary>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <Block title="Input" value={s.input} />
                    <Block title="Output" value={s.output ?? s.raw_output} />
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Block({ title, value }: { title: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <p className="font-medium">{title}</p>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg p-3 text-xs">
        {text ?? "—"}
      </pre>
    </div>
  );
}

export default function RunPage(props: PageProps<"/runs/[id]">) {
  return (
    <Suspense fallback={<p className="text-ink-2">Loading…</p>}>
      <RunPageContent {...props} />
    </Suspense>
  );
}
