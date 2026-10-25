import { NotFoundCard } from "@/components/not-found-card";
import { Wordmark } from "@/components/ui/wordmark";

// Addresses that match no route. Inside the signed-in app, (app)/not-found.tsx
// shows the same card within the shell.
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl space-y-8 px-4 py-12 sm:py-16">
      <Wordmark />
      <NotFoundCard />
    </main>
  );
}
