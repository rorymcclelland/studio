import Link from "next/link";
import { Suspense } from "react";
import { ConfigGate } from "@/components/config-gate";
import { SpendMeter } from "@/components/spend-meter";
import { requireMember } from "@/lib/auth/session";
import { signOut } from "../signin/actions";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ConfigGate>
        <Shell>{children}</Shell>
      </ConfigGate>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Studio <span className="font-normal text-ink-2">(working title)</span>
          </Link>
          <nav className="flex gap-4 text-sm" aria-label="Main">
            <Link href="/" className="hover:text-accent">Home</Link>
            <Link href="/runs" className="hover:text-accent">Agent runs</Link>
            <Link href="/directions" className="hover:text-accent">Design directions</Link>
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <SpendMeter userId={member.userId} />
            <span className="hidden text-ink-2 sm:inline">{member.email}</span>
            <form action={signOut}>
              <button className="text-ink-2 hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

function ShellSkeleton() {
  return <div className="h-14 border-b border-line bg-surface" aria-hidden />;
}
