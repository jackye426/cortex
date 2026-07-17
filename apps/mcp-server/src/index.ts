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
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { runDistillateWorker } from "./distillate.js";
import {
  loadDotEnv,
  resolveMcpToken,
  resolveOpsMcpToken,
} from "./env.js";
import { logMcpAudit } from "./audit.js";
import {
  refreshSelfModel,
  runEmbedBackfill,
  runPriorityVsActual,
  runProjectBriefJob,
  seedEntitiesFromDistillates,
} from "./project-brief.js";
import { createStore } from "./store/index.js";
import { createCortexMcpServer } from "./tools.js";
import { askMirror } from "./analyst.js";
import { playbookForProfile, type McpToolProfile } from "./mcp-profile.js";
import { runYoutubeInterestDigest } from "./youtube-digest.js";
import { refreshPortrait } from "./portrait.js";
import { runSourceAdapter, SOURCE_ADAPTERS } from "./source-adapters.js";
import { runTwinPipeline } from "./twin-pipeline.js";
import { MEMORY_EVAL_QUESTIONS } from "./eval/baseline.js";
import { runInsightQualityFixtures } from "./eval/insight-quality.js";
import { extractObservations } from "./intrapersonal/extract-observations.js";
import { auditSourceCoverage } from "./intrapersonal/source-health.js";
loadDotEnv();

const vaultStore = createStore("vault");
const mirrorStore = createStore("mirror");

function requireBearer(
  authHeader: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 && token === expected.trim();
}

function createServer(
  profile: McpToolProfile,
  auditToken: string,
): McpServer {
  if (profile === "ops") {
    return createCortexMcpServer(vaultStore, {
      profile,
      auditToken,
      vaultStore,
    });
  }
  return createCortexMcpServer(mirrorStore, {
    profile,
    auditToken,
    vaultStore,
  });
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
    store: vaultStore.mode,
    credentials: {
      mirror: mirrorStore.credential,
      vault: vaultStore.credential,
    },
    endpoints: {
      mirror: "/mcp",
      ops: "/mcp/ops",
    },
    privilege: "distillates-default; raw via evidence broker",
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

  const result = await runDistillateWorker(vaultStore, { limit, dryRun });
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

  const result = await runProjectBriefJob(vaultStore, {
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

  const result = await runEmbedBackfill(vaultStore, { limit, dryRun, force });
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
    const result = await runPriorityVsActual(vaultStore, { dryRun });
    return c.json({ ok: true, job, ...result });
  }
  if (job === "seed-entities") {
    const result = await seedEntitiesFromDistillates(vaultStore, { dryRun, limit });
    return c.json({ ok: true, job, ...result });
  }
  if (job === "project-brief") {
    const result = await runProjectBriefJob(vaultStore, {
      dryRun,
      limitSessions: limit,
    });
    return c.json({ ok: true, job, ...result });
  }
  if (job === "self-model") {
    const row = await refreshSelfModel(vaultStore, { dryRun });
    return c.json({ ok: true, job, distillate: row });
  }
  if (job === "portrait") {
    const result = await refreshPortrait(vaultStore, { dryRun });
    return c.json({ ok: true, job, ...result });
  }
  if (job === "youtube-digest") {
    const result = await runYoutubeInterestDigest(vaultStore, { dryRun, limitRecords: limit });
    return c.json({ ok: true, job, ...result });
  }
  if (job === "extract-observations") {
    const result = await extractObservations(vaultStore, { dryRun, limit });
    return c.json({ ok: true, job, ...result });
  }
  return c.json(
    {
      error: "unknown job",
      jobs: [
        "seed-entities",
        "priority-vs-actual",
        "project-brief",
        "self-model",
        "portrait",
        "youtube-digest",
        "extract-observations",
      ],
    },
    400,
  );
});

