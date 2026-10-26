import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { INVITE_DAYS, listInvites, type Invite } from "@/lib/auth/invites";
import { isOwnerEmail } from "@/lib/env";
import { formatDay } from "@/components/format-day";
import { Card } from "@/components/ui/card";
import { Pill, type PillTone } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatWhen } from "@/lib/format";
import { InviteForm, RevokeButton } from "./invite-form";

export const metadata = { title: "Invites" };

const STATE: Record<Invite["state"], { text: string; tone: PillTone }> = {
  open: { text: "Open", tone: "active" },
  used: { text: "Used", tone: "good" },
  expired: { text: "Expired", tone: "neutral" },
  revoked: { text: "Revoked", tone: "neutral" },
};

function stateLine(i: Invite): string {
  switch (i.state) {
    case "open":
      return `Works until ${formatDay(i.expiresAt)}`;
    case "used":
      return i.usedAt ? `Signed in ${formatWhen(i.usedAt)}` : "Signed in";
    case "expired":
      return `Expired ${formatDay(i.expiresAt)}`;
    case "revoked":
      return i.revokedAt ? `Revoked ${formatWhen(i.revokedAt)}` : "Revoked";
  }
}

async function InvitesContent() {
  const member = await requireMember();
  // F-3: only the owner may invite people; anyone else sees the not-found page.
  if (!isOwnerEmail(member.email)) notFound();
  const invites = await listInvites(member);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-title font-strong">Invites</h1>
        <p className="mt-2 max-w-prose text-lg text-ink-2">
          Invite someone to try Studio. They get their own empty workspace, with the demo brands one click away, and
          can&apos;t see yours. No email is sent: you copy the link and send it yourself.
        </p>
      </div>

      <Card as="section" aria-labelledby="new-invite">
        <h2 id="new-invite" className="text-2xl font-strong tracking-tight">
          New invite
        </h2>
        <p className="mt-1 mb-5 max-w-prose text-ink-2">
          The link signs them in once and lasts {INVITE_DAYS} days. If they are signed out later, make them a new invite.
        </p>
        <InviteForm />
      </Card>

      <section aria-labelledby="invite-list">
        <h2 id="invite-list" className="text-2xl font-strong tracking-tight">
          Invites so far
        </h2>
        {invites.length === 0 ? (
          <p className="mt-2 text-ink-2">No invites yet.</p>
        ) : (
          <>
            <p className="mt-1 max-w-prose text-ink-2">
              Newest first. Revoking an open invite stops the link working; revoking a used one signs that person out on
              their next page.
            </p>
            <ul aria-label={`Invites (${invites.length})`} className="mt-4 overflow-hidden rounded-card bg-surface">
              {invites.map((i) => (
                <li
                  key={i.id}
                  data-invite={i.state}
                  className="flex flex-col gap-3 border-line px-5 py-4 not-first:border-t sm:flex-row sm:items-center sm:gap-4 sm:px-6"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="font-semibold break-all">{i.email}</span>
                      <Pill tone={STATE[i.state].tone} dot>
                        {STATE[i.state].text}
                      </Pill>
                    </p>
                    <p className="mt-1 text-sm text-ink-2">
                      Created {formatWhen(i.createdAt)}. {stateLine(i)}.
                    </p>
                    {i.note && <p className="mt-1 text-sm wrap-anywhere">{i.note}</p>}
                  </div>
                  {(i.state === "open" || i.state === "used") && <RevokeButton inviteId={i.id} email={i.email} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

export default function InvitesPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the invites" />}>
      <InvitesContent />
    </Suspense>
  );
}
