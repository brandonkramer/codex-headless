#!/usr/bin/env node
/**
 * Cross-platform MCP launcher for Claude Code / Cursor.
 * Bash shebang scripts fail on Windows Claude plugin reconnect (-32000).
 * Claude's plugin cache on Windows often breaks pnpm symlink copies of
 * node_modules — fall back to ~/.cursor/plugins/local/codex-headless when needed.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

function resolveRoot() {
  const here = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (existsSync(join(here, "node_modules", "tsx"))) return here;

  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    join(home, ".cursor", "plugins", "local", "codex-headless"),
    join(home, ".agents", "plugins", "codex-headless"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "node_modules", "tsx"))) return candidate;
  }
  return here;
}

const root = resolveRoot();
const entry = join(root, "src", "mcp", "server.ts");
const child = spawn(
  process.execPath,
  ["--import", "tsx", entry, ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  },
);

child.on("error", (err) => {
  console.error(`codex-headless-mcp: failed to start: ${err.message}`);
  console.error(`  root=${root}`);
  console.error(`  need: node>=22 and pnpm install (tsx) in plugin root`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
