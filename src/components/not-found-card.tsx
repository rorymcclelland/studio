import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** The not-found message, shared by the signed-in shell and the bare page. */
export function NotFoundCard() {
  return (
    <Card size="hero" className="max-w-xl">
      <span aria-hidden className="block h-9 w-11 rounded-pebble bg-primary-soft" />
      <h1 className="mt-4 text-title font-strong">Not found</h1>
      <p className="mt-3 text-ink-2">
        There&apos;s nothing at this address in your workspace. It may belong to another workspace, or the link may be
        wrong.
      </p>
      <ButtonLink href="/" className="mt-6">
        Go to the home page
      </ButtonLink>
    </Card>
  );
}
