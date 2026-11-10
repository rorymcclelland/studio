"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { parseDataProfile, penceFromPounds, POPULARITY, type Popularity, type PROFILE_LIMITS } from "@/lib/demo/profile";
import { generateData } from "./actions";

const REFUSED = "Some fields need changing. Nothing was saved.";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const POPULARITY_LABEL: Record<Popularity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

type ProductRow = {
  key: number;
  name: string;
  category: string;
  price: string;
  popularity: Popularity;
};
type Errors = Record<string, string>;

let nextKey = 1;
const emptyRow = (): ProductRow => ({
  key: nextKey++,
  name: "",
  category: "",
  price: "",
  popularity: "medium",
});
/** The control an error path belongs to: "products.0.pricePence" → "sd-products-0-pricePence". */
const fieldId = (path: string) => `sd-${path.replaceAll(".", "-")}`;

/**
 * D-3: the short profile simulated data is made from. Checked here and again on
 * the server; a refusal says what to change beside each field, and nothing is saved.
 */
export function SimulatedDataForm({ brandId, limits }: { brandId: string; limits: typeof PROFILE_LIMITS }) {
  const [products, setProducts] = useState<ProductRow[]>(() => [emptyRow()]);
  const [customers, setCustomers] = useState(String(limits.defaultCustomers));
  const [regionSet, setRegionSet] = useState<"uk" | "japan">("uk");
  const [months, setMonths] = useState<number[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The id to focus after the next render (a field to fix, or a new row).
  const focusNext = useRef<string | null>(null);
  const setFocusTo = (id: string) => {
    focusNext.current = id;
  };

  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const clear = (...paths: string[]) =>
    setErrors((e) => {
      if (!paths.some((p) => p in e)) return e;
      const next = { ...e };
      for (const p of paths) delete next[p];
      return next;
    });

  const editRow = (key: number, change: Partial<ProductRow>, path: string) => {
    setRow(key, change);
    clear(path);
  };
  const setRow = (key: number, change: Partial<ProductRow>) => setProducts((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const refuse = (message: string, fieldErrors: Errors) => {
    setErrors(fieldErrors);
    setFormError(message);
    // Focus the first field to fix, in the order the form shows them.
    const order = [
      ...products.flatMap((_, i) => ["name", "category", "pricePence", "popularity"].map((f) => `products.${i}.${f}`)),
      "products",
      "customers",
      "regionSet",
      "busiestMonths",
    ];
    const first = order.find((k) => fieldErrors[k]);
    if (first === "products") setFocusTo(products.length < limits.maxProducts ? "sd-add-product" : fieldId("products"));
    else if (first) setFocusTo(fieldId(first));
    else setFocusTo("sd-alert");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Prices are typed in pounds; one that isn't a price is said as such, before the profile's own checks.
    const priceErrors: Errors = {};
    const profile = {
      products: products.map((p, i) => {
        const pence = penceFromPounds(p.price);
        if (pence === null) priceErrors[`products.${i}.pricePence`] = "Use a price such as 12.50.";
        return {
          name: p.name,
          category: p.category,
          pricePence: pence ?? 0,
          popularity: p.popularity,
        };
      }),
      customers: customers.trim() === "" ? Number.NaN : Number(customers),
      regionSet,
      busiestMonths: [...months].sort((a, b) => a - b),
    };
    const checked = parseDataProfile(profile);
    const fieldErrors = {
      ...(checked.ok ? {} : checked.fieldErrors),
      ...priceErrors,
    };
    if (Object.keys(fieldErrors).length > 0) return refuse(REFUSED, fieldErrors);
    setFormError(null);
    startTransition(async () => {
      // On success the action opens the brand's Products and data tab; it only returns when nothing was saved.
      const state = await generateData(brandId, profile);
      if (state) refuse(state.error, state.fieldErrors);
    });
  };

  const full = products.length >= limits.maxProducts;
  return (
    <form data-simulated-data-form="" noValidate onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
      {formError && (
        <div id="sd-alert" tabIndex={-1} role="alert" className="space-y-1 font-medium text-attention-ink">
          <p>{formError}</p>
          {errors.products && <p>{errors.products}</p>}
        </div>
      )}

      <Card
        as="fieldset"
        id={fieldId("products")}
        tabIndex={-1}
        aria-describedby={cx("sd-products-hint", errors.products && "sd-products-error")}
        className="space-y-4"
      >
        <legend className="sr-only">Products</legend>
        <div aria-hidden className="text-2xl font-strong tracking-tight">
          Products
        </div>
        <p id="sd-products-hint" className="-mt-2 text-ink-2">
          One to {limits.maxProducts}, each with its price and how popular it is. Popular products sell more often.
        </p>
        {products.length === 0 && <p className="text-ink-2">No products yet.</p>}
        <ol className="space-y-4">
          {products.map((p, i) => {
            const n = i + 1;
            const at = (f: string) => `products.${i}.${f}`;
            return (
              <li key={p.key} className="rounded-card bg-bg p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Product {n}</h3>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    onClick={() => {
                      setProducts((rows) => rows.filter((r) => r.key !== p.key));
                      setErrors({});
                      setFocusTo(i > 0 ? fieldId(`products.${i - 1}.name`) : "sd-add-product");
                    }}
                  >
                    Remove product {n}
                  </Button>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field id={fieldId(at("name"))} label="Name" error={errors[at("name")]}>
                    <Input aria-label={`Product ${n} name`} value={p.name} onChange={(e) => editRow(p.key, { name: e.target.value }, at("name"))} />
                  </Field>
                  <Field id={fieldId(at("category"))} label="Category" error={errors[at("category")]}>
                    <Input
                      aria-label={`Product ${n} category`}
                      value={p.category}
                      onChange={(e) => editRow(p.key, { category: e.target.value }, at("category"))}
                    />
                  </Field>
                  <Field id={fieldId(at("pricePence"))} label="Price (£)" error={errors[at("pricePence")]}>
                    <Input
                      aria-label={`Product ${n} price (£)`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="12.50"
                      value={p.price}
                      onChange={(e) => editRow(p.key, { price: e.target.value }, at("pricePence"))}
                    />
                  </Field>
                  <Field id={fieldId(at("popularity"))} label="Popularity" error={errors[at("popularity")]}>
                    <Select
                      aria-label={`Product ${n} popularity`}
                      value={p.popularity}
                      onChange={(e) =>
                        editRow(
                          p.key,
                          {
                            popularity: e.target.value as Popularity,
                          },
                          at("popularity"),
                        )
                      }
                    >
                      {POPULARITY.map((v) => (
                        <option key={v} value={v}>
                          {POPULARITY_LABEL[v]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </li>
            );
          })}
        </ol>
        {errors.products && (
          <p id="sd-products-error" className="text-sm font-medium text-attention-ink">
            {errors.products}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            id="sd-add-product"
            type="button"
            variant="quiet"
            size="sm"
            disabled={full}
            onClick={() => {
              setProducts((rows) => [...rows, emptyRow()]);
              clear("products");
              setFocusTo(fieldId(`products.${products.length}.name`));
            }}
          >
            <span aria-hidden>+</span> Add a product
          </Button>
          {full && <span className="text-sm text-ink-2">That&apos;s the most allowed ({limits.maxProducts}).</span>}
        </div>
      </Card>

      <Card className="space-y-6">
        <Field id={fieldId("customers")} label="Customers" hint="500 to 20,000." error={errors.customers} className="max-w-xs">
          <Input
            type="number"
            inputMode="numeric"
            min={limits.minCustomers}
            max={limits.maxCustomers}
            step={1}
            value={customers}
            onChange={(e) => {
              setCustomers(e.target.value);
              clear("customers");
            }}
          />
        </Field>

        <fieldset id={fieldId("regionSet")} tabIndex={-1} aria-describedby={errors.regionSet ? "sd-regionSet-error" : undefined} className="space-y-2">
          <legend className="font-semibold">Regions</legend>
          <p className="text-sm text-ink-2">Where the customers live: the 12 UK regions, or Japan&apos;s 8 regions.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ["uk", "UK regions"],
                ["japan", "Japan's regions"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="regionSet"
                  value={value}
                  checked={regionSet === value}
                  onChange={() => {
                    setRegionSet(value);
                    clear("regionSet");
                  }}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
            ))}
          </div>
          {errors.regionSet && (
            <p id="sd-regionSet-error" className="text-sm font-medium text-attention-ink">
              {errors.regionSet}
            </p>
          )}
        </fieldset>

        <fieldset
          id={fieldId("busiestMonths")}
          tabIndex={-1}
          aria-describedby={cx("sd-busiestMonths-hint", errors.busiestMonths && "sd-busiestMonths-error")}
          className="space-y-2"
        >
          <legend className="font-semibold">Busiest months</legend>
          <p id="sd-busiestMonths-hint" className="text-sm text-ink-2">
            One to three months when the brand sells most.
          </p>
          <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
            {MONTHS.map((m, i) => (
              <label key={m} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={months.includes(i + 1)}
                  onChange={(e) => {
                    setMonths((ms) => (e.target.checked ? [...ms, i + 1] : ms.filter((x) => x !== i + 1)));
                    clear("busiestMonths");
                  }}
                  className="size-4 accent-primary"
                />
                {m}
              </label>
            ))}
          </div>
          {errors.busiestMonths && (
            <p id="sd-busiestMonths-error" className="text-sm font-medium text-attention-ink">
              {errors.busiestMonths}
            </p>
          )}
        </fieldset>
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Generating…" : "Generate data"}
        </Button>
        <p role="status" className="text-sm text-ink-2">
          {pending ? "Making the customers and two years of orders. This takes a few seconds." : ""}
        </p>
      </div>
    </form>
  );
}
