import { Suspense } from "react";
import { ConfigGate } from "@/components/config-gate";
import { authMode } from "@/lib/env";
import { SignInForm } from "./signin-form";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Suspense>
      <ConfigGate>
        <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-ink-2">
            {authMode() === "dev"
              ? "Local development sign-in: enter an allow-listed email."
              : "Enter your email and we'll send you a sign-in link."}
          </p>
          <SignInForm dev={authMode() === "dev"} />
        </main>
      </ConfigGate>
    </Suspense>
  );
}
