import type { PillTone } from "@/components/ui/pill";

/** How each kind of Business Context item is labelled wherever it is shown. */
export const CONTEXT_KIND: Record<string, { label: string; tone: PillTone }> = {
  brand_voice: { label: "Brand voice", tone: "active" },
  brand_rule: { label: "Brand rule", tone: "active" },
  legal: { label: "Legal", tone: "attention" },
  product: { label: "Product", tone: "neutral" },
  segment: { label: "Segment", tone: "good" },
  insight: { label: "Insight", tone: "good" },
  result: { label: "Result", tone: "neutral" },
};

export function contextKind(kind: string): { label: string; tone: PillTone } {
  return CONTEXT_KIND[kind] ?? { label: kind, tone: "neutral" };
}