/** Citation-required Analyst synthesis (ephemeral). */
app.post("/v1/ask-mirror", async (c) => {
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

  let query = "";
  let mode: "operational" | "reflective" | "both" | undefined;
  let limit = 12;
  try {
    const body = (await c.req.json()) as {
      query?: string;
      mode?: "operational" | "reflective" | "both";
      limit?: number;
    };
    query = typeof body.query === "string" ? body.query : "";
    mode = body.mode;
    if (typeof body.limit === "number" && body.limit > 0) {
      limit = Math.floor(body.limit);
    }
  } catch {
    return c.json({ error: "invalid json body" }, 400);
  }
  if (!query.trim()) {
    return c.json({ error: "query required" }, 400);
  }

  void logMcpAudit({
    token: expected,
    route: "/v1/ask-mirror",
    method: "POST",
    metadata: { mode, limit, queryLen: query.length },
  });

  const result = await askMirror(vaultStore, { query, mode, limit });
  return c.json({ ok: true, ...result });
});

/** Run a post-quality-gate source adapter by id. */
app.post("/v1/source-adapter", async (c) => {
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

  let adapter = "";
  let dryRun = false;
  let limit = 40;
  let force = false;
  try {
    const body = (await c.req.json()) as {
      adapter?: string;
      dryRun?: boolean;
      limit?: number;
      force?: boolean;
    };
    adapter = typeof body.adapter === "string" ? body.adapter : "";
    dryRun = Boolean(body.dryRun);
    force = Boolean(body.force);
    if (typeof body.limit === "number" && body.limit > 0) {
      limit = Math.floor(body.limit);
    }
  } catch {
    return c.json({ error: "invalid json body" }, 400);
  }
  if (!adapter) {
    return c.json(
      {
        error: "adapter required",
        adapters: SOURCE_ADAPTERS.map((a) => a.id),
      },
      400,
    );
  }

  void logMcpAudit({
    token: expected,
    route: "/v1/source-adapter",
    method: "POST",
    metadata: { adapter, dryRun, limit, force },
  });

  try {
    const result = await runSourceAdapter(vaultStore, adapter, {
      dryRun,
      limit,
      force,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : String(err),
        adapters: SOURCE_ADAPTERS.map((a) => a.id),
      },
      400,
    );
  }
});

/** Quality-gate harness: memory questions and/or insight-quality fixtures. */
app.post("/v1/quality-gate", async (c) => {
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

  let limitQuestions: number = MEMORY_EVAL_QUESTIONS.length;
  let suite: "memory" | "insight" | "all" = "memory";
  try {
    const body = (await c.req.json()) as { limit?: number; suite?: string };
    if (typeof body.limit === "number" && body.limit > 0) {
      limitQuestions = Math.floor(body.limit);
    }
    if (body.suite === "insight" || body.suite === "all" || body.suite === "memory") {
      suite = body.suite;
    }
  } catch {
    // empty ok
  }

  const out: Record<string, unknown> = {
    ok: true,
    store: vaultStore.mode,
    suite,
  };

  if (suite === "memory" || suite === "all") {
    const results = [];
    for (const q of MEMORY_EVAL_QUESTIONS.slice(0, limitQuestions)) {
      const answer = await askMirror(vaultStore, {
        query: q.question,
        mode: q.mode,
        limit: 10,
      });
      const hasEvidence = answer.evidence.length > 0;
      const unsupported = answer.claims.filter(
        (cl) =>
          cl.claimType !== "hypothesis" &&
          cl.evidenceRefs.some((id) => !answer.evidence.some((e) => e.id === id)),
      );
      results.push({
        id: q.id,
        question: q.question,
        expectsEvidence: q.expectsEvidence,
        hasEvidence,
        pass:
          q.expectsEvidence === false
            ? answer.confidence < 0.45 ||
              /insufficient/i.test(answer.answer) ||
              answer.gaps.length > 0
            : hasEvidence && unsupported.length === 0,
        confidence: answer.confidence,
        claimCount: answer.claims.length,
        evidenceCount: answer.evidence.length,
        gaps: answer.gaps,
        familyHistogram: answer.familyHistogram,
        evidenceIssues: answer.evidenceIssues,
      });
    }
    out.memory = {
      passed: results.filter((r) => r.pass).length,
      total: results.length,
      results,
    };
  }

  if (suite === "insight" || suite === "all") {
    const insight = runInsightQualityFixtures();
    out.insight = insight;
  }

  return c.json(out);
});

