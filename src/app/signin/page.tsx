import { Suspense } from "react";
import { ConfigGate } from "@/components/config-gate";
import { Card } from "@/components/ui/card";
import { Wordmark } from "@/components/ui/wordmark";
import { authMode } from "@/lib/env";
import { SignInForm } from "./signin-form";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Suspense>
      <ConfigGate>
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-4 py-12">
          <Wordmark className="self-start" />
          <Card size="hero">
            <h1 className="text-title font-strong">Sign in</h1>
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
