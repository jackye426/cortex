/**
 * Company Brain HTTP + MCP entrypoint.
 *
 * Loads COMPANY_BRAIN_* only. Never falls back to Cortex credentials.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { CompanyBrainConfigError } from "@cortex/company-brain";
import { createCompanyBrainRuntime } from "./app.js";

function loadCompanyBrainDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(here, "../../../.env"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\n/)) {
    const line = rawLine.replace(/\r$/, "").trim();
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadCompanyBrainDotEnv();

try {
  const { app, config } = createCompanyBrainRuntime(process.env);
  const port = Number(process.env.COMPANY_BRAIN_PORT ?? 8795);
  serve({ fetch: app.fetch, port }, (info) => {
    console.info(
      `Company Brain listening on http://localhost:${info.port} (${config.storeMode})`,
    );
    console.info(`  health:  http://localhost:${info.port}/health`);
    console.info(
      `  github:  POST http://localhost:${info.port}/v1/webhooks/github`,
    );
    console.info(`  mcp:     http://localhost:${info.port}/mcp`);
  });
} catch (error) {
  const message =
    error instanceof CompanyBrainConfigError ? error.message : String(error);
  console.error(`[company-brain] refuse to start: ${message}`);
  process.exit(1);
}
