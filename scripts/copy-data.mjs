#!/usr/bin/env node
// Copies production's data from Supabase into an empty, fully migrated Neon
// database (N-6). Run once, from the "Copy production data" Action; removed in N-7.
//
//   node scripts/copy-data.mjs --from SUPABASE_DB_URL --to TARGET_DB_URL [--batch N] [--dir PATH]
//
// --from and --to name environment variables holding the connection strings,
// so no string is typed on a command line or printed (rule 6).
//
// What it copies: auth.users (id, email, created_at only; Supabase's other auth
// columns and schemas are left behind), then every table in `public` except
// the runner's schema_migrations, in foreign-key order worked out from the
// target's catalogue. Every id stays the same. Generated columns are left for
// the target to compute; identity columns are copied with OVERRIDING SYSTEM
// VALUE and their sequences then set to the highest id.
//
// How: the source is read in one repeatable-read, read-only transaction, so
// every table comes from the same moment. The target is written in one
// transaction, as the table owner: each table's user triggers (the guards,
// brief_versions_in_order, ad_variants_parts and the rest) are disabled for
// the copy and enabled again before commit. A failure rolls everything back,
// which also undoes the disabling. Foreign keys stay enforced throughout.
// Rows are read with a cursor and written in batches, so the assets' bytes are
// never all in memory at once. Values travel as text (bytea as bytes) and are
// cast to the target column's type, so timestamps keep their microseconds and
// numbers their digits.
//
// It refuses to run unless the target's schema_migrations ledger matches
// db/migrations exactly, every copied table on the target is empty, both
// sides have the same tables and columns, and every source auth.users email
// is already lower-case and trimmed (sign-in finds users by lower-cased
// address, so a mixed-case row would split an invitee from their workspace). It prints table names and row
// counts, never row contents. Exit code 0 when copied, 1 when refused or failed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { APPLIED_QUERY, pendingFrom, readMigrations } from "./db-migrate.mjs";

export class CopyError extends Error {}

/** Studio needs only these from Supabase's auth.users. */
export const AUTH_USER_COLUMNS = ["id", "email", "created_at"];
export const SKIPPED_TABLES = ["public.schema_migrations"];

export const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** Session settings for both sides, so values render the same way as text. */
export const SESSION_SETTINGS = [
  "set local timezone = 'UTC'",
  "set local datestyle = 'ISO, YMD'",
  "set local intervalstyle = 'postgres'",
  "set local extra_float_digits = 3",
  "set local bytea_output = 'hex'",
  // A query that row-level security would filter fails instead of quietly returning fewer rows.
  "set local row_security = off",
  "set local statement_timeout = 0",
  "set local idle_in_transaction_session_timeout = 0",
];

/**
 * A postgres client for the connection string in env var `name`. Never prints
 * the string. Remote hosts get TLS when the string doesn't say; channel_binding
 * (which Neon's strings may carry) is dropped, as the driver doesn't take it.
 */
