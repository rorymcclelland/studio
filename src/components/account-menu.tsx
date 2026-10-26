import { Button } from "@/components/ui/button";
import { signOut } from "@/app/signin/actions";
import { MenuLink } from "./menu-link";

/**
 * The account button and its menu. Uses the platform popover, so it opens
 * with Enter or Space, closes with Escape or a click outside, and needs no
 * script. The owner also gets the Invites page (F-3).
 */
export function AccountMenu({ email, owner = false }: { email: string; owner?: boolean }) {
  const initial = email.trim().charAt(0).toUpperCase() || "?";
  return (
    <div>
      <button
        type="button"
        popoverTarget="account-menu"
        title="Account"
        className="inline-flex min-h-10 items-center gap-2 rounded-full bg-surface py-1 pr-3 pl-1 font-medium lg:pr-1"
      >
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-primary-soft font-bold text-ink">
          {initial}
        </span>
        {/* On wide screens only the initial shows, so the header stays on one row. */}
        <span className="lg:sr-only">Account</span>
      </button>
      <div
        id="account-menu"
        popover="auto"
        className="inset-auto top-18 right-4 m-0 w-72 max-w-[calc(100vw-2rem)] rounded-card bg-surface p-5 text-ink shadow-xl ring-1 shadow-ink/10 ring-line"
      >
        <p className="text-sm text-ink-2">Signed in as</p>
        <p className="mt-0.5 font-semibold break-all">{email}</p>
        {owner && (
          <div className="mt-4">
            <MenuLink href="/invites" popover="account-menu">
              Invites
            </MenuLink>
          </div>
        )}
        <form action={signOut} className={owner ? "mt-2" : "mt-4"}>
          <Button variant="quiet" size="sm" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
