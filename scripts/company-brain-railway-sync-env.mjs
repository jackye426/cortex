#!/usr/bin/env node
/**
 * Push COMPANY_BRAIN_* from .env to a Railway service (values not printed).
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const service = process.argv[2] ?? "@cortex/company-brain";
const envPath = resolve(fileURLToPath(new URL("../.env", import.meta.url)));

if (!existsSync(envPath)) {
  console.error(".env not found");
  process.exit(1);
}

const vars = {};
for (const rawLine of readFileSync(envPath, "utf8").split(/\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq <= 0) continue;
  const key = line.slice(0, eq).trim();
  if (!key.startsWith("COMPANY_BRAIN_")) continue;
  let value = line.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (value) vars[key] = value;
}

if (!vars.COMPANY_BRAIN_STORE) {
  console.error("No COMPANY_BRAIN_* vars in .env — run pnpm company-brain:wire-env first");
  process.exit(1);
}

vars.NODE_ENV = "production";

for (const [key, value] of Object.entries(vars)) {
  const result = spawnSync(
    "railway",
    ["variable", "set", "--service", service, `${key}=${value}`],
    { encoding: "utf8", shell: true },
  );
  if (result.status !== 0) {
    console.error(`Failed to set ${key}:`, result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  console.log(`Set ${key} on ${service}`);
}

console.log(`Synced ${Object.keys(vars).length} variables to Railway ${service}`);
