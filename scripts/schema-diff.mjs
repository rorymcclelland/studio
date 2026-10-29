#!/usr/bin/env node
// Compares the schema of two databases (N-1 test case 6 compared the old
// production database with Neon), from catalog queries, so it needs no pg_dump.
//
//   node scripts/schema-diff.mjs --a OLD_DB_URL --b NEON_DB_URL
//   node scripts/schema-diff.mjs --a NAME --dump      print one database's description
//
// --a and --b name environment variables holding the connection strings, so no
// string is typed on a command line or printed. Exit code 0 when they match,
// 1 when they differ, 2 when it could not run.
//
// What is compared, in `public`: tables and views (with RLS on or off), columns
// (type, nullability, default, identity), constraints, indexes, policies (command,
// roles, expressions), functions (signature, result, language, volatility,
// security definer, settings, sha256 of the body), enums, triggers, and the
// grants on tables, columns and functions to anon, authenticated and PUBLIC.
// In `auth`, only what Studio's baseline defines: auth.users's id, email and
// created_at (with their constraints and indexes), auth.uid() and auth.role().
// Ignored: every other schema, a hosted provider's other auth objects and
// columns, its roles, owners, extension objects, and the runner's own schema_migrations.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const AUTH_COLUMNS = ["id", "email", "created_at"];
const AUTH_FUNCTIONS = ["uid", "role"];
const GRANTEES = ["anon", "authenticated", "PUBLIC"];
const IGNORED_TABLES = ["public.schema_migrations"];

const hash = (s) => createHash("sha256").update(s ?? "").digest("hex").slice(0, 16);
const notExtension = (alias) =>
  `not exists (select 1 from pg_depend d where d.objid = ${alias}.oid and d.deptype = 'e')`;

/**
 * A flat, normalised description of the `public` and `auth` schemas: key -> value.
 * @param {import("postgres").Sql} sql
 * @returns {Promise<Record<string, string>>}
 */
export async function describeSchema(sql) {
  /** @type {Record<string, string>} */
  const out = {};

  const tables = (
    await sql.unsafe(`
    select c.oid, n.nspname as schema, c.relname as name, c.relkind as kind,
           c.relrowsecurity as rls, c.relforcerowsecurity as force,
           case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid) end as viewdef
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'auth') and c.relkind in ('r', 'p', 'v', 'm') and ${notExtension("c")}`)
  ).filter((t) => (t.schema === "auth" ? t.name === "users" : !IGNORED_TABLES.includes(`public.${t.name}`)));
  const byOid = new Map(tables.map((t) => [Number(t.oid), t]));
  const oids = [...byOid.keys()];
  if (!oids.length) return out;
  const tname = (oid) => `${byOid.get(Number(oid)).schema}.${byOid.get(Number(oid)).name}`;
  const isAuth = (oid) => byOid.get(Number(oid)).schema === "auth";

  for (const t of tables) {
    out[`table ${t.schema}.${t.name}`] =
      `kind=${t.kind} rls=${t.rls ? "on" : "off"} force=${t.force ? "on" : "off"}` +
      (t.viewdef ? ` view=${hash(t.viewdef.replace(/\s+/g, " ").trim())}` : "");
  }

  const columns = await sql`
    select a.attrelid as rel, a.attnum, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as def, a.attidentity as ident,
           a.attgenerated as gen
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = any(${oids}) and a.attnum > 0 and not a.attisdropped`;
  const authAttnums = new Map(); // auth.users attnum -> name, for constraints and indexes
  for (const c of columns) {
    if (isAuth(c.rel)) {
      if (!AUTH_COLUMNS.includes(c.name)) continue;
      authAttnums.set(Number(c.attnum), c.name);
    }
    out[`column ${tname(c.rel)}.${c.name}`] =
      `${c.type}${c.notnull ? " not null" : ""}${c.def ? ` default ${c.def}` : ""}` +
      `${c.ident ? ` identity=${c.ident}` : ""}${c.gen ? ` generated=${c.gen}` : ""}`;
  }
  const inAuthColumns = (attnums) => attnums.every((n) => authAttnums.has(Number(n)));

  // Not-null is compared on the column (Postgres 18 also lists it as a constraint).
  const constraints = await sql`
    select conrelid as rel, conname as name, conkey, conindid, pg_get_constraintdef(oid) as def
    from pg_constraint where conrelid = any(${oids}) and contype <> 'n'`;
  const constraintIndexes = new Set();
  for (const c of constraints) {
    if (isAuth(c.rel) && !inAuthColumns(c.conkey ?? [])) continue;
    if (Number(c.conindid)) constraintIndexes.add(Number(c.conindid));
    out[`constraint ${tname(c.rel)}.${c.name}`] = c.def;
  }

  const indexes = await sql`
    select i.indrelid as rel, i.indexrelid as oid, x.relname as name, i.indkey::int2[] as keys,
           pg_get_indexdef(i.indexrelid) as def
    from pg_index i join pg_class x on x.oid = i.indexrelid
    where i.indrelid = any(${oids})`;
  for (const i of indexes) {
    if (constraintIndexes.has(Number(i.oid))) continue; // compared as its constraint
    if (isAuth(i.rel) && (i.keys.some((k) => Number(k) === 0) || !inAuthColumns(i.keys))) continue;
    out[`index ${byOid.get(Number(i.rel)).schema}.${i.name}`] = i.def;
  }

  const policies = await sql`
    select p.polrelid as rel, p.polname as name, p.polcmd as cmd, p.polpermissive as permissive,
           array(select case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end
                 from unnest(p.polroles) r order by 1) as roles,
           pg_get_expr(p.polqual, p.polrelid) as using_expr, pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
    from pg_policy p where p.polrelid = any(${oids})`;
  for (const p of policies) {
    out[`policy ${tname(p.rel)}.${p.name}`] =
      `cmd=${p.cmd} ${p.permissive ? "permissive" : "restrictive"} to=${p.roles.join(",")}` +
      ` using=${p.using_expr ?? "-"} check=${p.check_expr ?? "-"}`;
  }

  const triggers = await sql`
    select tgrelid as rel, tgname as name, pg_get_triggerdef(oid) as def, tgenabled as enabled
    from pg_trigger where tgrelid = any(${oids}) and not tgisinternal`;
  for (const t of triggers) out[`trigger ${tname(t.rel)}.${t.name}`] = `${t.def} enabled=${t.enabled}`;

  const functions = (
    await sql.unsafe(`
    select p.oid, n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as result, l.lanname as lang, p.provolatile as vol,
           p.prosecdef as secdef, p.proconfig as config, p.prokind as kind, p.prosrc as src,
           array(select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type
                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a order by 1) as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname in ('public', 'auth') and ${notExtension("p")}`)
  ).filter((f) => (f.schema === "auth" ? AUTH_FUNCTIONS.includes(f.name) && f.args === "" : true));
  for (const f of functions) {
    const sig = `${f.schema}.${f.name}(${f.args})`;
    out[`function ${sig}`] =
      `kind=${f.kind} returns ${f.result} language=${f.lang} volatility=${f.vol}` +
      `${f.secdef ? " security definer" : ""} config=${(f.config ?? []).join(",") || "-"}` +
      ` body=${hash(f.src.replace(/\s+/g, " ").trim())}`;
    if (f.schema !== "public") continue;
    for (const g of GRANTEES) {
      const privs = f.acl.filter((a) => a.startsWith(`${g}:`)).map((a) => a.slice(g.length + 1));
      if (privs.length) out[`grant function ${sig} ${g}`] = privs.join(",");
    }
  }

  const tableGrants = await sql`
    select c.oid as rel, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
           array_agg(a.privilege_type order by a.privilege_type) as privs
    from pg_class c, aclexplode(c.relacl) a
    where c.oid = any(${oids}) group by 1, 2`;
  for (const g of tableGrants) {
    if (isAuth(g.rel) || !GRANTEES.includes(g.grantee)) continue;
    out[`grant ${tname(g.rel)} ${g.grantee}`] = g.privs.join(",");
  }
  const columnGrants = await sql`
    select a.attrelid as rel, a.attname as col,
           case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
           array_agg(x.privilege_type order by x.privilege_type) as privs
    from pg_attribute a, aclexplode(a.attacl) x
    where a.attrelid = any(${oids}) and a.attnum > 0 and not a.attisdropped group by 1, 2, 3`;
  for (const g of columnGrants) {
    if (isAuth(g.rel) || !GRANTEES.includes(g.grantee)) continue;
    out[`grant ${tname(g.rel)}.${g.col} ${g.grantee}`] = g.privs.join(",");
  }

  const enums = await sql`
    select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
    from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public' group by 1`;
  for (const e of enums) out[`enum public.${e.name}`] = e.labels.join(",");

  // Expressions can span lines; layout is not a difference.
  for (const k of Object.keys(out)) out[k] = out[k].replace(/\s+/g, " ").trim();
  return out;
}

