"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireMember } from "@/lib/auth/session";
import { createInvite, InviteError, revokeInvite } from "@/lib/auth/invites";

export type InviteState = { error: string } | { done: string; link?: string } | null;

/** F-3: creates an invite and returns the full one-time link to copy (it is shown once). */
export async function inviteSomeone(_prev: InviteState, form: FormData): Promise<InviteState> {
  const member = await requireMember();
  try {
    const { path } = await createInvite(member, String(form.get("email") ?? ""), String(form.get("note") ?? ""));
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    revalidatePath("/invites");
    return { done: "Invite created. Copy the link now: it is shown once, works once and lasts 7 days.", link: `${origin}${path}` };
  } catch (err) {
    if (err instanceof InviteError) return { error: err.message };
    console.error("[inviteSomeone]", err);
    return { error: "Couldn't create the invite. Try again." };
  }
}

export async function revoke(inviteId: string): Promise<InviteState> {
  const member = await requireMember();
  try {
    const email = await revokeInvite(member, inviteId);
    revalidatePath("/invites");
    return { done: `Revoked ${email}: their links no longer work, and they can no longer sign in.` };
  } catch (err) {
    if (err instanceof InviteError) return { error: err.message };
    throw err;
  }
}
