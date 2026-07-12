/**
 * Cortex remote MCP — streamable HTTP with bearer auth.
 *
 * Auth: Authorization: Bearer <token>
 *   Prefer CORTEX_MCP_TOKEN; falls back to CORTEX_INGEST_TOKEN.
 *
 * Store: Supabase when SUPABASE_URL + key are set; otherwise fixture mode.
 *
 *   pnpm --filter @cortex/mcp-server dev
 */
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { runDistillateWorker } from "./distillate.js";
import {
  loadDotEnv,
  resolveMcpToken,
} from "./env.js";
import { logMcpAudit } from "./audit.js";
import { createStore } from "./store/index.js";
import { registerCortexTools } from "./tools.js";
loadDotEnv();

const store = createStore();

function requireBearer(
  authHeader: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 && token === expected.trim();
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "cortex",
    version: "0.0.0",
  });
  registerCortexTools(server, store);
  return server;
}

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "mcp-session-id",
      "Last-Event-ID",
      "mcp-protocol-version",
    ],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "cortex-mcp",
    store: store.mode,
  }),
);

/** Trigger distillate stub (same bearer as MCP). */
app.post("/v1/distillate", async (c) => {
  const expected = resolveMcpToken();
  if (!expected) {
    return c.json(
      {
        error:
          "server misconfigured: set CORTEX_MCP_TOKEN or CORTEX_INGEST_TOKEN",
      },
      500,
    );
  }
  if (!requireBearer(c.req.header("authorization"), expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let limit = 20;
  let dryRun = false;
  try {
    const body = (await c.req.json()) as {
      limit?: number;
      dryRun?: boolean;
    };
    if (typeof body.limit === "number" && body.limit > 0) {
      limit = Math.floor(body.limit);
    }
    dryRun = Boolean(body.dryRun);
  } catch {
    // empty body ok
  }

  void logMcpAudit({
    token: expected,
    route: "/v1/distillate",
    method: "POST",
    metadata: { limit, dryRun },
  });

  const result = await runDistillateWorker(store, { limit, dryRun });
  return c.json({ ok: true, ...result });
});

app.all("/mcp", async (c) => {
  const expected = resolveMcpToken();
  if (!expected) {
    return c.json(
      {
        error:
          "server misconfigured: set CORTEX_MCP_TOKEN or CORTEX_INGEST_TOKEN",
      },
      500,
    );
  }
  if (!requireBearer(c.req.header("authorization"), expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  void logMcpAudit({
    token: expected,
    route: "/mcp",
    method: c.req.method,
  });

  // Stateless: fresh transport + server per request (Hono web-standard path).
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createServer();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

const port = Number(process.env.MCP_PORT ?? process.env.PORT ?? 8790);

serve({ fetch: app.fetch, port }, (info) => {
  console.info(
    `Cortex MCP listening on http://localhost:${info.port} (store=${store.mode})`,
  );
  console.info(`  health: http://localhost:${info.port}/health`);
  console.info(`  mcp:    http://localhost:${info.port}/mcp`);
});

export { app, store };