/** Source coverage audit (I1). */
app.post("/v1/audit/source-coverage", async (c) => {
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
  const report = await auditSourceCoverage(vaultStore);
  return c.json({ ok: true, store: vaultStore.mode, ...report });
});

/** Nightly / weekly / backfill twin pipeline (cron target). */
app.post("/v1/twin-pipeline", async (c) => {
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

  let mode: "nightly" | "weekly" | "backfill" = "nightly";
  let dryRun = false;
  let batchSize = 30;
  let maxBatches: number | undefined;
  try {
    const body = (await c.req.json()) as {
      mode?: string;
      dryRun?: boolean;
      batchSize?: number;
      maxBatches?: number;
    };
    if (body.mode === "weekly" || body.mode === "backfill" || body.mode === "nightly") {
      mode = body.mode;
    }
    dryRun = Boolean(body.dryRun);
    if (typeof body.batchSize === "number" && body.batchSize > 0) {
      batchSize = Math.floor(body.batchSize);
    }
    if (typeof body.maxBatches === "number" && body.maxBatches > 0) {
      maxBatches = Math.floor(body.maxBatches);
    }
  } catch {
    // empty body ok
  }

  void logMcpAudit({
    token: expected,
    route: "/v1/twin-pipeline",
    method: "POST",
    metadata: { mode, dryRun, batchSize, maxBatches },
  });

  const result = await runTwinPipeline(vaultStore, {
    mode,
    dryRun,
    batchSize,
    maxBatches,
  });
  return c.json({ ok: true, ...result });
});

async function handleMcpEndpoint(
  c: Context,
  profile: McpToolProfile,
  expected: string | undefined,
): Promise<Response> {
  if (!expected) {
    return c.json(
      {
        error:
          profile === "ops"
            ? "server misconfigured: set CORTEX_OPS_MCP_TOKEN or CORTEX_MCP_TOKEN"
            : "server misconfigured: set CORTEX_MCP_TOKEN or CORTEX_INGEST_TOKEN",
      },
      500,
    );
  }
  if (!requireBearer(c.req.header("authorization"), expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const route = profile === "ops" ? "/mcp/ops" : "/mcp";
  void logMcpAudit({
    token: expected,
    route,
    method: c.req.method,
    metadata: { endpoint: profile },
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createServer(profile, expected);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
}

/** Default Mirror endpoint — no raw vault tools. */
app.all("/mcp", async (c) => handleMcpEndpoint(c, "mirror", resolveMcpToken()));

/** Ops endpoint — vault tools + restricted capability issuance. */
app.all("/mcp/ops", async (c) =>
  handleMcpEndpoint(c, "ops", resolveOpsMcpToken()),
);

const port = Number(process.env.MCP_PORT ?? process.env.PORT ?? 8790);

serve({ fetch: app.fetch, port }, (info) => {
  console.info(
    `Cortex MCP listening on http://localhost:${info.port} (mirror=${mirrorStore.credential} vault=${vaultStore.credential})`,
  );
  console.info(`  health: http://localhost:${info.port}/health`);
  console.info(`  mirror: http://localhost:${info.port}/mcp`);
  console.info(`  ops:    http://localhost:${info.port}/mcp/ops`);
  console.info(`  playbook(mirror): ${playbookForProfile("mirror").slice(0, 60)}…`);
});

export { app, vaultStore, mirrorStore };
