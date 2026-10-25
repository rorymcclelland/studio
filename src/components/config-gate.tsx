import { connection } from "next/server";
import { Card } from "@/components/ui/card";
import { Wordmark } from "@/components/ui/wordmark";
import { configProblems } from "@/lib/env";

/** Shows what is missing instead of a blank page (S1-1 #4). */
export async function ConfigGate({ children }: { children: React.ReactNode }) {
  await connection();
  const problems = configProblems();
  if (problems.length === 0) return <>{children}</>;
  return <ConfigProblems problems={problems} />;
}

/** The configuration page. Exported so the component page can show it with sample problems. */
export function ConfigProblems({ problems, headingLevel = 1 }: { problems: string[]; headingLevel?: 1 | 3 }) {
  const H = headingLevel === 1 ? "h1" : "h3";
  const Wrapper = headingLevel === 1 ? "main" : "div";
  return (
    <Wrapper className={headingLevel === 1 ? "mx-auto max-w-2xl space-y-8 px-4 py-12 sm:py-16" : "space-y-6"}>
      {headingLevel === 1 && <Wordmark />}
      <Card size="hero" tone="attention">
        <H className="text-title font-strong">The app isn&apos;t configured yet</H>
        <p className="mt-3 text-ink-2">
          Set these environment variables (in Vercel, or in <code className="font-mono text-ink">.env.local</code>{" "}
          when running locally), then reload.
        </p>
        <ul className="mt-6 space-y-2" aria-label="Configuration problems">
          {problems.map((p) => (
            <li key={p} className="rounded-field bg-attention-soft px-4 py-3 text-sm font-medium text-attention-ink wrap-anywhere">
              {p}
            </li>
          ))}
        </ul>
      </Card>
    </Wrapper>
  );
}
