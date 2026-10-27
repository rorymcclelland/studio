// N-1 test cases 1 to 4, the local stand-in for #5 (a non-superuser owner, as on
// Neon) and #6 (the schema comparison), against throwaway databases made here.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { listPending, readMigrations, sha256 } from "../../scripts/db-migrate.mjs";
import { describeSchema, diffDescriptions } from "../../scripts/schema-diff.mjs";

const base = new URL(process.env.DATABASE_URL ?? "postgres://postgres@localhost:54329/campaign_studio_test");
const MIGRATIONS = join(process.cwd(), "db/migrations");
const made: string[] = [];
const madeRoles: string[] = [];
const dirs: string[] = [];

function urlFor(db: string, user = base.username || "postgres"): string {
  const u = new URL(base.toString());
  u.pathname = `/${db}`;
  u.username = user;
  return u.toString();
}

function admin() {
  return postgres(urlFor("postgres"), { onnotice: () => {}, max: 1 });
}

async function freshDb(owner?: string): Promise<string> {
  const name = `cs_mig_${randomBytes(4).toString("hex")}`;
  const sql = admin();
  await sql.unsafe(`create database "${name}"${owner ? ` owner "${owner}"` : ""}`);
  await sql.end();
  made.push(name);
  return name;
}

function tempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cs-mig-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  dirs.push(dir);
  return dir;
}

