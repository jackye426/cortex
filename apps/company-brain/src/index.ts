/**
 * Company Brain HTTP + MCP.
 *
 * Loads COMPANY_BRAIN_* only. Never falls back to Cortex credentials.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import {
  CompanyBrain,
  CompanyBrainConfigError,
  MemoryCompanyBrainStore,
  createCompanyBrainMcpServer,
  loadCompanyBrainConfig,
  resolveActorFromToken,
} from "@cortex/company-brain";

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

let config;
try {
  config = loadCompanyBrainConfig(process.env);
} catch (error) {
  const message =
    error instanceof CompanyBrainConfigError ? error.message : String(error);
  console.error(`[company-brain] refuse to start: ${message}`);
  process.exit(1);
}

if (config.storeMode !== "memory") {
  console.error(
    "[company-brain] supabase mode is configured but the V0 runtime still uses the isolated memory/service contract until the separate project is provisioned. Refusing to bind generic Cortex tables.",
  );
  process.exit(1);
}

const brain = new CompanyBrain(config, new MemoryCompanyBrainStore());
const app = new Hono();

function bearer(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "company-brain",
    store: config.storeMode,
    cutoverAt: config.cutoverAt.toISOString(),
    cortexRows: brain.store.countCortexLikeRows(),
  }),
);

app.post("/v1/webhooks/github", async (c) => {
  const rawBody = await c.req.text();
  let payload: unknown = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const result = brain.ingestGithubWebhook({
    eventName: c.req.header("x-github-event") ?? "",
    deliveryId: c.req.header("x-github-delivery"),
    rawBody,
    signatureHeader: c.req.header("x-hub-signature-256"),
    payload,
  });
  if (!result.accepted) {
    const status =
      result.code === "unsigned" || result.code === "bad_signature" ? 401 : 409;
    return c.json(result, status);
  }
  return c.json(result);
});

app.all("/mcp", async (c) => {
  const token = bearer(c.req.header("authorization"));
  const resolved = resolveActorFromToken(config, token);
  if (!resolved.ok || resolved.actor.kind === "ingest") {
    return c.json({ error: "unauthorized" }, 401);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createCompanyBrainMcpServer(brain, resolved.actor);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

const port = Number(process.env.COMPANY_BRAIN_PORT ?? 8795);
serve({ fetch: app.fetch, port }, (info) => {
  console.info(`Company Brain listening on http://localhost:${info.port}`);
  console.info(`  health:  http://localhost:${info.port}/health`);
  console.info(`  github:  POST http://localhost:${info.port}/v1/webhooks/github`);
  console.info(`  mcp:     http://localhost:${info.port}/mcp`);
});

export { app, brain };