/**
 * Lines describing how `b` differs from `a`; empty when they match.
 * @param {Record<string, string>} a
 * @param {Record<string, string>} b
 * @param {string[]} [labels]
 * @returns {string[]}
 */
export function diffDescriptions(a, b, labels = ["A", "B"]) {
  const lines = [];
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (!(key in b)) lines.push(`- ${key} (only in ${labels[0]}): ${a[key]}`);
    else if (!(key in a)) lines.push(`+ ${key} (only in ${labels[1]}): ${b[key]}`);
    else if (a[key] !== b[key]) lines.push(`~ ${key}\n    ${labels[0]}: ${a[key]}\n    ${labels[1]}: ${b[key]}`);
  }
  return lines;
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function describeFrom(envName) {
  const sql = postgres(process.env[envName], { onnotice: () => {}, max: 1, connect_timeout: 15 });
  try {
    return await describeSchema(sql);
  } finally {
    await sql.end();
  }
}

async function main(args) {
  const names = [arg(args, "--a"), args.includes("--dump") ? null : arg(args, "--b")].filter((n) => n !== null);
  const missing = names.filter((n) => !n || !process.env[n]);
  if (missing.length || !names.length) {
    console.error(
      `Usage: node scripts/schema-diff.mjs --a ENV_NAME --b ENV_NAME (or --a ENV_NAME --dump). ` +
        `Not set: ${missing.map((n) => n ?? "(no name given)").join(", ") || "--a"}.`,
    );
    return 2;
  }
  if (args.includes("--dump")) {
    const d = await describeFrom(names[0]);
    for (const k of Object.keys(d).sort()) console.log(`${k}: ${d[k]}`);
    return 0;
  }
  const [a, b] = await Promise.all(names.map(describeFrom));
  const lines = diffDescriptions(a, b, names);
  if (!lines.length) {
    console.log(`No differences (${Object.keys(a).length} objects compared).`);
    return 0;
  }
  console.log(lines.join("\n"));
  console.log(`\n${lines.length} difference(s) between ${names[0]} and ${names[1]}.`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`Schema comparison failed: ${e.message}`);
      process.exit(2);
    },
  );
}
