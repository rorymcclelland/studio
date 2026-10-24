import { connection } from "next/server";
import { configProblems } from "@/lib/env";

/** Shows what is missing instead of a blank page (S1-1 #4). */
export async function ConfigGate({ children }: { children: React.ReactNode }) {
  await connection();
  const problems = configProblems();
  if (problems.length === 0) return <>{children}</>;
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold">The app isn&apos;t configured yet</h1>
      <p className="mt-3 text-ink-2">
        Set these environment variables (in Vercel, or in <code>.env.local</code> when running locally), then reload.
      </p>
      <ul className="mt-6 space-y-2" aria-label="Configuration problems">
        {problems.map((p) => (
          <li key={p} className="rounded-md border border-line bg-surface px-4 py-3 text-sm">
            {p}
          </li>
        ))}
      </ul>
    </main>
  );
}
