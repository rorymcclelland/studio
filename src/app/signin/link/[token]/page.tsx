import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { Wordmark } from "@/components/ui/wordmark";
import { continueSignIn } from "./actions";

export const metadata = { title: "Sign in to Studio", robots: { index: false } };

// N-3: opening the link only shows this page; the link is used when the
// person presses Continue, so a link preview can't use it up.
async function ContinueForm({ params }: { params: PageProps<"/signin/link/[token]">["params"] }) {
  const { token } = await params;
  return (
    <form action={continueSignIn.bind(null, token)} className="mt-6">
      <button
        type="submit"
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 font-semibold text-on-primary hover:bg-primary/90"
      >
        Continue to Studio
      </button>
    </form>
  );
}

export default function SignInLinkPage(props: PageProps<"/signin/link/[token]">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-4 py-12">
      <Wordmark className="self-start" />
      <Card size="hero">
        <h1 className="text-title font-strong">Sign in to Studio</h1>
        <p className="mt-3 text-ink-2">
          Studio is a multi-agent campaign studio built by Rory McClelland. The brands in it are fictional and their
          data is simulated. Press Continue to sign in. This link works once, and only for 15 minutes after it was sent.
        </p>
        <Suspense>
          <ContinueForm params={props.params} />
        </Suspense>
      </Card>
    </main>
  );
}
