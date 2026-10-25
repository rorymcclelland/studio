import Link from "next/link";
import { cx } from "./cx";

/** The placeholder wordmark: a pebble and "Studio", marked as a working title. */
export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cx("inline-flex items-center gap-2.5 rounded-full", className)}>
      <span aria-hidden className="block size-7 rounded-logo bg-primary" />
      <span className="text-xl font-bold tracking-tight">Studio</span>
      <span className="text-sm text-ink-2">
        <span className="sr-only">(</span>working title<span className="sr-only">)</span>
      </span>
    </Link>
  );
}
