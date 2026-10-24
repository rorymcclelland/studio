#!/usr/bin/env node
// Rebuilds a local or CI database from scratch: drops and recreates it,
// applies the Supabase shim, then every migration in order.
// Usage: node scripts/db-reset.mjs [--seed]
// Refuses to run against anything that is not localhost, so it can never
// touch the hosted Supabase project.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const target = new URL(url);
if (!["localhost", "127.0.0.1"].includes(target.hostname)) {
  console.error(`Refusing to reset a non-local database (${target.hostname}).`);
  process.exit(1);
}
const dbName = target.pathname.slice(1);
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";

const admin = postgres(adminUrl.toString(), { onnotice: () => {} });
await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
await admin.unsafe(`create database "${dbName}"`);
await admin.end();

const sql = postgres(url, { onnotice: () => {} });
const root = new URL("..", import.meta.url).pathname;
await sql.unsafe(readFileSync(join(root, "db/shim/supabase-shim.sql"), "utf8"));
const dir = join(root, "supabase/migrations");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  await sql.unsafe(readFileSync(join(dir, file), "utf8"));
  console.log(`applied ${file}`);
}
if (process.argv.includes("--seed")) {
  await sql.unsafe(readFileSync(join(root, "supabase/seed.sql"), "utf8"));
  console.log("applied seed.sql");
}
await sql.end();
