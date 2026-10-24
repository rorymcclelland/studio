import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db/client";
import { asUser } from "@/lib/db/scoped";

/** Creates an auth user directly (local shim only) and returns its id. */
export async function createUser(email = `${randomUUID()}@example.test`): Promise<string> {
  const sql = getSql();
  const [row] = await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`;
  return row.id as string;
}

/** Creates a user with a workspace; returns both ids. */
export async function createMember(): Promise<{ userId: string; workspaceId: string }> {
  const userId = await createUser();
  const workspaceId = await asUser(userId, async (tx) => {
    const [r] = await tx`select public.ensure_workspace() as id`;
    return r.id as string;
  });
  return { userId, workspaceId };
}

export async function truncateAll(): Promise<void> {
  const sql = getSql();
  await sql`truncate public.usage_ledger, public.approvals, public.agent_steps, public.agent_runs,
    public.profiles, public.workspace_members, public.workspaces, auth.users cascade`;
}
