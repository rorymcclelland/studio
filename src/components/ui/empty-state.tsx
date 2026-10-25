import { cx } from "./cx";

/** What to show when there is nothing yet, and what to do about it. */
export function EmptyState({
  title,
  children,
  action,
  headingLevel = 3,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cx("flex flex-col items-start gap-3 rounded-card bg-surface p-6 sm:p-8", className)}>
      <span aria-hidden className="block h-9 w-11 rounded-pebble bg-primary-soft" />
      <H className="text-lg font-strong">{title}</H>
      {children && <div className="max-w-prose text-ink-2">{children}</div>}
      {action}
    </div>
  );
}
