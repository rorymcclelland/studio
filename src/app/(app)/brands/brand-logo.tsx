import { cx } from "@/components/ui/cx";

/**
 * A brand's logo. The SVG text is already sanitised when stored (S2-2); it is
 * still only ever shown as an image from a data URL, never as inline markup,
 * so nothing in it can run or reach the page.
 */
export function BrandLogo({
  name,
  svg,
  decorative = false,
  className,
}: {
  name: string;
  svg: string | null;
  /** True when the brand's name is shown beside the logo as text. */
  decorative?: boolean;
  className?: string;
}) {
  if (!svg) {
    return (
      <span
        aria-hidden={decorative || undefined}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : `${name} (no logo yet)`}
        className={cx("grid aspect-square place-items-center rounded-logo bg-primary-soft font-bold text-ink", className)}
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    // A data URL needs no image optimisation, and next/image adds nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
      alt={decorative ? "" : `${name} logo`}
      className={cx("block max-w-full object-contain object-left", className)}
    />
  );
}