export function connectFromEnv(name) {
  const value = process.env[name];
  if (!name || !value) throw new CopyError(`${name || "(no name given)"} is not set.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CopyError(`${name} does not hold a valid connection string.`);
  }
  url.searchParams.delete("channel_binding");
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  /** @type {Record<string, unknown>} */
  const options = { onnotice: () => {}, max: 1, connect_timeout: 30, idle_timeout: 0 };
  if (!local && !url.searchParams.has("sslmode")) options.ssl = "require";
  return postgres(url.toString(), options);
}

/**
 * The tables to copy (auth.users and public, less schema_migrations), with
 * their columns, primary keys, foreign keys and user triggers.
 * @param {import("postgres").Sql} sql
 */
export async function catalogue(sql) {
  const tables = await sql`
    select c.oid::int as oid, n.nspname as schema, c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and ((n.nspname = 'public') or (n.nspname = 'auth' and c.relname = 'users'))
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    order by 2, 3`;
  const byOid = new Map();
  for (const t of tables) {
    const full = `${t.schema}.${t.name}`;
    if (SKIPPED_TABLES.includes(full)) continue;
    byOid.set(t.oid, {
      oid: t.oid,
      schema: t.schema,
      name: t.name,
      full,
      qname: `${q(t.schema)}.${q(t.name)}`,
      /** @type {Array<{ name: string, type: string, bytea: boolean, identity: string, generated: string, notnull: boolean }>} */
      columns: [],
      /** @type {string[]} */
      pk: [],
      /** @type {Array<{ name: string, child: number, parent: number, cols: string[], refcols: string[] }>} */
      fks: [],
      /** @type {Array<{ name: string, enabled: string }>} */
      triggers: [],
    });
  }
  const oids = [...byOid.keys()];
  if (!oids.length) return byOid;

  const columns = await sql`
    select a.attrelid::int as rel, a.attname::text as name, format_type(a.atttypid, a.atttypmod) as type,
           a.atttypid = 'bytea'::regtype as bytea, a.attidentity::text as identity,
           a.attgenerated::text as generated, a.attnotnull as notnull
    from pg_attribute a
    where a.attrelid = any(${oids}) and a.attnum > 0 and not a.attisdropped
    order by a.attrelid, a.attnum`;
  for (const c of columns) {
    byOid.get(c.rel).columns.push({
      name: c.name,
      type: c.type,
      bytea: c.bytea,
      identity: c.identity,
      generated: c.generated,
      notnull: c.notnull,
    });
  }

  const keyCols = (rel, key) =>
    sql`select array(select a.attname::text from unnest(${key}::int2[]) with ordinality k(n, o)
                     join pg_attribute a on a.attrelid = ${rel} and a.attnum = k.n order by k.o) as cols`;
  const constraints = await sql`
    select conname::text as name, contype::text as type, conrelid::int as rel, confrelid::int as ref,
           conkey::int2[] as key, confkey::int2[] as refkey
    from pg_constraint where conrelid = any(${oids}) and contype in ('p', 'f')
    order by conname`;
  for (const c of constraints) {
    const t = byOid.get(c.rel);
    const [{ cols }] = await keyCols(c.rel, c.key);
    if (c.type === "p") {
      t.pk = cols;
      continue;
    }
    const [{ cols: refcols }] = await keyCols(c.ref, c.refkey);
    t.fks.push({ name: c.name, child: c.rel, parent: c.ref, cols, refcols });
  }

  const triggers = await sql`
    select tgrelid::int as rel, tgname::text as name, tgenabled::text as enabled
    from pg_trigger where tgrelid = any(${oids}) and not tgisinternal order by tgname`;
  for (const t of triggers) byOid.get(t.rel).triggers.push({ name: t.name, enabled: t.enabled });

  return byOid;
}

/** The columns copied for a table: auth.users's three, or every non-generated column. */
export function copiedColumns(table) {
  if (table.full === "auth.users") return table.columns.filter((c) => AUTH_USER_COLUMNS.includes(c.name));
  return table.columns.filter((c) => !c.generated);
}

/**
 * Problems that make the two sides incomparable: tables or columns on one side
 * only, or a column generated on one side and not the other.
 */
export function shapeProblems(source, target) {
  const problems = [];
  const byName = (cat) => new Map([...cat.values()].map((t) => [t.full, t]));
  const s = byName(source);
  const t = byName(target);
  for (const name of s.keys()) if (!t.has(name)) problems.push(`table ${name} is on the source but not the target`);
  for (const name of t.keys()) if (!s.has(name)) problems.push(`table ${name} is on the target but not the source`);
  for (const [name, st] of s) {
    const tt = t.get(name);
    if (!tt) continue;
    if (name === "auth.users") {
      const sc = new Set(st.columns.map((c) => c.name));
      const tc = new Set(tt.columns.map((c) => c.name));
      for (const c of AUTH_USER_COLUMNS) {
        if (!sc.has(c)) problems.push(`column auth.users.${c} is missing on the source`);
        if (!tc.has(c)) problems.push(`column auth.users.${c} is missing on the target`);
      }
      for (const c of tc) if (!AUTH_USER_COLUMNS.includes(c)) problems.push(`column auth.users.${c} is on the target but is not copied`);
      continue;
    }
    const sc = new Map(st.columns.map((c) => [c.name, c]));
    const tc = new Map(tt.columns.map((c) => [c.name, c]));
    for (const c of sc.keys()) if (!tc.has(c)) problems.push(`column ${name}.${c} is on the source but not the target`);
    for (const c of tc.keys()) if (!sc.has(c)) problems.push(`column ${name}.${c} is on the target but not the source`);
    for (const [c, col] of sc) {
      const other = tc.get(c);
      if (other && Boolean(col.generated) !== Boolean(other.generated))
        problems.push(`column ${name}.${c} is generated on one side only`);
    }
  }
  return problems;
}

/**
 * Tables in foreign-key order (parents first), from the target's catalogue.
 * Self-references are left out of the ordering (rows are ordered instead). A
 * cycle between tables is broken only where one foreign key has a nullable
 * column of its own: that column is copied as null and filled in once every
 * table is in. Any other cycle is an error naming its tables.
 * @returns {{ order: any[], deferred: Array<{ table: any, fk: any, columns: string[] }> }}
 */
export function copyOrder(cat) {
  const tables = [...cat.values()];
  const deferred = [];
  /** @type {Map<number, Set<string>>} child oid -> fk names still to satisfy */
  const edges = new Map(tables.map((t) => [t.oid, new Set()]));
  const fkByName = new Map();
  for (const t of tables) {
    for (const fk of t.fks) {
      if (fk.parent === fk.child) continue;
      if (!cat.has(fk.parent)) throw new CopyError(`foreign key ${fk.name} on ${t.full} points at a table that is not copied`);
      edges.get(t.oid).add(fk.name);
      fkByName.set(`${t.oid}:${fk.name}`, fk);
    }
  }
  const done = new Set();
  const order = [];
  const ready = (t) => [...edges.get(t.oid)].every((n) => done.has(fkByName.get(`${t.oid}:${n}`).parent));
  // auth.users first, then by name, so the order is the same on every run.
  const sorted = tables.sort((a, b) => (a.full === "auth.users" ? -1 : b.full === "auth.users" ? 1 : a.full.localeCompare(b.full)));
  while (order.length < sorted.length) {
    const next = sorted.find((t) => !done.has(t.oid) && ready(t));
    if (next) {
      done.add(next.oid);
      order.push(next);
      continue;
    }
    // Stuck: every remaining table waits on another remaining table.
    const remaining = sorted.filter((t) => !done.has(t.oid));
    // Whether `from` reaches `to` through foreign keys still waiting, so an edge
    // child -> parent is on a cycle exactly when its parent reaches its child.
    const reaches = (from, to) => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        const at = queue.shift();
        for (const n of edges.get(at)) {
          const p = fkByName.get(`${at}:${n}`).parent;
          if (done.has(p)) continue;
          if (p === to) return true;
          if (!seen.has(p)) {
            seen.add(p);
            queue.push(p);
          }
        }
      }
      return false;
    };
    // Candidates: foreign keys on a cycle with a nullable column of their own.
    const candidates = [];
    for (const t of remaining) {
      for (const name of [...edges.get(t.oid)].sort()) {
        const fk = fkByName.get(`${t.oid}:${name}`);
        if (done.has(fk.parent) || !reaches(fk.parent, t.oid)) continue;
        const inOtherKeys = new Set(t.fks.filter((f) => f.name !== fk.name).flatMap((f) => f.cols).concat(t.pk));
        const own = fk.cols.filter((c) => !inOtherKeys.has(c) && !t.columns.find((x) => x.name === c).notnull);
        if (own.length) candidates.push({ table: t, fk, name, columns: own });
      }
    }
    // Fewest columns copied empty: prefer the one break that leaves no cycle at all.
    const acyclicWithout = (c) => {
      edges.get(c.table.oid).delete(c.name);
      const ok = remaining.every((t) => [...edges.get(t.oid)].every((n) => {
        const p = fkByName.get(`${t.oid}:${n}`).parent;
        return done.has(p) || !reaches(p, t.oid);
      }));
      edges.get(c.table.oid).add(c.name);
      return ok;
    };
    const pick = candidates.find(acyclicWithout) ?? candidates[0];
    const broken = Boolean(pick);
    if (pick) {
      edges.get(pick.table.oid).delete(pick.name);
      deferred.push({ table: pick.table, fk: pick.fk, columns: pick.columns });
    }
    if (!broken) {
      throw new CopyError(
        `the foreign keys between ${remaining.map((t) => t.full).join(", ")} form a cycle that no nullable column breaks`,
      );
    }
  }
  return { order, deferred };
}

/** The select for one table: rows ordered by primary key, or parents first for a self-reference. */
export function selectSql(table) {
  const cols = copiedColumns(table);
  const list = cols.map((c) => (c.bytea ? `t.${q(c.name)}` : `t.${q(c.name)}::text as ${q(c.name)}`)).join(", ");
  const pk = table.pk.map((c) => `t.${q(c)}`).join(", ");
  const selfFks = table.fks.filter((f) => f.parent === f.child);
  if (selfFks.length > 1) throw new CopyError(`${table.full} has more than one self-reference; the copy can't order its rows`);
  if (!selfFks.length) return `select ${list} from ${table.qname} t order by ${pk}`;
  // Depth from the roots (rows whose reference is empty), so each parent comes before its children.
  const fk = selfFks[0];
  const ref = fk.refcols.map(q);
  const anyNull = fk.cols.map((c) => `t.${q(c)} is null`).join(" or ");
  const join = fk.cols.map((c, i) => `c.${q(c)} = w.${ref[i]}`).join(" and ");
  const back = fk.refcols.map((c) => `t.${q(c)} = d.${q(c)}`).join(" and ");
  return `with recursive walk as (
      select ${fk.refcols.map((c) => `t.${q(c)}`).join(", ")}, 0 as depth from ${table.qname} t where ${anyNull}
      union all
      select ${fk.refcols.map((c) => `c.${q(c)}`).join(", ")}, w.depth + 1 from ${table.qname} c join walk w on ${join}
      where w.depth < 100000
    ), d as (select ${ref.join(", ")}, max(depth) as depth from walk group by ${ref.join(", ")})
    select ${list} from ${table.qname} t join d on ${back} order by d.depth, ${pk}`;
}

/**
 * A parameter placeholder cast to the column's type. Values travel as text
 * (`$1::text::jsonb`), so the driver passes them through untouched: left to
 * infer the type, it would re-serialise them (a jsonb text as a JSON string,
 * a timestamp through Date, losing its microseconds, 'true' as false).
 * Bytes travel as bytes.
 */
export function castParam(n, column) {
  return column.bytea ? `$${n}::bytea` : `$${n}::text::${column.type}`;
}

/**
 * How many auth.users emails are not lower(btrim(email)). Sign-in looks users
 * up by lower-cased address, so such a row would no longer match its person.
 * A count only: the addresses themselves are never printed.
 * @param {import("postgres").Sql} sql
 */
export async function unnormalisedEmails(sql) {
  const [{ n }] = await sql`select count(*)::int as n from auth.users where email is not null and email::text <> lower(btrim(email::text))`;
  return n;
}

export const unnormalisedMessage = (n) =>
  `${n} auth.users email(s) are not lower-case and trimmed. Sign-in looks people up by lower-cased address, ` +
  "so they would be split from their workspace. Fix them on the source first " +
  "(update auth.users set email = lower(btrim(email)), after checking no two collide).";

/** Fails if the target's ledger is not exactly db/migrations (or `dir`: the tests' cutover-era folder, since C7-2 changed the schema after the copy). */
async function checkLedger(target, dir) {
  const [{ t }] = await target`select to_regclass('public.schema_migrations') as t`;
  if (!t) throw new CopyError("Refusing to copy: the target has no schema_migrations ledger. Migrate it first (scripts/db-migrate.mjs).");
  const applied = await target.unsafe(APPLIED_QUERY);
  let pending;
  try {
    pending = pendingFrom(readMigrations(dir), applied);
  } catch (e) {
    throw new CopyError(`Refusing to copy: ${e.message}`);
  }
  if (pending.length)
    throw new CopyError(
      `Refusing to copy: the target is missing ${pending.length} migration(s): ${pending.map((p) => p.name).join(", ")}. Migrate it first.`,
    );
}

/**
 * Copies every row from `source` to `target` (postgres clients, max: 1 each).
 * Returns per-table counts. Throws CopyError when it refuses or fails.
 * @param {import("postgres").Sql} source
 * @param {import("postgres").Sql} target
 * @param {{ batch?: number, log?: (line: string) => void }} [options]
 */
export async function copyData(source, target, { batch = 500, log = console.log, dir = undefined } = {}) {
  await checkLedger(target, dir);
  const [srcCat, tgtCat] = [await catalogue(source), await catalogue(target)];
  const problems = shapeProblems(srcCat, tgtCat);
  if (problems.length) throw new CopyError(`Refusing to copy: the two sides differ:\n  ${problems.join("\n  ")}`);
  for (const t of [...tgtCat.values(), ...srcCat.values()])
    if (!t.pk.length) throw new CopyError(`Refusing to copy: ${t.full} has no primary key`);

  const mixed = await unnormalisedEmails(source);
  if (mixed) throw new CopyError(`Refusing to copy: ${unnormalisedMessage(mixed)}`);

  const { order, deferred } = copyOrder(tgtCat);
  const srcByName = new Map([...srcCat.values()].map((t) => [t.full, t]));

  const notEmpty = [];
  for (const t of order) {
    const [{ any }] = await target.unsafe(`select exists (select 1 from ${t.qname}) as any`);
    if (any) notEmpty.push(t.full);
  }
  if (notEmpty.length)
    throw new CopyError(
      `Refusing to copy: the target already holds rows in ${notEmpty.join(", ")}. ` +
        "Copy only into an empty, fully migrated database (for a rehearsal, a fresh branch).",
    );
  const offAlready = order.flatMap((t) => t.triggers.filter((g) => g.enabled !== "O").map((g) => `${t.full}.${g.name}`));
  if (offAlready.length)
    throw new CopyError(`Refusing to copy: these triggers on the target are not in their normal state: ${offAlready.join(", ")}`);

  for (const d of deferred) {
    log(`${d.table.full}.${d.columns.join(", ")}: copied empty, then filled in after every table (breaks the cycle through ${d.fk.name})`);
  }
  for (const t of order) {
    const self = t.fks.find((f) => f.parent === f.child);
    if (self) log(`${t.full}: rows ordered so each ${self.cols[0]} parent comes first`);
  }

  const counts = [];
  let aborted = false;
  await source.begin("isolation level repeatable read read only", async (src) => {
    for (const s of SESSION_SETTINGS) await src.unsafe(s);
    // Again inside the snapshot that is copied, in case a row changed since the check above.
    const late = await unnormalisedEmails(src);
    if (late) throw new CopyError(`Refusing to copy: ${unnormalisedMessage(late)}`);
    await target.begin(async (tgt) => {
      for (const s of SESSION_SETTINGS) await tgt.unsafe(s);
      await tgt.unsafe("set local lock_timeout = '30s'");
      const guarded = order.filter((t) => t.triggers.length);
      for (const t of guarded) await tgt.unsafe(`alter table ${t.qname} disable trigger user`);
      try {
        /** @type {Map<string, Array<{ pk: string[], values: Array<string | null> }>>} */
        const later = new Map(deferred.map((d) => [d.fk.name, []]));
        for (const t of order) {
          const cols = copiedColumns(t);
          const nulled = new Set(deferred.filter((d) => d.table.oid === t.oid).flatMap((d) => d.columns));
          const mine = deferred.filter((d) => d.table.oid === t.oid);
          const identity = cols.some((c) => c.identity === "a");
          const head = `insert into ${t.qname} (${cols.map((c) => q(c.name)).join(", ")})${identity ? " overriding system value" : ""} values `;
          const hasBytes = cols.some((c) => c.bytea);
          const size = Math.max(1, Math.min(batch, Math.floor(30000 / cols.length), hasBytes ? 50 : batch));
          let copied = 0;
          const srcTable = srcByName.get(t.full);
          // An explicit cursor in the source's transaction: each fetch is written before the next is read.
          // (The driver's own cursor callback can resolve before an async callback has finished.)
          await src.unsafe(`declare copy_rows no scroll cursor for ${selectSql(srcTable)}`);
          for (;;) {
            const rows = await src.unsafe(`fetch forward ${size} from copy_rows`);
            if (!rows.length) break;
            const params = [];
            const tuples = rows.map((row) => {
              const marks = cols.map((c) => {
                params.push(nulled.has(c.name) ? null : row[c.name]);
                return castParam(params.length, c);
              });
              return `(${marks.join(", ")})`;
            });
            for (const d of mine) {
              for (const row of rows) {
                const values = d.columns.map((c) => row[c]);
                if (values.some((v) => v !== null)) later.get(d.fk.name).push({ pk: t.pk.map((c) => row[c]), values });
              }
            }
            await tgt.unsafe(head + tuples.join(", "), params);
            copied += rows.length;
          }
          await src.unsafe("close copy_rows");
          const [{ n }] = await src.unsafe(`select count(*)::int as n from ${srcTable.qname}`);
          if (n !== copied)
            throw new CopyError(`${t.full}: read ${copied} of ${n} rows (rows in a reference loop can't be ordered)`);
          counts.push({ table: t.full, rows: copied });
          log(`${t.full}: ${copied} rows`);
        }

        for (const d of deferred) {
          const t = d.table;
          const col = new Map(t.columns.map((c) => [c.name, c]));
          const sets = d.columns.map((c, i) => `${q(c)} = ${castParam(i + 1, col.get(c))}`).join(", ");
          const where = t.pk.map((c, i) => `${q(c)} = ${castParam(d.columns.length + i + 1, col.get(c))}`).join(" and ");
          const rows = later.get(d.fk.name);
          for (const r of rows) await tgt.unsafe(`update ${t.qname} set ${sets} where ${where}`, [...r.values, ...r.pk]);
          log(`${t.full}.${d.columns.join(", ")}: filled in on ${rows.length} rows`);
        }

        for (const t of order) {
          for (const c of t.columns.filter((x) => x.identity)) {
            const [{ v }] = await tgt.unsafe(
              `select setval(pg_get_serial_sequence($1, $2), coalesce(max(${q(c.name)}), 1), max(${q(c.name)}) is not null) as v from ${t.qname}`,
              [t.qname, c.name],
            );
            log(`${t.full}.${c.name}: next id follows ${v}`);
          }
        }
      } catch (e) {
        // The transaction is aborted; rolling it back undoes the disabling too.
        aborted = true;
        throw e;
      } finally {
        if (!aborted) for (const t of guarded) await tgt.unsafe(`alter table ${t.qname} enable trigger user`);
      }
    });
  }).catch(async (e) => {
    const off = await disabledTriggers(target).catch(() => ["(could not check)"]);
    const note = off.length ? ` Triggers still disabled on the target: ${off.join(", ")}.` : " Nothing was copied; the target's triggers are as they were.";
    if (e instanceof CopyError) throw new CopyError(`Copy failed: ${e.message}.${note}`);
    throw new CopyError(`Copy failed and was rolled back: ${e.message}${e.table_name ? ` (table ${e.table_name})` : ""}.${note}`);
  });

  const off = await disabledTriggers(target);
  if (off.length) throw new CopyError(`Copied, but these triggers are disabled on the target: ${off.join(", ")}`);
  const total = counts.reduce((a, c) => a + c.rows, 0);
  log(`Copied ${total} rows across ${counts.length} tables; every trigger is enabled again.`);
  return counts;
}

/** User triggers that are disabled on the copied tables, as "table.trigger". */
export async function disabledTriggers(sql) {
  const rows = await sql`
    select n.nspname::text || '.' || c.relname::text || '.' || g.tgname::text as name
    from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not g.tgisinternal and g.tgenabled = 'D'
      and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))
    order by 1`;
  return rows.map((r) => r.name);
}

export function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args) {
  const from = arg(args, "--from");
  const to = arg(args, "--to");
  if (!from || !to) throw new CopyError("Usage: node scripts/copy-data.mjs --from ENV_NAME --to ENV_NAME [--batch N]");
  if (process.env[from] && process.env[from] === process.env[to]) throw new CopyError(`${from} and ${to} hold the same connection string.`);
  const batch = Number(arg(args, "--batch") ?? 500);
  if (!Number.isInteger(batch) || batch < 1) throw new CopyError("--batch must be a whole number above 0.");
  const dir = arg(args, "--dir");
  const source = connectFromEnv(from);
  const target = connectFromEnv(to);
  try {
    await copyData(source, target, { batch, dir });
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof CopyError ? e.message : `Copy failed: ${e.message}`);
    process.exit(1);
  });
}
