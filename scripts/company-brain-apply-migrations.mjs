#!/usr/bin/env node
/**
 * Apply Company Brain SQL migrations to an existing Supabase/Postgres project.
 *
 * Isolation is table/RPC namespaced (`cb_*`, `company_brain_private`) — Jack may
 * reuse the Cortex EU project. Still use COMPANY_BRAIN_* credentials at runtime
 * (never fall back to generic SUPABASE_*).
 *
 * Usage:
 *   COMPANY_BRAIN_DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
 *     node scripts/company-brain-apply-migrations.mjs
 *
 * Falls back to DATABASE_URL if COMPANY_BRAIN_DATABASE_URL is unset.
 * Prefer the Dashboard SQL Editor paste if neither psql nor `pg` is available.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migrationsDir = join(root, "apps/company-brain/migrations");

const databaseUrl = (
  process.env.COMPANY_BRAIN_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
).trim();

if (!databaseUrl) {
  console.error(
    "COMPANY_BRAIN_DATABASE_URL (or DATABASE_URL) is required.\n" +
      "Supabase Dashboard → Project Settings → Database → Connection string (URI).\n" +
      "Or paste apps/company-brain/migrations/*.sql into SQL Editor in numeric order.",
  );
  process.exit(1);
}

if (!existsSync(migrationsDir)) {
  console.error(`Migrations directory missing: ${migrationsDir}`);
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((name) => /^\d+_.*\.sql$/.test(name))
  .sort();

if (files.length === 0) {
  console.error(`No numbered *.sql files in ${migrationsDir}`);
  process.exit(1);
}

async function applyWithPsql(abs) {
  const result = spawnSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", abs],
    { encoding: "utf8" },
  );
  if (result.error?.code === "ENOENT") return { used: false };
  if (result.status === 0) {
    return { used: true, ok: true };
  }
  return {
    used: true,
    ok: false,
    detail: result.stderr || result.stdout || `psql exit ${result.status}`,
  };
}

async function applyWithPg(abs) {
  const require = createRequire(import.meta.url);
  let pg;
  try {
    pg = require("pg");
  } catch {
    return {
      used: false,
      detail:
        "psql not found and package `pg` is not installed.\n" +
        "Install PostgreSQL client tools, or: pnpm add -wD pg\n" +
        "Or paste the SQL into Supabase Dashboard → SQL Editor.",
    };
  }
  const sql = readFileSync(abs, "utf8");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    return { used: true, ok: true };
  } catch (error) {
    return {
      used: true,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end();
  }
}

for (const name of files) {
  const abs = join(migrationsDir, name);
  console.log(`Applying ${basename(abs)}…`);
  const psql = await applyWithPsql(abs);
  if (psql.used) {
    if (!psql.ok) {
      console.error(psql.detail);
      process.exit(1);
    }
    console.log(`  ok via psql`);
    continue;
  }
  const viaPg = await applyWithPg(abs);
  if (!viaPg.used) {
    console.error(viaPg.detail);
    process.exit(1);
  }
  if (!viaPg.ok) {
    console.error(viaPg.detail);
    process.exit(1);
  }
  console.log(`  ok via node:pg`);
}

console.log(
  `Applied ${files.length} Company Brain migration(s). Smoke: select id from public.cb_actors;`,
);
