#!/usr/bin/env node
// Rebuilds a local or CI database from scratch: drops and recreates it, then
// applies every migration in db/migrations through the runner (db-migrate.mjs).
// Usage: node scripts/db-reset.mjs [--seed]
// Refuses to run against anything that is not localhost, so it can never
// touch a hosted database.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { MigrationError, migrate } from "./db-migrate.mjs";

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

const sql = postgres(url, { onnotice: () => {}, max: 1 });
try {
  await migrate(sql);
  if (process.argv.includes("--seed")) {
    const root = new URL("..", import.meta.url).pathname;
    await sql.unsafe(readFileSync(join(root, "db/seed.sql"), "utf8"));
    console.log("applied seed.sql");
  }
} catch (e) {
  console.error(e instanceof MigrationError ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
