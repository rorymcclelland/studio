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

/** A migration file the splitter can't read safely (an unclosed quote or comment). */
export class SplitError extends Error {}

const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
const WORD_CHAR = /[A-Za-z0-9_$]/;

/**
 * Splits SQL into statements on the semicolons outside quotes and comments:
 * '...' (with '' inside), E'...' (with backslash escapes), "...", -- to the
 * end of the line, nested slash-star comments, and dollar quotes ($$ or a
 * tag such as $body$ or $tag1$). Throws a SplitError naming the line where an
 * unclosed one starts, rather than guessing.
 * @param {string} sql
 */
export function split(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  const lineAt = (pos) => sql.slice(0, pos).split("\n").length;
  const unclosed = (what, pos) => new SplitError(`Unclosed ${what} starting on line ${lineAt(pos)}; nothing was split.`);
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    const prev = i > 0 ? sql[i - 1] : "";
    let end = -1; // the index just past a quoted or commented span starting at i
    if (c === "-" && n === "-") {
      const e = sql.indexOf("\n", i);
      end = e < 0 ? sql.length : e;
    } else if (c === "/" && n === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; }
        else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; }
        else j++;
      }
      if (depth > 0) throw unclosed("/* comment", i);
      end = j;
    } else if (c === "'") {
      // An E'' string: the E stands alone, not as the end of a word.
      const escapes = (prev === "E" || prev === "e") && !(i > 1 && WORD_CHAR.test(sql[i - 2]));
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw unclosed("' string", i);
        if (escapes && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      end = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw unclosed('" identifier', i);
        if (sql[j] === '"' && sql[j + 1] === '"') { j += 2; continue; }
        if (sql[j] === '"') break;
        j++;
      }
      end = j + 1;
    } else if (c === "$" && !(prev && WORD_CHAR.test(prev))) {
      // Not after a word character: a$b$ is an identifier, not a quote.
      DOLLAR_TAG.lastIndex = i;
      const m = DOLLAR_TAG.exec(sql);
      if (m) {
        const tag = m[0];
        const e = sql.indexOf(tag, i + tag.length);
        if (e < 0) throw unclosed(`dollar quote ${tag}`, i);
        end = e + tag.length;
      }
    }
    if (end >= 0) {
      cur += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === ";") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
    i++;
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
  let stmts;
  try {
    stmts = split(readFileSync(f.path, "utf8"));
  } catch (err) {
    if (!(err instanceof SplitError)) throw err;
    console.error(`${f.name}: ${err.message}`);
    process.exit(1);
  }
  stmts.push(f.recordSql.replace(/;\s*$/, ""));
  writeFileSync(`${dir}/${f.name}.json`, JSON.stringify(stmts));
  console.log(f.name, stmts.length, "statements", JSON.stringify(stmts).length, "chars");
}
}
