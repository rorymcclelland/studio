// U10-2: the overview's "Needs you" list, from the same facts as the stage
// bar (needsYou() in src/lib/campaigns/stages.ts). Each item links to the
// place it is done; approvals stay there and in the inbox (rule 3), so the
// overview only links. With nothing to do it says so, rather than showing an
// empty list.
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { NOTHING_NEEDS_YOU, type NeedView } from "@/lib/campaigns/stages";

export function NeedsYou({ items }: { items: NeedView[] }) {
  return (
    <Card as="section" aria-labelledby="needs-you" tone={items.length > 0 ? "primary" : "plain"} data-needs-you="" className="space-y-3">
      <h2 id="needs-you" className="text-xl font-strong tracking-tight">
        Needs you
      </h2>
      {items.length === 0 ? (
        <p className="text-ink-2" data-nothing-needs-you="">
          {NOTHING_NEEDS_YOU}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} data-need={n.id}>
              <Link
                href={n.href}
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline wrap-anywhere"
              >
                {n.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
