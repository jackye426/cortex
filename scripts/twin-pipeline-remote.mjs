#!/usr/bin/env node
/**
 * POST /v1/twin-pipeline on Railway (or CORTEX_MCP_URL).
 *
 *   node scripts/twin-pipeline-remote.mjs weekly --dry-run
 *   node scripts/twin-pipeline-remote.mjs weekly
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(".env");
if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, "utf8").split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const mode = process.argv[2] || "weekly";
const dryRun = process.argv.includes("--dry-run");
const url = (
  process.env.CORTEX_MCP_URL?.trim() ||
  "https://cortexmcp-server-production-1c59.up.railway.app"
).replace(/\/$/, "");
const token =
  process.env.CORTEX_MCP_TOKEN?.trim() ||
  process.env.CORTEX_INGEST_TOKEN?.trim();
if (!token) {
  console.error("CORTEX_MCP_TOKEN required");
  process.exit(1);
}

const body = {
  mode,
  dryRun,
  batchSize: 15,
  maxBatches: mode === "weekly" ? 2 : 5,
};

console.error(`POST ${url}/v1/twin-pipeline`, body);
const started = Date.now();
const res = await fetch(`${url}/v1/twin-pipeline`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(600_000),
});
const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  console.error(`HTTP ${res.status}`, text.slice(0, 500));
  process.exit(1);
}
console.log(JSON.stringify({ httpStatus: res.status, elapsedMs: Date.now() - started, ...json }, null, 2));
if (!res.ok) process.exit(1);
