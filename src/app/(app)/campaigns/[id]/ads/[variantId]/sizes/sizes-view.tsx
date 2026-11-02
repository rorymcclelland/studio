import type { SizeView } from "@/lib/creative/ad-sizes";
import { Pill, type PillTone } from "@/components/ui/pill";

// C7-1: the Sizes view of one ad. Every size of its channel as a thumbnail
// that opens the drawing full size in a new tab, with that size's checks; a
// size the words or legal lines don't fit says why instead (Q2). Kept apart
// from the gallery's card so the two change independently.

const TONE: Record<"good" | "warn" | "info", PillTone> = { good: "good", warn: "review", info: "review" };

/** The thumbnail's longest side in CSS pixels; the drawing keeps its own proportions. */
const THUMB = 240;

function thumbBox(s: SizeView) {
  const scale = Math.min(THUMB / s.width, THUMB / s.height);
  return { width: Math.round(s.width * scale), height: Math.round(s.height * scale) };
}

export function SizesView({ sizes, adLabel }: { sizes: SizeView[]; adLabel: string }) {
  const drawn = sizes.filter((s) => s.ok).length;
  return (
    <section aria-labelledby="sizes-title" className="space-y-4">
      <div>
        <h2 id="sizes-title" className="text-lg font-strong">
          Sizes
        </h2>
        <p className="mt-1 max-w-prose text-ink-2" data-sizes-summary="">
          {drawn === sizes.length
            ? `Drawn in all ${sizes.length} sizes of its channel, with the same words, logo and legal lines.`
            : `Drawn in ${drawn} of ${sizes.length} sizes. ${sizes.length - drawn === 1 ? "One size is" : `${sizes.length - drawn} sizes are`} left out, with the reason below.`}
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {sizes.map((s) => (
          <SizeCard key={s.size} s={s} adLabel={adLabel} />
        ))}
      </ul>
    </section>
  );
}

function SizeCard({ s, adLabel }: { s: SizeView; adLabel: string }) {
  const box = thumbBox(s);
  const titleId = `size-${s.size}-title`;
  return (
    <li aria-labelledby={titleId} data-size={s.size} data-size-ok={s.ok ? "" : undefined} className="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-3 sm:p-4">
      <div className="flex min-h-64 items-center justify-center rounded-field bg-surface-2 p-3">
        {s.ok ? (
          <a
            href={s.src}
            target="_blank"
            rel="noopener"
            title="Open full size"
            className="block rounded-field focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a drawn PNG behind the session, not a static asset */}
            <img
              src={s.src}
              width={box.width}
              height={box.height}
              loading="lazy"
              alt={`${adLabel} at ${s.name} (${s.width} × ${s.height}), opens full size in a new tab`}
              className="block h-auto max-w-full cursor-zoom-in rounded-sm shadow-sm"
              style={{ width: box.width, aspectRatio: `${s.width} / ${s.height}` }}
            />
          </a>
        ) : (
          <div
            role="img"
            aria-label={`${s.name} is not drawn`}
            className="flex max-w-full items-center justify-center rounded-sm border-2 border-dashed border-ink-2/40 p-2 text-center text-sm text-ink-2"
            style={{ width: box.width, aspectRatio: `${s.width} / ${s.height}` }}
          >
            Not drawn
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 id={titleId} className="font-strong">
          {s.name}
        </h3>
        <span className="text-sm text-ink-2">
          {s.width} × {s.height}
        </span>
      </div>
      {s.ok ? (
        <>
          {s.fellBack && <p className="text-sm text-ink-2">Drawn in {s.layoutName}: the ad&apos;s own layout doesn&apos;t hold its words at this size.</p>}
          <ul aria-label={`Checks at ${s.name}`} className="flex flex-wrap gap-1.5">
            {s.badges.map((b) => (
              <li key={b.key} data-badge={b.key} title={b.detail}>
                <Pill tone={TONE[b.tone]} wrap>
                  {b.label}
                </Pill>
              </li>
            ))}
          </ul>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-primary">About this size</summary>
            <ul className="mt-2 space-y-1.5 text-ink-2">
              {s.badges.map((b) => (
                <li key={b.key} className="wrap-anywhere">
                  <span className="font-semibold text-ink">{b.label}:</span> {b.detail}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <div className="space-y-1.5" data-size-refused="">
          <Pill tone="attention">Left out</Pill>
          <p className="text-sm text-ink wrap-anywhere">{s.reason}</p>
        </div>
      )}
    </li>
  );
}
