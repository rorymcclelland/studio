import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { Wordmark } from "@/components/ui/wordmark";
import { acceptInvite } from "./actions";

export const metadata = { title: "Your invitation", robots: { index: false } };

// F-3: opening the link only shows this page; the invite is used when the
// person presses Continue, so a link preview can't use it up (review 3).
async function ContinueForm({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  return (
    <form action={acceptInvite.bind(null, token)} className="mt-6">
      <button
        type="submit"
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 font-semibold text-on-primary hover:bg-primary/90"
      >
        Continue to Studio
      </button>
    </form>
  );
}

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-4 py-12">
      <Wordmark className="self-start" />
      <Card size="hero">
        <h1 className="text-title font-strong">You&apos;ve been invited to Studio</h1>
        <p className="mt-3 text-ink-2">
          Studio is a multi-agent campaign studio built by Rory McClelland. The brands in it are fictional and their
          data is simulated. Continue to sign in with this one-time link; it works once.
        </p>
        <Suspense>
          <ContinueForm params={props.params} />
        </Suspense>
      </Card>
    </main>
  );
}
