#!/usr/bin/env node
/**
 * Apply a Supabase SQL migration using DATABASE_URL + psql (or node:pg if installed).
 *
 * Usage:
 *   DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
 *     node scripts/apply-migration.mjs supabase/migrations/20260716160000_evidence_capabilities_and_calendar_view.sql
 *
 * Prefer `npx supabase db push` when the project is linked.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-migration.mjs <path-to.sql>");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is required (Supabase Dashboard → Project Settings → Database).",
  );
  console.error(
    "Or paste the migration into SQL Editor, or run: npx supabase db push",
  );
  process.exit(1);
}

const abs = resolve(file);
if (!existsSync(abs)) {
  console.error(`File not found: ${abs}`);
  process.exit(1);
}

const psql = spawnSync(
  "psql",
  [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", abs],
  { encoding: "utf8" },
);
if (psql.error?.code !== "ENOENT") {
  if (psql.status === 0) {
    console.log(`Applied ${file} via psql`);
    process.exit(0);
  }
  console.error(psql.stderr || psql.stdout);
  process.exit(psql.status ?? 1);
}

const require = createRequire(import.meta.url);
let pg;
try {
  pg = require("pg");
} catch {
  console.error(
    "psql not found and package `pg` is not installed. Install one of:\n" +
      "  - PostgreSQL client tools (psql)\n" +
      "  - pnpm add -wD pg\n" +
      "Or paste the SQL into Supabase Dashboard → SQL Editor.",
  );
  process.exit(1);
}

const sql = readFileSync(abs, "utf8");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query(sql);
  console.log(`Applied ${file} via node:pg`);
} finally {
  await client.end();
}
