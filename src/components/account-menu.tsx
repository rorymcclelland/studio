import { Button } from "@/components/ui/button";
import { signOut } from "@/app/signin/actions";

/**
 * The account button and its menu. Uses the platform popover, so it opens
 * with Enter or Space, closes with Escape or a click outside, and needs no
 * script.
 */
export function AccountMenu({ email }: { email: string }) {
  const initial = email.trim().charAt(0).toUpperCase() || "?";
  return (
    <div>
      <button
        type="button"
        popoverTarget="account-menu"
        className="inline-flex min-h-10 items-center gap-2 rounded-full bg-surface py-1 pr-3 pl-1 font-medium"
      >
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-primary-soft font-bold text-ink">
          {initial}
        </span>
        Account
      </button>
      <div
        id="account-menu"
        popover="auto"
        className="inset-auto top-18 right-4 m-0 w-72 max-w-[calc(100vw-2rem)] rounded-card bg-surface p-5 text-ink shadow-xl ring-1 shadow-ink/10 ring-line"
      >
        <p className="text-sm text-ink-2">Signed in as</p>
        <p className="mt-0.5 font-semibold break-all">{email}</p>
        <form action={signOut} className="mt-4">
          <Button variant="quiet" size="sm" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
