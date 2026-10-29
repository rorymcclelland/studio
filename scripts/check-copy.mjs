#!/usr/bin/env node
// Checks a data copy (N-6): does database B hold exactly what A holds?
// Run after scripts/copy-data.mjs, from the same Action; removed in N-7.
//
//   node scripts/check-copy.mjs --a SUPABASE_DB_URL --b TARGET_DB_URL
//
// --a and --b name environment variables holding the connection strings
// (never the strings themselves). Each side is read in one repeatable-read,
// read-only transaction, with the same session settings, so values render
// the same way. It compares:
//   - the tables on each side (auth.users and public, less schema_migrations);
//   - per table, the row count and an md5 of every row in primary-key order
//     (each row cast to text, generated columns left out; for auth.users only
//     id, email and created_at), so values match and not just counts;
//   - on both sides, that every auth.users email is lower-case and trimmed
//     (a count only, never the addresses), since sign-in looks people up by
//     lower-cased address;
//   - every asset's sha256: the stored column and one recomputed from its
//     bytes, on both sides;
//   - on B, every foreign key: no row points at a missing parent (queried per
//     key from the catalogue, since a valid constraint can't be re-validated);
//   - on B, that no user trigger is left disabled and that every identity
//     sequence is above its column's highest value.
// It prints table names, counts and ids of differing assets, never row
// contents. Exit code 0 and "Copy matches", 1 with the differences listed, or
// 2 when it could not run.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_USER_COLUMNS,
  CopyError,
  SESSION_SETTINGS,
  arg,
  catalogue,
  connectFromEnv,
  copiedColumns,
  disabledTriggers,
  q,
  unnormalisedEmails,
  unnormalisedMessage,
} from "./copy-data.mjs";

/** The columns compared for a table, by name so column order doesn't matter. */
function comparedColumns(table) {
  const cols = table.full === "auth.users" ? table.columns.filter((c) => AUTH_USER_COLUMNS.includes(c.name)) : copiedColumns(table);
  return cols.map((c) => c.name).sort();
}

/**
 * One side's figures.
 * @param {import("postgres").Sql} sql
 * @param {boolean} checkIntegrity also look for orphans, disabled triggers and low sequences
 */
async function measure(sql, checkIntegrity) {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    for (const s of SESSION_SETTINGS) await tx.unsafe(s);
    const cat = await catalogue(tx);
    /** @type {Map<string, { columns: string[], rows: number, md5: string }>} */
    const tables = new Map();
    for (const t of cat.values()) {
      const columns = comparedColumns(t);
      const row = columns.map((c) => `t.${q(c)}${t.full === "auth.users" ? "::text" : ""}`).join(", ");
      const pk = t.pk.length ? t.pk.map((c) => `t.${q(c)}`).join(", ") : row;
      const [r] = await tx.unsafe(
        `select count(*)::int as rows, md5(coalesce(string_agg(md5(row(${row})::text), '' order by ${pk}), '')) as md5
         from ${t.qname} t`,
      );
      tables.set(t.full, { columns, rows: r.rows, md5: r.md5 });
    }

    /** @type {Map<string, { stored: string, actual: string }>} */
    const assets = new Map();
    if ([...cat.values()].some((t) => t.full === "public.assets")) {
      const rows = await tx`select id::text as id, sha256, encode(sha256(bytes), 'hex') as actual from public.assets order by id`;
      for (const r of rows) assets.set(r.id, { stored: r.sha256, actual: r.actual });
    }

    const problems = [];
    const hasUsers = [...cat.values()].some((t) => t.full === "auth.users");
    const mixed = hasUsers ? await unnormalisedEmails(tx) : 0;
    if (mixed) problems.push(unnormalisedMessage(mixed));
    if (checkIntegrity) {
      for (const t of cat.values()) {
        for (const fk of t.fks) {
          const parent = cat.get(fk.parent);
          if (!parent) continue;
          const filled = fk.cols.map((c) => `c.${q(c)} is not null`).join(" and ");
          const match = fk.cols.map((c, i) => `p.${q(fk.refcols[i])} = c.${q(c)}`).join(" and ");
          const [{ n }] = await tx.unsafe(
            `select count(*)::int as n from ${t.qname} c where ${filled}
               and not exists (select 1 from ${parent.qname} p where ${match})`,
          );
          if (n) problems.push(`foreign key ${fk.name} on ${t.full}: ${n} row(s) point at a missing ${parent.full} row`);
        }
        for (const c of t.columns.filter((x) => x.identity)) {
          const [s] = await tx.unsafe(
            `select (select max(${q(c.name)}) from ${t.qname})::text as max, pg_get_serial_sequence($1, $2) as seq`,
            [t.qname, c.name],
          );
          if (s.max === null || !s.seq) continue;
          const [v] = await tx.unsafe(`select last_value::text as last, is_called from ${s.seq}`);
          if (BigInt(v.last) < BigInt(s.max) || (BigInt(v.last) === BigInt(s.max) && !v.is_called))
            problems.push(`${t.full}.${c.name}: the next id would not be above the highest (${s.max})`);
        }
      }
      for (const name of await disabledTriggers(tx)) problems.push(`trigger ${name} is disabled`);
    }
    return { tables, assets, problems };
  });
}

