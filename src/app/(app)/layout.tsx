import { Suspense } from "react";
import { AccountMenu } from "@/components/account-menu";
import { ConfigGate } from "@/components/config-gate";
import { SpendMeter } from "@/components/spend-meter";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastProvider } from "@/components/ui/toast";
import { Wordmark } from "@/components/ui/wordmark";
import { requireMember } from "@/lib/auth/session";

const NAV = [
  { href: "/", label: "Home", match: "exact" as const },
  { href: "/brands", label: "Brands" },
  { href: "/runs", label: "Agent runs" },
];

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
    <ToastProvider>
      <div className="min-h-screen">
        <a
          href="#main"
          className="sr-only rounded-full bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>
        {/* One row on wide screens: wordmark, nav, spend, account. On narrow
            screens the account button stays beside the wordmark and the nav
            and spend meter wrap below. Source order follows the wide layout. */}
        <header className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-3 px-4 pt-5 pb-2 sm:px-8">
          <Wordmark className="order-1" />
          <SegmentedNav items={NAV} label="Main" className="order-3 lg:order-2 lg:ml-4" />
          <div className="order-4 lg:order-3 lg:ml-auto">
            <SpendMeter userId={member.userId} />
          </div>
          <div className="order-2 ml-auto lg:order-4 lg:ml-0">
            <AccountMenu email={member.email} />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-8">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 pt-5 sm:px-8" role="status">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-9 w-48" />
    </div>
  );
}
