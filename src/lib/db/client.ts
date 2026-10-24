import postgres from "postgres";

// One pool per server instance. On Vercel, DATABASE_URL is Supabase's
// transaction-mode pooler, so prepared statements are switched off.
declare global {
  var __csSql: postgres.Sql | undefined;
}

export function getSql(): postgres.Sql {
  if (!globalThis.__csSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__csSql = postgres(url, {
      prepare: false,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      onnotice: () => {},
    });
  }
  return globalThis.__csSql;
}

export async function closeSql(): Promise<void> {
  if (globalThis.__csSql) {
    await globalThis.__csSql.end({ timeout: 5 });
    globalThis.__csSql = undefined;
  }
}
