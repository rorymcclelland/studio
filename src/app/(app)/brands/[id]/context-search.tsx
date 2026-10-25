import Form from "next/form";
import type { ContextHit, ContextKind } from "@/lib/context/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pill, type PillTone } from "@/components/ui/pill";

const KIND: Record<ContextKind, { label: string; tone: PillTone }> = {
  brand_voice: { label: "Brand voice", tone: "active" },
  brand_rule: { label: "Brand rule", tone: "active" },
  legal: { label: "Legal", tone: "attention" },
  product: { label: "Product", tone: "neutral" },
  segment: { label: "Segment", tone: "good" },
  insight: { label: "Insight", tone: "good" },
  result: { label: "Result", tone: "neutral" },
};

/** Longest query that is searched; matches searchContext(). */
export const MAX_QUERY = 200;

/**
 * S2-5: search the brand's Business Context store. The query lives in the
 * address (?q=), so a search can be shared, and back returns to the last one.
 */
export function ContextSearch({
  brandName,
  query,
  hits,
}: {
  brandName: string;
  query: string;
  hits: ContextHit[];
}) {
  return (
    <Card as="section" aria-labelledby="search" tone="primary">
      <h2 id="search" className="text-2xl font-strong tracking-tight">
        Search what Studio knows
      </h2>
      <p className="mt-1 max-w-prose text-ink-2">
        The Business Context store holds this brand&apos;s kit, products and customer summaries. Agents read it from
        here.
      </p>
      <Form action="" scroll={false} role="search" className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="context-q" className="font-semibold">
            Search the context for {brandName}
          </label>
          <Input
            id="context-q"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={MAX_QUERY}
            placeholder="For example, lapsed or waterproof"
            autoComplete="off"
          />
        </div>
        <Button>Search</Button>
      </Form>

      <div className="mt-5">
        {!query ? (
          <p className="text-sm text-ink-2">
            Search by word or phrase: a product, a rule, a segment such as &ldquo;lapsed&rdquo; or &ldquo;repeat&rdquo;.
          </p>
        ) : (
          <>
            <p role="status" className="text-sm font-medium text-ink-2 wrap-anywhere">
              {hits.length === 0
                ? `Nothing matches “${query}”. Try a single word, such as a product name or a rule.`
                : `${hits.length} ${hits.length === 1 ? "result" : "results"} for “${query}”, best match first.`}
            </p>
            {hits.length > 0 && (
              <ol aria-label={`Results for ${query}`} className="mt-3 space-y-2">
                {hits.map((h) => (
                  <li key={h.id} data-search-result="" className="min-w-0 rounded-field border border-line bg-surface px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <Pill tone={KIND[h.kind]?.tone ?? "neutral"}>{KIND[h.kind]?.label ?? h.kind}</Pill>
                      <h3 className="min-w-0 font-semibold wrap-anywhere">{h.title}</h3>
                    </div>
                    <p className="mt-1.5 text-ink-2 wrap-anywhere">{h.body}</p>
                    <p className="mt-1.5 text-sm text-ink-2">Source: {h.source}</p>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
