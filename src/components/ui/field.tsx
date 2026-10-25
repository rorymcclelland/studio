import { Children, cloneElement, isValidElement } from "react";
import { cx } from "./cx";

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

/**
 * A labelled form control with an optional hint and error. Pass one control
 * (Input, Textarea or Select) as the child; Field gives it the id, links the
 * hint and error with aria-describedby and marks it invalid when there is an
 * error.
 */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactElement<ControlProps>;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const child = Children.only(children);
  const control = isValidElement<ControlProps>(child)
    ? cloneElement(child, {
        id,
        "aria-describedby": cx(child.props["aria-describedby"], hintId, errorId) || undefined,
        "aria-invalid": error ? true : child.props["aria-invalid"],
      })
    : child;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-2">
          {hint}
        </p>
      )}
      {control}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-attention-ink">
          {error}
        </p>
      )}
    </div>
  );
}