function migrateCli(args: string[], url: string) {
  const r = spawnSync(process.execPath, ["scripts/db-migrate.mjs", "--url", "MIGRATE_TEST_URL", ...args], {
    env: { ...process.env, MIGRATE_TEST_URL: url },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

async function withDb<T>(url: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { onnotice: () => {}, max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

const recorded = (url: string) =>
  withDb(url, async (sql) =>
    (await sql`select file_name, sha256 from public.schema_migrations order by file_name`).map((r) => ({
      name: r.file_name as string,
      sha256: r.sha256 as string,
    })),
  );

afterAll(async () => {
  const sql = admin();
  for (const db of made) await sql.unsafe(`drop database if exists "${db}" with (force)`);
  for (const role of madeRoles) {
    await sql.unsafe(`drop role if exists "${role}"`).catch(() => {});
  }
  await sql.end();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("N-1 migration runner", () => {
  it("#1 on an empty database applies every file in name order and records each; a second run applies nothing", async () => {
    const url = urlFor(await freshDb());
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    expect(files[0]).toBe("20261024000000_auth_schema.sql");

    const first = migrateCli([], url);
    expect(first.code, first.err).toBe(0);
    const appliedLines = first.out.split("\n").filter((l) => l.startsWith("applied "));
    expect(appliedLines).toEqual(files.map((f) => `applied ${f}`));
    expect(first.out).toContain(`${files.length} applied`);

    const rows = await recorded(url);
    expect(rows.map((r) => r.name)).toEqual(files);
    for (const r of rows) expect(r.sha256).toBe(sha256(readFileSync(join(MIGRATIONS, r.name))));

    const second = migrateCli([], url);
    expect(second.code, second.err).toBe(0);
    expect(second.out).not.toMatch(/^applied /m);
    expect(second.out).toContain("Nothing to apply");
    expect((await recorded(url)).length).toBe(files.length);
  });

  it("#1b picks up a file added later (as N-2's migration will be) and applies only that", async () => {
    const dir = tempDir({ "001_a.sql": "create table public.a (id int);" });
    const url = urlFor(await freshDb());
    expect(migrateCli(["--dir", dir], url).code).toBe(0);
    writeFileSync(join(dir, "002_b.sql"), "create table public.b (id int);");
    const r = migrateCli(["--dir", dir], url);
    expect(r.code, r.err).toBe(0);
    expect(r.out.match(/^applied .*/gm)).toEqual(["applied 002_b.sql"]);
  });

  it("#2 a changed applied file stops the run with the file named, and nothing is applied", async () => {
    const dir = tempDir({
      "001_a.sql": "create table public.a (id int);",
      "002_b.sql": "create table public.b (id int);",
    });
    const url = urlFor(await freshDb());
    expect(migrateCli(["--dir", dir], url).code).toBe(0);
    writeFileSync(join(dir, "001_a.sql"), "create table public.a (id int, extra text);");
    writeFileSync(join(dir, "003_c.sql"), "create table public.c (id int);");

    const r = migrateCli(["--dir", dir], url);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("001_a.sql");
    expect(r.err).toMatch(/changed since it was applied/);
    expect(r.out).not.toMatch(/^applied /m);
    expect((await recorded(url)).map((x) => x.name)).toEqual(["001_a.sql", "002_b.sql"]);
    await withDb(url, async (sql) => {
      const [t] = await sql`select to_regclass('public.c') as c`;
      expect(t.c).toBeNull();
    });
  });

  it("#2b an applied file missing from disk also stops the run, named", async () => {
    const dir = tempDir({ "001_a.sql": "select 1;", "002_b.sql": "select 2;" });
    const url = urlFor(await freshDb());
    expect(migrateCli(["--dir", dir], url).code).toBe(0);
    rmSync(join(dir, "001_a.sql"));
    const r = migrateCli(["--dir", dir], url);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("001_a.sql");
    expect(r.err).toMatch(/no longer on disk/);
  });

  it("#3 a failing migration rolls back alone, is not recorded, stops the run named; earlier ones stay recorded", async () => {
    const dir = tempDir({
      "001_ok.sql": "create table public.ok1 (id int);",
      "002_ok.sql": "create table public.ok2 (id int);",
      "003_bad.sql": "create table public.half (id int);\ninsert into public.half values (1);\nselect 1/0;",
      "004_later.sql": "create table public.later (id int);",
    });
    const url = urlFor(await freshDb());
    const r = migrateCli(["--dir", dir], url);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("003_bad.sql");
    expect(r.err).toMatch(/division by zero/);
    expect(r.out.match(/^applied .*/gm)).toEqual(["applied 001_ok.sql", "applied 002_ok.sql"]);
    expect((await recorded(url)).map((x) => x.name)).toEqual(["001_ok.sql", "002_ok.sql"]);
    await withDb(url, async (sql) => {
      const [t] = await sql`select to_regclass('public.ok2') as ok2, to_regclass('public.half') as half,
        to_regclass('public.later') as later`;
      expect(t.ok2).not.toBeNull();
      expect(t.half).toBeNull();
      expect(t.later).toBeNull();
    });
  });

  it("#4 --dry-run lists the pending files and changes nothing", async () => {
    const dir = tempDir({ "001_a.sql": "create table public.a (id int);", "002_b.sql": "create table public.b (id int);" });
    const url = urlFor(await freshDb());

    const empty = migrateCli(["--dir", dir, "--dry-run"], url);
    expect(empty.code, empty.err).toBe(0);
    expect(empty.out.match(/^pending .*/gm)).toEqual(["pending 001_a.sql", "pending 002_b.sql"]);
    await withDb(url, async (sql) => {
      const [t] = await sql`select to_regclass('public.schema_migrations') as m, to_regclass('public.a') as a`;
      expect(t.m).toBeNull(); // not even the runner's own table
      expect(t.a).toBeNull();
    });

    // Apply the first only, then dry-run again: only the second is pending.
    const one = tempDir({ "001_a.sql": readFileSync(join(dir, "001_a.sql"), "utf8") });
    expect(migrateCli(["--dir", one], url).code).toBe(0);
    const later = migrateCli(["--dir", dir, "--dry-run"], url);
    expect(later.out.match(/^pending .*/gm)).toEqual(["pending 002_b.sql"]);
    expect((await recorded(url)).map((x) => x.name)).toEqual(["001_a.sql"]);

    // A dry run also refuses on a changed file, so the lead sees drift before applying anything.
    writeFileSync(join(dir, "001_a.sql"), "create table public.a (id bigint);");
    const drift = migrateCli(["--dir", dir, "--dry-run"], url);
    expect(drift.code).not.toBe(0);
    expect(drift.err).toContain("001_a.sql");
  });

  it("#4b --list-pending --json matches --dry-run, from the database or from the connector's applied rows", async () => {
    const dir = tempDir({ "001_a.sql": "create table public.a (id int);", "002_b.sql": "create table public.b (id int);" });
    const url = urlFor(await freshDb());
    const one = tempDir({ "001_a.sql": readFileSync(join(dir, "001_a.sql"), "utf8") });
    expect(migrateCli(["--dir", one], url).code).toBe(0);

    const fromDb = migrateCli(["--dir", dir, "--list-pending", "--json"], url);
    expect(fromDb.code, fromDb.err).toBe(0);
    const parsed = JSON.parse(fromDb.out);
    expect(parsed.pending.map((p: { name: string }) => p.name)).toEqual(["002_b.sql"]);
    expect(parsed.pending[0].sha256).toBe(sha256(readFileSync(join(dir, "002_b.sql"))));
    expect(parsed.pending[0].path).toBe(join(dir, "002_b.sql"));
    expect(parsed.pending[0].recordSql).toContain("insert into public.schema_migrations");
    expect(parsed.bootstrapSql).toContain("create table if not exists public.schema_migrations");

    // The lead's path: no connection string, just the rows the Neon connector returned.
    const appliedFile = join(tempDir({}), "applied.json");
    writeFileSync(appliedFile, JSON.stringify((await recorded(url)).map((r) => ({ file_name: r.name, sha256: r.sha256 }))));
    const offline = spawnSync(process.execPath, ["scripts/db-migrate.mjs", "--dir", dir, "--list-pending", "--json", "--applied", appliedFile], {
      env: { ...process.env, DATABASE_URL: "" },
      encoding: "utf8",
    });
    expect(offline.status, offline.stderr).toBe(0);
    expect(JSON.parse(offline.stdout).pending).toEqual(parsed.pending);

    // With the SQL to run through the connector: the file and its record, in one transaction.
    const withSql = await listPending({ dir, applied: [], includeSql: true });
    expect(withSql.pending[0].applySql).toMatch(/^begin;\n/);
    expect(withSql.pending[0].applySql).toContain("create table public.a (id int);");
    expect(withSql.pending[0].applySql).toMatch(/insert into public\.schema_migrations[\s\S]*'001_a\.sql'[\s\S]*commit;\n$/);
  });

  it("#4c --list-pending refuses when the connector's rows show a changed file", async () => {
    const dir = tempDir({ "001_a.sql": "select 1;" });
    await expect(listPending({ dir, applied: [{ file_name: "001_a.sql", sha256: "0".repeat(64) }] })).rejects.toThrow(
      /001_a\.sql.*changed since it was applied/,
    );
  });

  it("hostile: a file name with a quote is recorded literally, not run as SQL", async () => {
    const dir = tempDir({ "001_it's.sql": "select 1;" });
    const url = urlFor(await freshDb());
    const r = migrateCli(["--dir", dir], url);
    expect(r.code, r.err).toBe(0);
    expect((await recorded(url)).map((x) => x.name)).toEqual(["001_it's.sql"]);
    const listed = await listPending({ dir, applied: [], includeSql: true });
    expect(listed.pending[0].recordSql).toContain("'001_it''s.sql'");
  });

  it("readMigrations ignores files that are not .sql and sorts by name", () => {
    const dir = tempDir({ "b.sql": "", "a.sql": "", "notes.md": "x" });
    expect(readMigrations(dir).map((m: { name: string }) => m.name)).toEqual(["a.sql", "b.sql"]);
  });
});

describe("N-1 baseline on a non-superuser owner (local stand-in for #5, Neon)", () => {
  it("every migration applies as a NOSUPERUSER CREATEDB CREATEROLE owner, and RLS hides another workspace's row", async () => {
    const owner = `cs_owner_${randomBytes(3).toString("hex")}`;
    const sql = admin();
    await sql.unsafe(`create role "${owner}" login nosuperuser createdb createrole`);
    madeRoles.push(owner);
    // anon and authenticated are cluster-wide and already exist here (made by the
    // test database's own reset). On Neon the owner creates them, which in Postgres
    // 16+ gives it ADMIN on them and nothing else; give it exactly that.
    await sql.unsafe(`grant anon, authenticated to "${owner}" with admin true, inherit false, set false`);
    await sql.end();
    const db = await freshDb(owner);
    const url = urlFor(db, owner);

    const r = migrateCli([], url);
    expect(r.code, r.err).toBe(0);

    await withDb(url, async (o) => {
      const [me] = await o`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
      expect(me).toEqual({ rolsuper: false, rolbypassrls: false });
      const [sr] = await o`select count(*)::int as n from pg_roles where rolname = 'service_role' and pg_has_role(current_user, oid, 'USAGE')`;
      expect(sr.n).toBe(0);

      const [a] = await o`insert into auth.users (email) values ('a@example.test') returning id`;
      const [b] = await o`insert into auth.users (email) values ('b@example.test') returning id`;
      const ensure = (id: string) =>
        o.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: id, role: "authenticated" })}, true)`;
          await tx`set local role authenticated`;
          const [w] = await tx`select public.ensure_workspace() as id`;
          return w.id as string;
        });
      const wa = await ensure(a.id);
      const wb = await ensure(b.id);
      await o`insert into public.agent_runs (workspace_id, agent, agent_version, input, created_by)
        values (${wb}, 'tagline', 1, '{}'::jsonb, ${b.id})`;

      const seenByA = await o.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: a.id, role: "authenticated" })}, true)`;
        await tx`set local role authenticated`;
        const [who] = await tx`select current_user as u, auth.uid() as uid, auth.role() as role`;
        const runs = await tx`select id from public.agent_runs`;
        const ws = await tx`select id from public.workspaces`;
        return { who, runs, ws };
      });
      expect(seenByA.who).toEqual({ u: "authenticated", uid: a.id, role: "authenticated" });
      expect(seenByA.runs).toHaveLength(0);
      expect(seenByA.ws.map((w) => w.id)).toEqual([wa]);

      const anonRuns = await o
        .begin(async (tx) => {
          await tx`set local role anon`;
          return tx`select 1 from public.agent_runs`;
        })
        .catch((e: Error) => e);
      if (anonRuns instanceof Error) expect(anonRuns.message).toMatch(/permission denied/);
      else expect(anonRuns).toHaveLength(0);

      // The runner's own table is not readable by the app's roles.
      const peek = await o
        .begin(async (tx) => {
          await tx`set local role authenticated`;
          return tx`select * from public.schema_migrations`;
        })
        .catch((e: Error) => e);
      expect(peek instanceof Error ? peek.message : `rows: ${peek.length}`).toMatch(/permission denied|rows: 0/);
    });
  });

  it("the baseline leaves an existing Supabase-style auth schema it does not own alone", async () => {
    const owner = `cs_owner_${randomBytes(3).toString("hex")}`;
    const authAdmin = `cs_authadm_${randomBytes(3).toString("hex")}`;
    const db = await freshDb();
    const sql = admin();
    await sql.unsafe(`create role "${owner}" login nosuperuser createdb createrole`);
    await sql.unsafe(`create role "${authAdmin}" nologin`);
    madeRoles.push(owner, authAdmin);
    await sql.unsafe(`grant anon, authenticated to "${owner}"`);
    await sql.unsafe(`alter database "${db}" owner to "${owner}"`);
    await sql.end();
    await withDb(urlFor(db), async (su) => {
      await su.unsafe(`
        create schema auth authorization "${authAdmin}";
        create table auth.users (instance_id uuid, id uuid primary key, email varchar(255),
          created_at timestamptz, raw_app_meta_data jsonb);
        alter table auth.users owner to "${authAdmin}";
        create function auth.uid() returns uuid language sql stable as
          $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        create function auth.role() returns text language sql stable as $$ select 'x' $$;
        alter function auth.uid() owner to "${authAdmin}";
        alter function auth.role() owner to "${authAdmin}";
        grant usage on schema auth to "${owner}", anon, authenticated;
        grant select, insert, references on auth.users to "${owner}";
        grant execute on function auth.uid(), auth.role() to "${owner}", anon, authenticated;
      `);
    });
    // Supabase only ever held the files up to the end of Sprint 5. From Sprint 6 (N-2) the
    // files create tables in Studio's own auth schema, which only exists off Supabase.
    const supabaseEra = tempDir({});
    for (const f of readdirSync(MIGRATIONS).filter((f) => f <= "20261028000005_sprint5_review_fixes.sql"))
      copyFileSync(join(MIGRATIONS, f), join(supabaseEra, f));
    const r = migrateCli(["--dir", supabaseEra], urlFor(db, owner));
    expect(r.code, r.err).toBe(0);
    await withDb(urlFor(db), async (su) => {
      const cols = await su`select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'users' order by ordinal_position`;
      expect(cols.map((c) => c.column_name)).toContain("raw_app_meta_data");
      const [fn] = await su`select pg_get_userbyid(proowner) as o from pg_proc where oid = 'auth.uid()'::regprocedure`;
      expect(fn.o).toBe(authAdmin);
    });
  });
});

describe("N-1 #6 schema comparison", () => {
  it("two databases built from the same files match; a deliberate change in one is reported", async () => {
    const a = urlFor(await freshDb());
    const b = urlFor(await freshDb());
    expect(migrateCli([], a).code).toBe(0);
    // b is built from a copy of the files, so it also proves the folder is self-contained.
    const copy = tempDir({});
    for (const f of readdirSync(MIGRATIONS)) copyFileSync(join(MIGRATIONS, f), join(copy, f));
    expect(migrateCli(["--dir", copy], b).code).toBe(0);

    const same = diffDescriptions(await withDb(a, describeSchema), await withDb(b, describeSchema));
    expect(same).toEqual([]);

    await withDb(b, async (sql) => {
      await sql.unsafe(`
        alter table public.brands add column extra text;
        alter table public.agent_runs alter column agent_version drop not null;
        drop policy if exists runs_select on public.agent_runs;
        create or replace function public.is_member(ws uuid) returns boolean language sql stable
          security definer set search_path = '' as $$ select true $$;
        grant select on public.usage_ledger to anon;
        create index brands_extra_idx on public.brands (extra);
        -- Supabase-only objects that must be ignored:
        create schema storage;
        create table storage.objects (id int);
        alter table auth.users add column raw_user_meta_data jsonb;
        create role cs_supabase_admin_like nologin;
      `);
    });
    await withDb(urlFor("postgres"), (s) => s.unsafe("drop role cs_supabase_admin_like"));
    const da = await withDb(a, describeSchema);
    const db = await withDb(b, describeSchema);
    const diff = diffDescriptions(da, db).join("\n");
    expect(diff).toContain("column public.brands.extra");
    expect(diff).toContain("column public.agent_runs.agent_version");
    expect(diff).toContain("function public.is_member(ws uuid)");
    expect(diff).toContain("grant public.usage_ledger anon");
    expect(diff).toContain("index public.brands_extra_idx");
    expect(diff).toContain("- policy public.agent_runs.runs_select");
    expect(da["policy public.agent_runs.runs_select"]).toMatch(/cmd=r permissive to=authenticated using=.*is_member/);
    expect(diff).not.toContain("storage");
    expect(diff).not.toContain("raw_user_meta_data");
    expect(diff).not.toContain("schema_migrations");
  });

  it("the CLI prints the differences and exits non-zero, or says they match", async () => {
    const a = urlFor(await freshDb());
    const b = urlFor(await freshDb());
    const dir = tempDir({ "001.sql": "create table public.t (id int primary key, name text);" });
    migrateCli(["--dir", dir], a);
    migrateCli(["--dir", dir], b);
    const run = () =>
      spawnSync(process.execPath, ["scripts/schema-diff.mjs", "--a", "DIFF_A", "--b", "DIFF_B"], {
        env: { ...process.env, DIFF_A: a, DIFF_B: b },
        encoding: "utf8",
      });
    const same = run();
    expect(same.status, same.stderr).toBe(0);
    expect(same.stdout).toContain("No differences");
    await withDb(b, (sql) => sql.unsafe("alter table public.t alter column name set not null"));
    const differ = run();
    expect(differ.status).toBe(1);
    expect(differ.stdout).toMatch(/~ column public\.t\.name/);
    expect(differ.stdout).not.toContain("postgres://");
  });

  it("names a missing connection variable without printing any URL", () => {
    const r = spawnSync(process.execPath, ["scripts/schema-diff.mjs", "--a", "NOPE_A", "--b", "NOPE_B"], {
      env: { ...process.env, NOPE_A: "", NOPE_B: "" },
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("NOPE_A");
  });
});
