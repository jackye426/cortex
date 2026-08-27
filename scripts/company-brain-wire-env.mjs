#!/usr/bin/env node
/**
 * Append COMPANY_BRAIN_* to .env from existing Cortex Supabase credentials.
 * Generates bearer tokens if missing. Does not print secret values.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envPath = resolve(root, ".env");

if (!existsSync(envPath)) {
  console.error(".env not found");
  process.exit(1);
}

const raw = readFileSync(envPath, "utf8");
if (/^COMPANY_BRAIN_STORE=/m.test(raw)) {
  console.log("COMPANY_BRAIN_* already present in .env — skipped");
  process.exit(0);
}

function pick(key) {
  const m = raw.match(new RegExp(`^${key}=(.+)$`, "m"));
  return m?.[1]?.trim() ?? "";
}

const supabaseUrl = pick("SUPABASE_URL");
const serviceKey = pick("SUPABASE_SERVICE_ROLE_KEY");
const refMatch = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
const projectRef = refMatch?.[1] ?? "";

if (!supabaseUrl || !serviceKey || !projectRef) {
  console.error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env first");
  process.exit(1);
}

function secret() {
  return randomBytes(32).toString("base64url");
}

const webhookSecret =
  pick("GITHUB_WEBHOOK_SECRET").length >= 32
    ? pick("GITHUB_WEBHOOK_SECRET")
    : secret();

const block = `
# --- Company Brain V0 (namespaced cb_* on Cortex EU project) ---
COMPANY_BRAIN_STORE=supabase
COMPANY_BRAIN_PORT=8795
COMPANY_BRAIN_CUTOVER_AT=2026-08-01T00:00:00Z
COMPANY_BRAIN_SUPABASE_URL=${supabaseUrl}
COMPANY_BRAIN_SUPABASE_SERVICE_ROLE_KEY=${serviceKey}
COMPANY_BRAIN_SUPABASE_PROJECT_REF=${projectRef}
COMPANY_BRAIN_GITHUB_ALLOWED_REPOS=jackye426/cortex
COMPANY_BRAIN_GITHUB_INSTALLATION_IDS=
COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET=${webhookSecret}
COMPANY_BRAIN_INGEST_TOKEN=${secret()}
COMPANY_BRAIN_AGENT_TOKEN=${secret()}
COMPANY_BRAIN_FOUNDER_JACK_TOKEN=${secret()}
COMPANY_BRAIN_FOUNDER_ERIC_TOKEN=${secret()}
# Public HTTPS origin for GitHub App webhook (update after deploy):
# COMPANY_BRAIN_PUBLIC_URL=
`;

writeFileSync(envPath, raw.trimEnd() + block, "utf8");
console.log(
  "Appended COMPANY_BRAIN_* to .env (project ref: " +
    projectRef +
    "). Set COMPANY_BRAIN_GITHUB_INSTALLATION_IDS after App install.",
);
