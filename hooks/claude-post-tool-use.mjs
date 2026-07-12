#!/usr/bin/env node
/**
 * Claude Code PostToolUse reference hook → Cortex ingest.
 * Same payload path as Stop; sets CORTEX_HOOK_NAME=PostToolUse.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const stopScript = join(here, "claude-stop.mjs");

const child = spawn(process.execPath, [stopScript], {
  env: { ...process.env, CORTEX_HOOK_NAME: "PostToolUse" },
  stdio: ["pipe", "inherit", "inherit"],
});

process.stdin.pipe(child.stdin);
child.on("exit", (code) => process.exit(code ?? 0));
