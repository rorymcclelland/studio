"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { inviteSomeone, revoke, type InviteState } from "./actions";

/** F-3: invite someone by email. The link is shown once, here, for the owner to send themselves. */
export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteSomeone, null);
  const form = useRef<HTMLFormElement>(null);
  const linkBox = useRef<HTMLDivElement>(null);
  const error = state && "error" in state ? state.error : undefined;
  const link = state && "done" in state ? (state.link ?? null) : null;

  useEffect(() => {
    if (!link) return;
    form.current?.reset();
    linkBox.current?.focus();
  }, [link]);

  return (
    <div className="space-y-5">
      <form ref={form} action={action} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Field id="invite-email" label="Email" error={error}>
          <Input type="email" name="email" required autoComplete="off" maxLength={254} />
        </Field>
        <Field id="invite-note" label="Note for you (optional)">
          <Input name="note" maxLength={200} autoComplete="off" />
        </Field>
        <Button disabled={pending} className="self-end">
          {pending ? "Creating…" : "Create invite link"}
        </Button>
      </form>
      {link && state && "done" in state && <CreatedLink ref={linkBox} link={link} message={state.done} />}
    </div>
  );
}

function CreatedLink({ link, message, ref }: { link: string; message: string; ref: React.Ref<HTMLDivElement> }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      data-invite-link=""
      className="space-y-3 rounded-field border-2 border-good-soft bg-good-soft px-4 py-4 text-good-ink"
    >
      <p className="font-semibold">{message}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="invite-link" className="sr-only">
          Invite link
        </label>
        <input
          id="invite-link"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-11 w-full min-w-0 rounded-field border border-field-line bg-surface px-3.5 py-2.5 font-mono text-sm text-ink"
        />
        <Button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied("yes");
            } catch {
              setCopied("no");
            }
          }}
        >
          Copy link
        </Button>
      </div>
      <p aria-live="polite" className="text-sm">
        {copied === "yes"
          ? "Copied. Paste it into your own message to them."
          : copied === "no"
            ? "Couldn't copy here. Select the link and copy it by hand."
            : "It works once, for 7 days. It won't be shown again; if it's lost, revoke it and make another."}
      </p>
    </div>
  );
}

/** Revokes an invite: the link stops working, and anyone who signed in with it is signed out. */
export function RevokeButton({ inviteId, email }: { inviteId: string; email: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        type="button"
        size="sm"
        variant="quiet"
        disabled={pending}
        aria-label={`Revoke the invite for ${email}`}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await revoke(inviteId);
            if (r && "done" in r) toast({ message: r.done, tone: "good" });
            else if (r && "error" in r) setError(r.error);
          })
        }
      >
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-attention-ink">
          {error}
        </p>
      )}
    </div>
  );
}
