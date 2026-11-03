import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getBrand } from "@/lib/brands/repo";
import { readAdEstimate } from "@/lib/creative/costs";
import { ENGLISH, LANG_NAMES, listBrandLanguages } from "@/lib/creative/languages";
import { formatWhen } from "@/lib/format";
import { getUpload, isActive } from "@/lib/uploads/repo";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { AutoRefresh } from "@/components/auto-refresh";
import { CheckAgain } from "../check-again";
import { FindingList, OutcomePill, WordsRead } from "../outcome";

// C8-3: one uploaded ad and its newest check: the ad as uploaded (re-encoded,
// never redrawn), the outcome, every finding with how it was found, and the
// words the AI read, in full. While the check runs the page follows it; a
// check that didn't run says why, and can be run again with its cost shown.

export const metadata = { title: "Uploaded ad" };

const CHANNEL_NAMES: Record<string, string> = { "paid social": "Paid social", display: "Display (banners)" };

async function UploadContent(props: PageProps<"/brands/[id]/check/[uploadId]">) {
  const { id, uploadId } = await props.params;
  const member = await requireMember();
  const brand = await getBrand(member.userId, id);
  if (!brand) notFound();
  const [upload, languages] = await Promise.all([getUpload(member.userId, brand.id, uploadId), listBrandLanguages(member.userId, brand.id)]);
  if (!upload) notFound();
  const active = isActive(upload.run);
  const check = upload.check;
  // The newest run finished without a check (the cap, a provider error, a reading that broke the rules after a repair).
  const failedRun = !active && upload.run && (!check || check.runId !== upload.run.id) ? upload.run : null;
  const langs = [{ lang: ENGLISH, name: LANG_NAMES[ENGLISH] }, ...languages.map((l) => ({ lang: l.lang, name: l.name }))];

  return (
    <div className="space-y-8">
      <AutoRefresh active={active} intervalMs={1500} />
      <div>
        <TextLink href={`/brands/${brand.id}/check`}>
          <span aria-hidden>← </span>Check an ad for {brand.name}
        </TextLink>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-title font-strong wrap-anywhere">{upload.name}</h1>
          {active ? <Pill tone="active">Checking</Pill> : check && !failedRun ? <OutcomePill outcome={check.outcome} /> : null}
        </div>
        <p className="mt-2 text-ink-2">
          {upload.width} × {upload.height} {upload.mime === "image/jpeg" ? "JPEG" : "PNG"}, uploaded {formatWhen(upload.createdAt)}, for {brand.name}.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <figure className="min-w-0 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- the upload is served by /assets with its own access check */}
          <img src={upload.src} alt={`The uploaded ad, ${upload.name}`} width={upload.width} height={upload.height} className="h-auto w-full rounded-card ring-1 ring-line" />
          <figcaption className="text-sm text-ink-2">As uploaded, re-encoded without its metadata. Studio never changes or redraws it.</figcaption>
        </figure>

        <div className="min-w-0 space-y-6">
          {active && (
            <Card tone="primary" role="status" data-check-running="">
              The Read ad agent is reading the ad. This takes a few seconds.
            </Card>
          )}
          {failedRun && (
            <Card tone="attention" role="alert" className="space-y-1" data-check-failed="">
              <p className="font-semibold">The check didn&apos;t run.</p>
              <p className="wrap-anywhere">{failedRun.error ?? "The run stopped before it finished."}</p>
            </Card>
          )}
          {check && (
            <section aria-labelledby="findings" className="space-y-3" data-check={check.id}>
              <div>
                <h2 id="findings" className="text-2xl font-strong tracking-tight">
                  {failedRun ? "The last check that ran" : "The check"}
                </h2>
                <p className="mt-1 max-w-prose text-ink-2">
                  {CHANNEL_NAMES[check.channel] ?? check.channel}, {check.langName}. Checked against the kit as it was on {formatWhen(check.createdAt)}. Code
                  checks the words the AI read; estimates and the AI&apos;s own findings are always for a person to judge.
                </p>
                {check.simulated && (
                  <p className="mt-2">
                    <Pill tone="review">Simulated reading from the mock model</Pill>
                  </p>
                )}
              </div>
              <FindingList findings={check.findings} />
            </section>
          )}
          {check && (
            <section aria-labelledby="words" className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 id="words" className="text-2xl font-strong tracking-tight">
                  The words
                </h2>
                <Pill tone="neutral">Read by AI</Pill>
              </div>
              <p className="max-w-prose text-ink-2">Every line the AI read in the ad, in full and in reading order. These are the words the checks were run on.</p>
              <WordsRead words={check.words} />
            </section>
          )}
          {!active && (
            <Card as="section" aria-labelledby="again" className="space-y-3">
              <h2 id="again" className="text-lg font-strong">
                Check again
              </h2>
              <p className="max-w-prose text-ink-2">After a change to the kit, or for another channel or language.</p>
              <CheckAgain
                brandId={brand.id}
                assetId={upload.id}
                cost={readAdEstimate().label}
                languages={langs}
                channel={check?.channel ?? upload.run?.channel ?? "paid social"}
                lang={check?.lang ?? upload.run?.lang ?? ENGLISH}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function UploadPage(props: PageProps<"/brands/[id]/check/[uploadId]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the uploaded ad" />}>
      <UploadContent {...props} />
    </Suspense>
  );
}
