import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Load KEY=VALUE pairs from the nearest repo `.env` (does not override existing env). */
export function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(here, "../../../.env"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\n/)) {
    const line = rawLine.replace(/\r$/, "").trim();
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
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Prefer dedicated MCP token; fall back to ingest token for local single-token setups. */
export function resolveMcpToken(): string | undefined {
  const mcp = process.env.CORTEX_MCP_TOKEN?.trim();
  if (mcp) return mcp;
  const ingest = process.env.CORTEX_INGEST_TOKEN?.trim();
  return ingest || undefined;
}

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  if (url.includes("YOUR_PROJECT_REF")) return false;
  return true;
}
