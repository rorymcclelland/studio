#!/usr/bin/env node
// Splits each pending migration into the statement list the Neon connector's
// run_sql_transaction takes (its migration tool splits on every ";" and breaks on
// dollar-quoted function bodies). Respects quotes, comments and dollar quotes; adds the
// file's schema_migrations insert as the last statement, so the record and the schema
// commit together.
//   node scripts/neon-statements.mjs pending.json OUTDIR
// pending.json is the output of: db-migrate.mjs --list-pending --json --applied rows.json --with-sql
// Writes OUTDIR/<file>.json (a JSON array of statements) for each pending file.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @param {string} sql */
export function split(sql) {
  const out = []; let cur = ""; let i = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === "-" && n === "-") { const e = sql.indexOf("\n", i); const end = e < 0 ? sql.length : e; cur += sql.slice(i, end); i = end; continue; }
    if (c === "/" && n === "*") { const e = sql.indexOf("*/", i + 2); cur += sql.slice(i, e + 2); i = e + 2; continue; }
    if (c === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; } if (sql[j] === "'") break; j++; } cur += sql.slice(i, j + 1); i = j + 1; continue; }
    if (c === '"') { const e = sql.indexOf('"', i + 1); cur += sql.slice(i, e + 1); i = e + 1; continue; }
    if (c === "$") { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) { const tag = m[0]; const e = sql.indexOf(tag, i + tag.length); cur += sql.slice(i, e + tag.length); i = e + tag.length; continue; } }
    if (c === ";") { out.push(cur); cur = ""; i++; continue; }
    cur += c; i++;
  }
  out.push(cur);
  // Drop comment-only or empty pieces; strip leading comment lines from each.
  return out.map((s) => s.replace(/^(\s*--[^\n]*\n)+/g, "").trim()).filter((s) => s && !/^(--[^\n]*\s*)*$/.test(s));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

function main() {
const pending = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8")).pending;
const dir = process.argv[3];
for (const f of pending) {
  const stmts = split(readFileSync(f.path, "utf8"));
  stmts.push(f.recordSql.replace(/;\s*$/, ""));
  writeFileSync(`${dir}/${f.name}.json`, JSON.stringify(stmts));
  console.log(f.name, stmts.length, "statements", JSON.stringify(stmts).length, "chars");
}
}
