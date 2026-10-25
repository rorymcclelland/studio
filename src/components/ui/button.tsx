import Link from "next/link";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary/90",
  quiet: "bg-primary-soft text-ink hover:bg-primary-soft/60",
  danger: "bg-danger text-on-danger hover:bg-danger/90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-4 text-sm",
  md: "min-h-11 px-5 text-base",
  lg: "min-h-12 px-6 text-lg",
};

/** Class names for anything that should look like a button (links included). */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

type ButtonProps = React.ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

/** A button. Like the platform it submits by default; pass type="button" otherwise. */
export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

type ButtonLinkProps = React.ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

/** A link styled as a button, for actions that go somewhere. */
export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

/** An inline text link in the primary colour. */
export function TextLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link {...props} className={cx("font-medium text-primary underline-offset-4 hover:underline", className)} />
  );
}
