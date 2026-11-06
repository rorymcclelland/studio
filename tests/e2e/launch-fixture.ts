// A browser-test fixture, not an app route. A launch's terms (its seed,
// threshold, ads, budget, length and start) never change once it is asked for
// (launches_terms, Sprint 9 review fix 4), for every role the app uses. Some
// browser tests need a waiting launch whose seed or threshold they chose after
// seeing the random seed it was asked with: they set it here, as the tables'
// owner (CI's and local e2e's DATABASE_URL), by switching that one trigger off
// for this one update, inside a transaction, so no other statement ever runs
// without it. Only a role that owns the table can do this, and that role could
// drop the trigger anyway, so the rule for the app's roles is unchanged.
// tests/db/launch.test.ts runs this function too.
import type postgres from "postgres";

export type WaitingLaunchTerms = { seed?: string | number; kpi_measure?: "ctr" | "conversion_rate" | "cpa" | "roas"; kpi_value?: number };

export async function setWaitingLaunchTerms(sql: postgres.Sql, launchId: string, terms: WaitingLaunchTerms): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`alter table public.launches disable trigger launches_terms`;
    const rows = await tx`
      update public.launches set ${tx(terms as Record<string, unknown>)}
      where id = ${launchId} and status = 'awaiting_approval'
      returning id`;
    if (rows.length !== 1) throw new Error(`No launch ${launchId} waiting for approval to set the terms of`);
    await tx`alter table public.launches enable trigger launches_terms`;
  });
}
