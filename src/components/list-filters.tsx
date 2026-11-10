import { Button, TextLink } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";

export type FilterSelect = {
  /** The address parameter, and the select's name. */
  name: string;
  label: string;
  /** The first option, meaning no filter ("All campaigns"); its value is empty. */
  all: string;
  options: { value: string; label: string }[];
  /** The value applied now, or "" for none. */
  value: string;
  /** Takes the whole row on a phone. */
  wide?: boolean;
};

/**
 * U10-8: a list's filters, as a plain GET form, so the filters are in the address: they survive a reload and can be
 * shared. "Clear filters" shows while any filter is applied.
 */
export function ListFilters({
  action,
  label,
  selects,
  clearHref,
  gridClass = "grid-cols-2",
  className,
  ...data
}: {
  action: string;
  label: string;
  selects: FilterSelect[];
  /** Where Clear filters goes, or null when no filter is applied. */
  clearHref: string | null;
  /** The selects' columns: two on a phone (a wide one takes both), more from sm up. */
  gridClass?: string;
  className?: string;
} & Record<`data-${string}`, string>) {
  const id = action.replace(/[^a-z]/g, "");
  // Keyed by what is applied, so the selects show it again after Clear filters (a client-side navigation).
  const key = selects.map((s) => s.value).join("|");
  return (
    <form key={key} method="get" action={action} aria-label={label} className={cx("flex flex-wrap items-end gap-x-4 gap-y-3", className)} {...data}>
      <div className={cx("grid min-w-0 flex-1 basis-full gap-x-3 gap-y-3 sm:basis-0", gridClass)}>
        {selects.map((s) => (
          <Field key={s.name} id={`${id}-filter-${s.name}`} label={s.label} className={cx("min-w-0", s.wide && "col-span-2 sm:col-span-1")}>
            <Select name={s.name} defaultValue={s.value}>
              <option value="">{s.all}</option>
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <div className="flex items-center gap-x-4">
        <Button variant="quiet" className="min-h-11">
          Apply filters
        </Button>
        {clearHref && <TextLink href={clearHref}>Clear filters</TextLink>}
      </div>
    </form>
  );
}
