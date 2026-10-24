"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { ApprovalError, createRun, decideApproval, StartRunError } from "@/lib/agents/runs";
import { sendEvent } from "@/inngest/client";

export type FormState = { error: string } | null;

export async function startTaglineRun(_prev: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember();
  let runId: string;
  try {
    runId = await createRun(member, "tagline", { brandName: String(form.get("brandName") ?? "") }, sendEvent);
  } catch (err) {
    if (err instanceof StartRunError) return { error: err.message };
    throw err;
  }
  redirect(`/runs/${runId}`);
}

export async function decide(_prev: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember();
  const approvalId = String(form.get("approvalId") ?? "");
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "");
  try {
    if (intent === "approve") {
      const raw = form.get("choice");
      if (raw === null) return { error: "Choose a tagline first." };
      await decideApproval(member.userId, approvalId, { decision: "approved", choice: Number(raw), reason }, sendEvent);
    } else if (intent === "reject") {
      await decideApproval(member.userId, approvalId, { decision: "rejected", reason }, sendEvent);
    } else {
      return { error: "Unknown action." };
    }
  } catch (err) {
    if (err instanceof ApprovalError) return { error: err.message };
    return { error: "Couldn't record the decision. Nothing was changed; try again." };
  }
  return null;
}
