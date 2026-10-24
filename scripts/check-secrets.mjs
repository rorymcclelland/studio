#!/usr/bin/env node
// Blocks commits that contain anything shaped like an API key (rule 6).
// Checks staged files by default; pass --all to scan every tracked file.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const PATTERNS = [
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: "OpenAI-style key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: "Inngest key", re: /signkey-(?:prod|test)-[A-Za-z0-9]{16,}/ },
  { name: "Supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Postgres URL with password", re: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]{6,}@(?!localhost|127\.0\.0\.1)/ },
];

// Test fixtures use obviously fake values.
const ALLOW = [/sk-ant-test-/, /sk-ant-secret-value-123/, /AIza-secret-value-456/, /sk-ant-x\b/];

export function findSecrets(text) {
  const hits = [];
  for (const line of text.split("\n")) {
    if (ALLOW.some((a) => a.test(line))) continue;
    for (const p of PATTERNS) if (p.re.test(line)) hits.push(p.name);
  }
  return hits;
}

const all = process.argv.includes("--all");
const files = execFileSync("git", all ? ["ls-files"] : ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.startsWith("node_modules/") && !/\.(png|jpe?g|webp|woff2?|ico)$/.test(f) && f !== "package-lock.json");

let bad = 0;
for (const f of files) {
  if (!existsSync(f)) continue;
  const hits = findSecrets(readFileSync(f, "utf8"));
  if (hits.length) {
    bad++;
    console.error(`  ${f}: looks like it contains ${[...new Set(hits)].join(", ")}`);
  }
}
if (bad) {
  console.error("\nCommit blocked: move secrets to environment variables (see .env.example).");
  process.exit(1);
}
