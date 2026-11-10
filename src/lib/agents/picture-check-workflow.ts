import { isFinanceCategory } from "@/lib/agents/imagery";
import { pictureCheckStart, picturesToCheck, NOT_SIGNED_OFF_CHECK } from "@/lib/creative/picture-check";
import { asUser } from "@/lib/db/scoped";
import { checkOne, type Checked } from "./imagery-workflow";
import type { StepContext } from "./model-step";
import { setRun, type StepTools } from "./workflow";

// C8-2: Check pictures. Read the campaign's pictures that still have no
// picture-check result (system step: one that got a result since the click is
// left out, so a second run checks nothing and costs nothing), then one picture
// check per picture, one after another, through runModelStep (rule 4) and
// generate() (rule 5). Results are stored with each picture. Nothing is
// discarded or replaced (rule 3): a picture already in ads that the AI flags
// becomes a finding on those ads for a person, and a close-up face for a
// finance brand fails its ads until a person uses New picture.

type Job = { assetId: string; picture: number };
type Prepared = { ok: true; campaignId: string; finance: boolean; jobs: Job[]; skipped: number } | { ok: false; message: string };
type Done = { assetId: string; picture: number; checked: Checked };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function systemStep(ctx: StepContext, seq: number, name: string, ok: boolean, input: unknown, output: unknown, error: string | null, started: number) {
  await asUser(ctx.userId, (tx) => tx`
    insert into public.agent_steps (run_id, workspace_id, seq, name, kind, status, input, output, error, duration_ms, finished_at)
    values (${ctx.runId}, ${ctx.workspaceId}, ${seq}, ${name}, 'system', ${ok ? "succeeded" : "failed"},
            ${tx.json((input ?? {}) as never)}, ${output === null ? null : tx.json(output as never)}, ${error}, ${Date.now() - started}, now())
    on conflict (run_id, seq) do update set status = excluded.status, output = excluded.output, error = excluded.error,
      duration_ms = excluded.duration_ms, finished_at = now()`);
}

async function prepare(ctx: StepContext): Promise<Prepared> {
  const started = Date.now();
  const res = await asUser(ctx.userId, async (tx): Promise<{ result: Prepared; raw: unknown }> => {
    const [run] = await tx`select input from public.agent_runs where id = ${ctx.runId}`;
    const parsed = pictureCheckStart.safeParse(run?.input);
    if (!parsed.success) return { result: { ok: false, message: "The run's input is not a Check pictures request." }, raw: run?.input ?? {} };
    const start = parsed.data;
    const [c] = await tx`
      select c.status, c.approved_version, b.category from public.campaigns c join public.brands b on b.id = c.brand_id where c.id = ${start.campaignId}`;
    if (!c) return { result: { ok: false, message: "The campaign no longer exists, or isn't in this workspace." }, raw: start };
    if (c.status !== "approved" || !c.approved_version) return { result: { ok: false, message: NOT_SIGNED_OFF_CHECK }, raw: start };
    // Only the pictures asked for that still have no result: one checked since the click is not paid for twice.
    const { todo } = await picturesToCheck(tx, start.campaignId, c.approved_version as number);
    const still = new Map(todo.map((t) => [t.id, t.picture]));
    const jobs = start.assetIds.filter((id) => still.has(id)).map((id) => ({ assetId: id, picture: still.get(id)! }));
    return {
      result: { ok: true, campaignId: start.campaignId, finance: isFinanceCategory((c.category as string | null) ?? ""), jobs, skipped: start.assetIds.length - jobs.length },
      raw: start,
    };
  });
  const r = res.result;
  await systemStep(ctx, 1, "Read the pictures to check", r.ok, res.raw, r.ok ? { pictures: r.jobs.length, alreadyChecked: r.skipped, financeBrand: r.finance } : null, r.ok ? null : r.message, started);
  return r;
}

export async function executePictureCheckRun(ctx: StepContext, step: StepTools): Promise<string> {
  await step.run("start", () => setRun(ctx, "running"));
  const p = await step.run("read-pictures", () => prepare(ctx));
  if (!p.ok) {
    await step.run("stop", () => setRun(ctx, "failed", { error: p.message }));
    return "failed";
  }

  const done: Done[] = [];
  let capped = false;
  for (const [i, job] of p.jobs.entries()) {
    // One at a time: the cap stops the run at the first picture it can't pay for, and nothing after it is tried.
    const checked = await step.run(`check-${job.assetId}`, () =>
      checkOne(ctx, job.assetId, job.picture, 1, { seq: 2 + i, name: `Check picture ${job.picture}` }, { discard: false }),
    );
    done.push({ ...job, checked });
    if (!checked.ok && checked.reason === "cap") {
      capped = true;
      break;
    }
  }

  return step.run("save", async () => {
    const started = Date.now();
    const ok = done.filter((d): d is Done & { checked: Extract<Checked, { ok: true }> } => d.checked.ok);
    const failed = done.filter((d) => !d.checked.ok);
    const faces = ok.filter((d) => d.checked.closeUpFace);
    const text = ok.filter((d) => d.checked.hasText);
    const notReached = p.jobs.length - done.length;
    const notes = [
      faces.length
        ? `The AI found a close-up face in ${plural(faces.length, "picture")} (${faces.map((d) => d.picture).join(", ")}): their ads fail the face rule for finance brands until a person uses New picture.`
        : "",
      text.length
        ? `The AI also saw text in ${plural(text.length, "picture")} (${text.map((d) => d.picture).join(", ")}). Each was checked for text when it was drawn, so it is kept; use New picture if it has words.`
        : "",
      failed.length ? `${plural(failed.length, "check")} didn't run, so ${failed.length === 1 ? "its ads show" : "their ads show"} Review with the reason.` : "",
      notReached ? `${plural(notReached, "picture was", "pictures were")} not checked: the daily AI cap was reached.` : "",
    ].filter(Boolean);
    const summary =
      p.jobs.length === 0
        ? `Nothing to check: every picture already has a result${p.skipped ? ` (${plural(p.skipped, "picture")} checked since the click)` : ""}.`
        : `Checked ${ok.length} of ${plural(p.jobs.length, "picture")} for text, faces and the brand's don't rules. ${notes.join(" ")}`.trim();
    const record = {
      checked: ok.map((d) => ({ assetId: d.assetId, picture: d.picture, hasText: d.checked.hasText, closeUpFace: d.checked.closeUpFace })),
      notChecked: failed.map((d) => ({ assetId: d.assetId, picture: d.picture, message: d.checked.ok ? "" : d.checked.message })),
      notReached,
      alreadyChecked: p.skipped,
    };
    await systemStep(ctx, 2 + p.jobs.length, "Save the results", true, { pictures: p.jobs.length }, record, null, started);
    const output = { summary, ...record, campaignId: p.campaignId, href: `/campaigns/${p.campaignId}/creative`, hrefLabel: "See the campaign" };
    if (capped) {
      await setRun(ctx, "stopped_cap", { output, error: `Daily AI cap reached: ${ok.length} of ${plural(p.jobs.length, "picture")} checked.` });
      return "stopped_cap";
    }
    if (p.jobs.length > 0 && ok.length === 0) {
      const messages = [...new Set(failed.map((d) => (d.checked.ok ? "" : d.checked.message)))];
      await setRun(ctx, "failed", { output, error: `No picture was checked. ${messages.join(" ")}`.trim() });
      return "failed";
    }
    await setRun(ctx, "completed", { output });
    return "completed";
  });
}
