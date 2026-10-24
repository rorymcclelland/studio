#!/usr/bin/env node
// Claude Code PostToolUse hook: after Claude edits a TypeScript file, run the
// type checker and lint that file. Exit code 2 sends the errors back to Claude.
import { execFileSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const file = JSON.parse(input || "{}")?.tool_input?.file_path ?? "";
if (!/\.(ts|tsx)$/.test(file) || file.includes("node_modules")) process.exit(0);

const run = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
    return null;
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
  }
};

const problems = [run("npx", ["tsc", "--noEmit", "--pretty", "false"]), run("npx", ["eslint", "--max-warnings", "0", file])].filter(Boolean);
if (problems.length) {
  console.error(problems.join("\n\n").slice(0, 4000));
  process.exit(2);
}
