// C7-3 in the Creative section: the launch pack. What the zip will hold
// (the picked ads in every size and language that passed, counted, and
// everything left out with its reason) before the download, or why there is
// no pack yet. The download is a plain link to /campaigns/<id>/pack.zip: it
// publishes nothing and spends nothing, so it needs no approval (rule 3, Q6).
// The plan fits every size without drawing, so it streams in on its own
// (Suspense) rather than holding up the gallery.
import { buttonClass } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import type { PackLeftOut, PackSummary } from "@/lib/creative/pack";

const CHANNEL_NAME: Record<string, string> = { "paid social": "Paid social", display: "Display" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function duration(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} seconds`;
  const minutes = Math.round(seconds / 60);
  return `about ${plural(minutes, "minute")}`;
}

/** Everything left out of the pack, each with its reason (a size that doesn't fit, a missing language, or C8-1's compliance). */
function LeftOut({ items }: { items: PackLeftOut[] }) {
  return (
    <details className="group text-sm" data-pack-left-out="">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full font-semibold text-primary">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ›
        </span>
        {plural(items.length, "size or language", "sizes or languages")} left out, with the reasons
      </summary>
      <ul className="mt-2 space-y-1.5">
        {items.map((l, i) => (
          <li key={i} className="wrap-anywhere">
            <span className="font-semibold">
              Ad {l.adNumber}, {l.sizeName ?? "every size"}, {l.langName}:
            </span>{" "}
            {l.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function LaunchPackSkeleton() {
  return (
    <div className="rounded-field bg-surface px-4 py-3" aria-hidden>
      <p className="font-semibold">Launch pack</p>
      <Skeleton className="mt-2 h-5 w-2/3" />
    </div>
  );
}

export async function LaunchPack({ summary }: { summary: Promise<PackSummary | null> }) {
  const pack = await summary;
  if (!pack) return null;
  const headingId = "launch-pack-heading";
  return (
    <section
      aria-labelledby={headingId}
      id="launch-pack"
      className="flex flex-col gap-3 rounded-field bg-surface px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
      data-launch-pack=""
    >
      <div className="min-w-0 max-w-prose space-y-2">
        <h3 id={headingId} className="text-base font-semibold">
          Launch pack
        </h3>
        {!pack.allowed ? (
          <>
            <p className="text-sm text-ink-2" data-pack-reason="">
              {pack.reason}
            </p>
            {pack.leftOut && pack.leftOut.length > 0 && <LeftOut items={pack.leftOut} />}
          </>
        ) : (
          <>
            <p className="text-sm" data-pack-count="">
              <span className="font-semibold">{plural(pack.files, "ad")}</span> from {plural(pack.ads, "picked ad")}, in every size
              and language that passed its checks, with manifest.json, manifest.csv and README.txt: {plural(pack.zipEntries, "file")} in
              one zip. No AI cost, and nothing is published.
            </p>
            <ul aria-label="Ads in the pack by language" className="flex flex-wrap gap-1.5">
              {pack.byLanguage.map((l) => (
                <li key={l.lang} data-pack-language={l.lang}>
                  <Pill tone="neutral">
                    {l.name}: {l.files}
                  </Pill>
                </li>
              ))}
            </ul>
            <ul className="space-y-0.5 text-sm text-ink-2">
              {pack.byChannel.map((c) => (
                <li key={c.channel}>
                  {CHANNEL_NAME[c.channel] ?? c.channel}: {c.sizes.join(", ")}
                </li>
              ))}
            </ul>
            {(pack.simulatedPictures || pack.machineTranslations) && (
              <p className="text-sm text-ink-2">
                {pack.simulatedPictures && pack.machineTranslations
                  ? "Simulated pictures and machine translations are labelled as such in both manifests and the README."
                  : pack.simulatedPictures
                    ? "Simulated pictures are labelled as such in both manifests and the README."
                    : "Machine translations are labelled as such in both manifests and the README."}
              </p>
            )}
            {pack.leftOut.length > 0 && <LeftOut items={pack.leftOut} />}
          </>
        )}
      </div>
      {pack.allowed && (
        <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
          {/* A plain link, not next/link: a download must not be prefetched. */}
          <a href={pack.href} download className={buttonClass("primary", "sm", "px-3")} data-pack-download="">
            Build launch pack ({plural(pack.files, "ad")})
          </a>
          <p className="max-w-60 text-sm text-ink-2 sm:text-right">The zip is drawn as it downloads: {duration(pack.seconds)}.</p>
        </div>
      )}
    </section>
  );
}
