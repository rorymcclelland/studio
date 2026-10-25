import { cx } from "./cx";

export type CardTone = "plain" | "primary" | "good" | "review" | "attention";

const TONES: Record<CardTone, string> = {
  plain: "border-transparent",
  primary: "border-primary-soft",
  good: "border-good-soft",
  review: "border-review-soft",
  attention: "border-attention-soft",
};

type CardProps<T extends React.ElementType> = {
  as?: T;
  tone?: CardTone;
  /** "hero" is the large rounded panel at the top of a screen. */
  size?: "md" | "hero";
  className?: string;
  children?: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

/** A soft white panel. A tone adds a pale border in the status colour. */
export function Card<T extends React.ElementType = "div">({
  as,
  tone = "plain",
  size = "md",
  className,
  children,
  ...props
}: CardProps<T>) {
  const Tag = (as ?? "div") as React.ElementType;
  return (
    <Tag
      {...props}
      className={cx(
        "min-w-0 border-2 bg-surface",
        size === "hero" ? "rounded-hero p-6 sm:p-10" : "rounded-card p-5 sm:p-6",
        TONES[tone],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
