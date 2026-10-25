import { cx } from "./cx";

/** Shared look for text inputs, text areas and selects. */
export const controlClass = cx(
  "w-full min-w-0 rounded-field border border-field-line bg-surface px-3.5 py-2.5 text-base text-ink",
  "placeholder:text-ink-2 disabled:cursor-not-allowed disabled:bg-surface-2",
  "aria-invalid:border-attention-ink aria-invalid:ring-2 aria-invalid:ring-attention-soft",
);

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input {...props} className={cx(controlClass, "min-h-11", className)} />;
}

export function Textarea({ className, rows = 4, ...props }: React.ComponentProps<"textarea">) {
  return <textarea rows={rows} {...props} className={cx(controlClass, "resize-y", className)} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span className="relative flex min-w-0">
      <select {...props} className={cx(controlClass, "min-h-11 appearance-none pr-10", className)}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 fill-none stroke-ink-2"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m4 6 4 4 4-4" />
      </svg>
    </span>
  );
}