/**
 * Differences between `a` (the source) and `b` (the copy); empty when they match.
 * @param {import("postgres").Sql} a
 * @param {import("postgres").Sql} b
 * @param {string[]} [labels]
 */
export async function compareCopy(a, b, labels = ["A", "B"]) {
  const [ma, mb] = await Promise.all([measure(a, false), measure(b, true)]);
  const [la, lb] = labels;
  const out = [];
  for (const name of [...new Set([...ma.tables.keys(), ...mb.tables.keys()])].sort()) {
    const x = ma.tables.get(name);
    const y = mb.tables.get(name);
    if (!y) out.push(`table ${name} is only on ${la}`);
    else if (!x) out.push(`table ${name} is only on ${lb}`);
    else if (x.columns.join(",") !== y.columns.join(",")) out.push(`table ${name}: columns differ (${la}: ${x.columns.join(", ")}; ${lb}: ${y.columns.join(", ")})`);
    else if (x.rows !== y.rows) out.push(`table ${name}: ${x.rows} rows on ${la}, ${y.rows} on ${lb}`);
    else if (x.md5 !== y.md5) out.push(`table ${name}: same ${x.rows} rows counted, but their values differ`);
  }
  for (const [label, m] of [[la, ma], [lb, mb]]) {
    for (const [id, h] of m.assets) if (h.stored !== h.actual) out.push(`asset ${id} on ${label}: its bytes don't match its stored sha256`);
  }
  for (const id of [...new Set([...ma.assets.keys(), ...mb.assets.keys()])].sort()) {
    const x = ma.assets.get(id);
    const y = mb.assets.get(id);
    if (!y) out.push(`asset ${id} is only on ${la}`);
    else if (!x) out.push(`asset ${id} is only on ${lb}`);
    else if (x.stored !== y.stored || x.actual !== y.actual) out.push(`asset ${id}: sha256 differs between ${la} and ${lb}`);
  }
  for (const p of ma.problems) out.push(`${la}: ${p}`);
  for (const p of mb.problems) out.push(`${lb}: ${p}`);
  const rows = [...ma.tables.values()].reduce((s, t) => s + t.rows, 0);
  return { differences: out, summary: `${ma.tables.size} tables, ${rows} rows, ${ma.assets.size} assets` };
}

async function main(args) {
  const names = [arg(args, "--a"), arg(args, "--b")];
  if (names.some((n) => !n)) {
    console.error("Usage: node scripts/check-copy.mjs --a ENV_NAME --b ENV_NAME");
    return 2;
  }
  const [a, b] = names.map((n) => connectFromEnv(/** @type {string} */ (n)));
  try {
    const { differences, summary } = await compareCopy(a, b, /** @type {string[]} */ (names));
    if (!differences.length) {
      console.log(`Copy matches (${summary}).`);
      return 0;
    }
    console.log(differences.join("\n"));
    console.log(`\n${differences.length} difference(s) between ${names[0]} and ${names[1]}.`);
    return 1;
  } finally {
    await Promise.all([a.end(), b.end()]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof CopyError ? e.message : `Check failed: ${e.message}`);
      process.exit(2);
    },
  );
}
