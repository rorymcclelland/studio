import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-2 text-ink-2">
        There&apos;s nothing at this address in your workspace. It may belong to another workspace, or the link may be
        wrong.
      </p>
      <Link href="/" className="mt-6 inline-block text-accent">Go to the home page</Link>
    </main>
  );
}
