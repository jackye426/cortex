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
import {
  runEmbedBackfill,
  runPriorityVsActual,
  runProjectBriefJob,
  seedEntitiesFromDistillates,
} from "./project-brief.js";
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
  const server = new McpServer(
    {
      name: "cortex",
      version: "0.0.0",
    },
    {
      instructions: `Cortex retrieval playbook: list_recent_work for what you're building (sessions/github/email; calendar excluded); get_calendar_range for schedule; search_records for payload+distillate keywords; search_memory for semantic/insight; get_session for deep evidence; cortex_help for full playbook.`,
    },
  );
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

/** Trigger distillate worker (same bearer as MCP). */
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

/** Trigger project_brief rollup job (B3). */
app.post("/v1/project-brief", async (c) => {
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

  let limitSessions = 40;
  let dryRun = false;
  let projectKeys: string[] | undefined;
  try {
    const body = (await c.req.json()) as {
      limitSessions?: number;
      dryRun?: boolean;
      projectKeys?: string[];
    };
    if (typeof body.limitSessions === "number" && body.limitSessions > 0) {
      limitSessions = Math.floor(body.limitSessions);
    }
    dryRun = Boolean(body.dryRun);
    if (Array.isArray(body.projectKeys)) {
      projectKeys = body.projectKeys.filter((k) => typeof k === "string");
    }
  } catch {
    // empty body ok
  }

  void logMcpAudit({
    token: expected,
    route: "/v1/project-brief",
    method: "POST",
    metadata: { limitSessions, dryRun },
  });

  const result = await runProjectBriefJob(store, {
    limitSessions,
    dryRun,
    projectKeys,
  });
  return c.json({ ok: true, ...result });
});

/** Embed existing distillates without re-LLM (Track C backfill). */
app.post("/v1/embed-backfill", async (c) => {
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

  let limit = 50;
  let dryRun = false;
  let force = false;
  try {
    const body = (await c.req.json()) as {
      limit?: number;
      dryRun?: boolean;
      force?: boolean;
    };
    if (typeof body.limit === "number" && body.limit > 0) {
      limit = Math.floor(body.limit);
    }
    dryRun = Boolean(body.dryRun);
    force = Boolean(body.force);
  } catch {
    // empty body ok
  }

  void logMcpAudit({
    token: expected,
    route: "/v1/embed-backfill",
    method: "POST",
    metadata: { limit, dryRun, force },
  });

  const result = await runEmbedBackfill(store, { limit, dryRun, force });
  return c.json({ ok: true, ...result });
});

/** Twin: seed entities / priority week (same bearer). */
app.post("/v1/twin", async (c) => {
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

  let job = "seed-entities";
  let dryRun = false;
  let limit = 80;
  try {
    const body = (await c.req.json()) as {
      job?: string;
      dryRun?: boolean;
      limit?: number;
    };
    if (typeof body.job === "string") job = body.job;
    dryRun = Boolean(body.dryRun);
    if (typeof body.limit === "number" && body.limit > 0) {
      limit = Math.floor(body.limit);
    }
  } catch {
    // empty body ok
  }

  void logMcpAudit({
    token: expected,
    route: "/v1/twin",
    method: "POST",
    metadata: { job, dryRun, limit },
  });

  if (job === "priority-vs-actual") {
    const result = await runPriorityVsActual(store, { dryRun });
    return c.json({ ok: true, job, ...result });
  }
  if (job === "seed-entities") {
    const result = await seedEntitiesFromDistillates(store, { dryRun, limit });
    return c.json({ ok: true, job, ...result });
  }
  return c.json(
    { error: "unknown job", jobs: ["seed-entities", "priority-vs-actual"] },
    400,
  );
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
