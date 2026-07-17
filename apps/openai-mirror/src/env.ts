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

export function resolveMirrorUrl(): string {
  return (
    process.env.CORTEX_MIRROR_MCP_URL?.trim() ||
    process.env.CORTEX_MCP_URL?.trim() ||
    "http://localhost:8790/mcp"
  );
}

export function resolveMirrorToken(): string {
  const token =
    process.env.CORTEX_MCP_TOKEN?.trim() ||
    process.env.CORTEX_INGEST_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Set CORTEX_MCP_TOKEN (or CORTEX_INGEST_TOKEN) in repo .env",
    );
  }
  return token;
}
