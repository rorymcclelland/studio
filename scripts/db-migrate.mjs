#!/usr/bin/env node
// Applies pending migrations from db/migrations, in file-name order, and
// records each in public.schema_migrations (N-1).
//
//   npm run db:migrate                          apply what is pending to DATABASE_URL
//   node scripts/db-migrate.mjs --url NAME      use the connection string in env var NAME
//   node scripts/db-migrate.mjs --dry-run       list pending files; change nothing
//   node scripts/db-migrate.mjs --list-pending --json [--applied rows.json] [--with-sql]
//       pending files with their sha256, path and the SQL that records each,
//       for applying through the Neon connector (see docs/hosting.md). With
//       --applied, no database is needed: pass the rows the connector returned
//       for `select file_name, sha256 from public.schema_migrations`.
//   --dir PATH                                  another migrations folder (tests)
//
// Each file runs in its own transaction together with its schema_migrations
// row, so the record and the schema can't disagree. Before applying anything,
// the run stops if an applied file has changed on disk or gone. A failing file
// rolls back alone and stops the run; files before it stay applied.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export const DEFAULT_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));

/** The runner's own table, created by the runner so it can bootstrap. App roles can't read it. */
export const BOOTSTRAP_SQL = `create table if not exists public.schema_migrations (
  file_name text primary key,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.schema_migrations from %I', r);
    end if;
  end loop;
end
$$;
`;

export const APPLIED_QUERY = "select file_name, sha256 from public.schema_migrations order by file_name";

export class MigrationError extends Error {}

/** sha256 (hex) of a file's bytes. */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every .sql file in `dir`, sorted by name, with its sha256 and text. */
export function readMigrations(dir = DEFAULT_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const path = resolve(join(dir, name));
      const bytes = readFileSync(path);
      return { name, path, sha256: sha256(bytes), sql: bytes.toString("utf8") };
    });
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The statement that records one file as applied. */
export function recordSql(file) {
  return `insert into public.schema_migrations (file_name, sha256) values (${quote(file.name)}, ${quote(file.sha256)});`;
}

/**
 * Compares the files on disk with the applied rows. Throws, naming every file,
 * if an applied file has changed or gone; otherwise returns the pending files.
 */
export function pendingFrom(files, applied) {
  const onDisk = new Map(files.map((f) => [f.name, f]));
  const problems = [];
  for (const row of applied) {
    const name = row.file_name ?? row.name;
    const file = onDisk.get(name);
    if (!file) problems.push(`${name} was applied but is no longer on disk`);
    else if (file.sha256 !== row.sha256) problems.push(`${name} has changed since it was applied (sha256 ${row.sha256} applied, ${file.sha256} on disk)`);
  }
  if (problems.length) {
    throw new MigrationError(
      `Refusing to run: ${problems.join("; ")}. Applied migrations must never be edited; add a new file instead.`,
    );
  }
  const done = new Set(applied.map((r) => r.file_name ?? r.name));
  return files.filter((f) => !done.has(f.name));
}

async function appliedRows(sql) {
  const [{ t }] = await sql`select to_regclass('public.schema_migrations') as t`;
  if (!t) return [];
  return sql.unsafe(APPLIED_QUERY);
}

/**
 * Pending files with their sha256, path and recording SQL. Reads the applied rows
 * from `sql` if given, else from `applied` (the connector's rows), else none.
 * `includeSql` adds `applySql`: begin, the file, its record, commit.
 * @param {{ sql?: import("postgres").Sql, dir?: string, applied?: Array<{ file_name?: string, name?: string, sha256: string }>, includeSql?: boolean }} [options]
 */
export async function listPending({ sql, dir = DEFAULT_DIR, applied, includeSql = false } = {}) {
  const rows = applied ?? (sql ? await appliedRows(sql) : []);
  const pending = pendingFrom(readMigrations(dir), rows).map((f) => {
    /** @type {{ name: string, sha256: string, path: string, recordSql: string, applySql?: string }} */
    const out = { name: f.name, sha256: f.sha256, path: f.path, recordSql: recordSql(f) };
    if (includeSql) out.applySql = `begin;\n${f.sql.replace(/\s*$/, "\n")}${recordSql(f)}\ncommit;\n`;
    return out;
  });
  return { bootstrapSql: BOOTSTRAP_SQL, appliedQuery: APPLIED_QUERY, pending };
}

/**
 * Applies every pending file in `dir` to `sql` (a postgres client with max: 1).
 * Returns the names applied. Throws MigrationError naming the file that failed.
 */
export async function migrate(sql, { dir = DEFAULT_DIR, dryRun = false, log = console.log } = {}) {
  const files = readMigrations(dir);
  if (dryRun) {
    const pending = pendingFrom(files, await appliedRows(sql));
    for (const f of pending) log(`pending ${f.name}`);
    log(pending.length ? `${pending.length} pending (dry run, nothing changed)` : "Nothing pending (dry run)");
    return pending.map((f) => f.name);
  }

  // One runner at a time per database; the lock ends with the session.
  await sql`select pg_advisory_lock(hashtext('public.schema_migrations'))`;
  try {
    await sql.unsafe(BOOTSTRAP_SQL);
    const pending = pendingFrom(files, await appliedRows(sql));
    const applied = [];
    for (const f of pending) {
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(f.sql);
          await tx`insert into public.schema_migrations (file_name, sha256) values (${f.name}, ${f.sha256})`;
        });
      } catch (e) {
        throw new MigrationError(
          `${f.name} failed and was rolled back: ${e.message}${e.position ? ` (at character ${e.position})` : ""}. ` +
            `${applied.length} applied before it; nothing after it was tried.`,
        );
      }
      applied.push(f.name);
      log(`applied ${f.name}`);
    }
    log(applied.length ? `${applied.length} applied` : "Nothing to apply");
    return applied;
  } finally {
    await sql`select pg_advisory_unlock(hashtext('public.schema_migrations'))`.catch(() => {});
  }
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args) {
  const dir = arg(args, "--dir") ?? DEFAULT_DIR;
  const envName = arg(args, "--url") ?? "DATABASE_URL";
  const appliedPath = arg(args, "--applied");

  if (args.includes("--list-pending")) {
    let sql;
    let applied;
    if (appliedPath) {
      applied = JSON.parse(readFileSync(appliedPath === "-" ? 0 : appliedPath, "utf8"));
      if (!Array.isArray(applied)) throw new MigrationError("--applied must hold a JSON array of { file_name, sha256 } rows.");
    } else if (process.env[envName]) {
      sql = postgres(process.env[envName], { onnotice: () => {}, max: 1 });
    }
    try {
      const result = await listPending({ sql, dir, applied, includeSql: args.includes("--with-sql") });
      if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
      else {
        for (const p of result.pending) console.log(`pending ${p.name} ${p.sha256}`);
        console.log(`${result.pending.length} pending`);
      }
    } finally {
      await sql?.end();
    }
    return;
  }

  const url = process.env[envName];
  if (!url) throw new MigrationError(`${envName} is not set.`);
  const sql = postgres(url, { onnotice: () => {}, max: 1 });
  try {
    await migrate(sql, { dir, dryRun: args.includes("--dry-run") });
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof MigrationError ? e.message : `Migration run failed: ${e.message}`);
    process.exit(1);
  });
}
