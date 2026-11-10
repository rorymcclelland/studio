"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export type ProductRow = { id: string; name: string; category: string; price: string; active: boolean };

/** How many products show before "Show all", so the Products and data tab stays short (U10-7). */
export const FIRST_PRODUCTS = 8;

/** The brand's products by category; past the first few, the rest open on request (U10-7). */
export function ProductsTable({ brandName, rows }: { brandName: string; rows: ProductRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows.length : Math.min(rows.length, FIRST_PRODUCTS);
  return (
    <>
      <div className="mt-4 overflow-hidden rounded-card bg-surface">
        <table className="w-full table-fixed text-left">
          <caption className="sr-only">Products of {brandName}</caption>
          <thead className="border-b border-line text-sm text-ink-2">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold sm:px-6">
                Product
              </th>
              <th scope="col" className="hidden w-44 px-4 py-3 font-semibold sm:table-cell">
                Category
              </th>
              <th scope="col" className="w-28 px-4 py-3 text-right font-semibold sm:pr-6">
                Price
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.id} hidden={i >= shown} className="border-line align-top not-first:border-t">
                <td className="px-4 py-2.5 sm:px-6">
                  <span className="font-medium wrap-anywhere">{p.name}</span>
                  {!p.active && <span className="ml-2 text-sm text-ink-2">No longer sold</span>}
                  <span className="mt-0.5 block text-sm text-ink-2 sm:hidden">{p.category}</span>
                </td>
                <td className="hidden px-4 py-2.5 text-ink-2 sm:table-cell">{p.category}</td>
                <td className="px-4 py-2.5 text-right tabular-nums sm:pr-6">{p.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > FIRST_PRODUCTS && (
        <Button type="button" variant="quiet" size="sm" className="mt-3" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? `Show the first ${FIRST_PRODUCTS} products` : `Show all ${rows.length} products`}
        </Button>
      )}
    </>
  );
}
