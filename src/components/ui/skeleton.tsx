import { cx } from "./cx";

/** A placeholder block while content loads. Pulses gently, unless motion is reduced. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("block rounded-field bg-surface-2 motion-safe:animate-pulse", className)} />;
}

/** A page-level loading placeholder with a text announcement for screen readers. */
export function PageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-10 w-2/3 max-w-md" />
      <Skeleton className="h-5 w-full max-w-xl" />
      <div className="space-y-3 rounded-card bg-surface p-6">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-2/5" />
      </div>
    </div>
  );
}
