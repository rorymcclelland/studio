import { Suspense } from "react";
import { ConfigGate } from "@/components/config-gate";
import { Card } from "@/components/ui/card";
import { Wordmark } from "@/components/ui/wordmark";
import { SignInForm } from "./signin-form";

export const metadata = { title: "Sign in" };

// Where a failed invite link (src/app/invite/[token]/actions.ts) or sign-in
// link (src/app/signin/link/[token]/actions.ts) lands.
const NOTICE: Record<string, { key: string; text: string }> = {
  "invite:expired": {
    key: "expired",
    text: "This invite link has expired or was already used. If you've signed in before, enter your email below for a sign-in link; if not, ask Rory for a new invite.",
  },
  "link:expired": {
    key: "link-expired",
    text: "This link has expired. Sign-in links work once, for 15 minutes. Enter your email below for a new one.",
  },
};

async function Notice({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const { invite, link } = await searchParams;
  const notice =
    (typeof invite === "string" ? NOTICE[`invite:${invite}`] : undefined) ??
    (typeof link === "string" ? NOTICE[`link:${link}`] : undefined);
  if (!notice) return null;
  return (
    <p role="alert" data-invite-notice={notice.key} className="mt-4 rounded-field bg-attention-soft px-4 py-3 font-medium text-attention-ink">
      {notice.text}
    </p>
  );
}

export default function SignInPage(props: PageProps<"/signin">) {
  return (
    <Suspense>
      <ConfigGate>
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-4 py-12">
          <Wordmark className="self-start" />
          <Card size="hero">
            <h1 className="text-title font-strong">Sign in</h1>
            <Notice searchParams={props.searchParams} />
            <p className="mt-3 text-ink-2">Enter your email and we&apos;ll send you a sign-in link.</p>
            <SignInForm />
            <p data-invite-help className="mt-4 text-sm text-ink-2">
              Anyone with access, invited people included, can sign in here with their email.
            </p>
          </Card>
          <p className="px-2 text-sm text-ink-2">
            Studio is a multi-agent campaign studio. Agents propose; you approve every move that spends, publishes or
            replaces creative.
          </p>
        </main>
      </ConfigGate>
    </Suspense>
  );
}
