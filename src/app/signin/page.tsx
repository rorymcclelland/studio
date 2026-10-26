import { Suspense } from "react";
import { ConfigGate } from "@/components/config-gate";
import { Card } from "@/components/ui/card";
import { Wordmark } from "@/components/ui/wordmark";
import { authMode } from "@/lib/env";
import { SignInForm } from "./signin-form";

export const metadata = { title: "Sign in" };

// F-3: where a failed invite link lands (src/app/invite/[token]/actions.ts).
const INVITE_NOTICE: Record<string, string> = {
  expired: "This invite has expired or was already used. Ask Rory for a new one.",
  unavailable: "Signing in with an invite isn't working right now, so your link wasn't used. Try it again later, or ask Rory.",
};

async function InviteNotice({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const { invite } = await searchParams;
  const text = typeof invite === "string" ? INVITE_NOTICE[invite] : undefined;
  if (!text) return null;
  return (
    <p role="alert" data-invite-notice={invite} className="mt-4 rounded-field bg-attention-soft px-4 py-3 font-medium text-attention-ink">
      {text}
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
            <InviteNotice searchParams={props.searchParams} />
            <p className="mt-3 text-ink-2">
              {authMode() === "dev"
                ? "Local development sign-in: enter an allow-listed email."
                : "Enter your email and we'll send you a sign-in link."}
            </p>
            <SignInForm dev={authMode() === "dev"} />
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
