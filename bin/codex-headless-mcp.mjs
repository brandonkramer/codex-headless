#!/usr/bin/env node
/**
 * Cross-platform MCP launcher for Claude Code / Cursor.
 * Bash shebang scripts fail on Windows Claude plugin reconnect (-32000).
 * Claude's Windows plugin cache copies of pnpm node_modules often break
 * (EPERM on nested store links) — prefer ~/.cursor/plugins/local/codex-headless
 * when present.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

function hasTsx(root) {
  return existsSync(join(root, "node_modules", "tsx", "package.json"));
}

function resolveRoot() {
  const here = join(dirname(fileURLToPath(import.meta.url)), "..");
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const preferred = [
    join(home, ".cursor", "plugins", "local", "codex-headless"),
    join(home, ".agents", "plugins", "codex-headless"),
  ].filter((p) => p && hasTsx(p));

  // Claude cache on Windows frequently ships a broken pnpm tree.
  const inClaudeCache = here.replace(/\\/g, "/").includes("/.claude/plugins/cache/");
  if (inClaudeCache && preferred.length > 0) return preferred[0];

  if (hasTsx(here)) return here;
  if (preferred.length > 0) return preferred[0];
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
