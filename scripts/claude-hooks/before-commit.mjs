#!/usr/bin/env node
// Claude Code PreToolUse hook: before any `git commit`, block the commit if
// staged files contain something key-shaped or the tests fail. Exit code 2
// blocks the command and tells Claude why.
import { execFileSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const command = JSON.parse(input || "{}")?.tool_input?.command ?? "";
if (!/\bgit\s+commit\b/.test(command)) process.exit(0);

for (const [label, cmd, args] of [
  ["Secret scan", "node", ["scripts/check-secrets.mjs"]],
  ["Tests", "npm", ["test", "--silent"]],
]) {
  try {
    execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    console.error(`${label} failed, so the commit is blocked:\n${`${e.stdout ?? ""}${e.stderr ?? ""}`.slice(-3000)}`);
    process.exit(2);
  }
}
