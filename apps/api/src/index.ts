import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { RawEnvelope, SourceId } from "@cortex/core";
import { envelopeKey } from "@cortex/core";
import { normalizeRawEnvelope } from "@cortex/normalize";
import { redactValue } from "@cortex/redaction";
import {
  GITHUB_WEBHOOK_EVENTS,
  mapGithubWebhookToEnvelopes,
} from "./github-webhook.js";
import {
  bearerFromHeader,
  hashTokenId,
  logAuditEvent,
} from "./audit.js";
import { recordDeletion } from "./deletions.js";
import { isSupabaseConfigured, persistIngest } from "./persist.js";
/**
 * Ingest API:
 * - Bearer auth against CORTEX_INGEST_TOKEN
 * - Redact secrets → content hash → normalize
 * - Persist to Supabase (raw_artifacts + records [+ sessions grain])
 */

/** Load KEY=VALUE pairs from the nearest repo `.env` (does not override existing env). */
function loadDotEnv(): void {
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

loadDotEnv();

const app = new Hono();

/** Allow browser extension / local tools to POST (auth still required). */
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", c.req.header("Origin") ?? "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
  await next();
});

function requireBearer(authHeader: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  const expectedToken = expected.trim();
  return token.length > 0 && token === expectedToken;
}

function isSourceId(value: unknown): value is SourceId {
  return (
    typeof value === "string" &&
    [
      "cursor",
      "claude-code",
      "codex",
      "chatgpt",
      "chatgpt-export",
      "gmail",
      "calendar",
      "drive",
      "github",
      "calibre",
      "browser",
      "spotify",
      "youtube",
      "manual",
    ].includes(value)
  );
}

function parseEnvelope(body: unknown): RawEnvelope | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (!isSourceId(b.source)) {
    return { error: "invalid or missing source" };
  }
  if (typeof b.sourceRecordId !== "string" || !b.sourceRecordId) {
    return { error: "sourceRecordId is required" };
  }
  if (!b.provenance || typeof b.provenance !== "object") {
    return { error: "provenance is required" };
  }
  const provenance = b.provenance as Record<string, unknown>;
  if (typeof provenance.collector !== "string" || !provenance.collector) {
    return { error: "provenance.collector is required" };
  }
  if (!("body" in b)) {
    return { error: "body payload is required" };
  }

  return {
    source: b.source,
    sourceRecordId: b.sourceRecordId,
    occurredAt: typeof b.occurredAt === "string" ? b.occurredAt : undefined,
    mimeType: typeof b.mimeType === "string" ? b.mimeType : "application/json",
    body: b.body,
    contentHash: typeof b.contentHash === "string" ? b.contentHash : undefined,
    provenance: {
      collector: provenance.collector,
      host: typeof provenance.host === "string" ? provenance.host : undefined,
      workspace:
        typeof provenance.workspace === "string" ? provenance.workspace : undefined,
      extra:
        provenance.extra && typeof provenance.extra === "object"
          ? (provenance.extra as Record<string, unknown>)
          : undefined,
    },
  };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length).trim();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(received, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function ingestEnvelope(parsed: RawEnvelope): {
  key: string;
  contentHash: string;
  redactionHits: number;
  redactedBody: unknown;
  record: ReturnType<typeof normalizeRawEnvelope>;
} {
  const { value: redactedBody, hits } = redactValue(parsed.body);
  const serialized = JSON.stringify(redactedBody);
  const contentHash = parsed.contentHash ?? sha256Hex(serialized);
  const canonical = normalizeRawEnvelope({
    ...parsed,
    body: redactedBody,
    contentHash,
  });
  return {
    key: envelopeKey(parsed.source, parsed.sourceRecordId),
    contentHash,
    redactionHits: hits.reduce((n, h) => n + h.count, 0),
    redactedBody,
    record: canonical,
  };
}

app.get("/health", (c) => c.json({ ok: true, service: "cortex-api" }));

app.post("/v1/ingest", async (c) => {
  const expected = process.env.CORTEX_INGEST_TOKEN;
  if (!expected) {
    return c.json(
      { error: "server misconfigured: CORTEX_INGEST_TOKEN is not set" },
      500,
    );
  }
  if (!requireBearer(c.req.header("authorization"), expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const parsed = parseEnvelope(json);
  if ("error" in parsed) {
    return c.json({ error: parsed.error }, 400);
  }

  const result = ingestEnvelope(parsed);

  if (!isSupabaseConfigured()) {
    return c.json(
      {
        error:
          "server misconfigured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for ingest persistence",
      },
      500,
    );
  }

  let persisted: Awaited<ReturnType<typeof persistIngest>>;
  try {
    persisted = await persistIngest({
      source: parsed.source,
      sourceRecordId: parsed.sourceRecordId,
      occurredAt: parsed.occurredAt,
      mimeType: parsed.mimeType,
      redactedBody: result.redactedBody,
      contentHash: result.contentHash,
      provenance: parsed.provenance,
      record: result.record,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ingest] persist failed", message);
    return c.json({ error: "persist failed", detail: message }, 502);
  }

  const token = bearerFromHeader(c.req.header("authorization"));
  void logAuditEvent({
    source: parsed.source,
    tokenIdHash: hashTokenId(token ?? expected),
    route: "/v1/ingest",
    method: "POST",
    metadata: {
      key: result.key,
      contentHash: result.contentHash,
      redactionHits: result.redactionHits,
      recordId: persisted.recordId,
      rawArtifactId: persisted.rawArtifactId,
      sessionId: persisted.sessionId,
    },
  });

  console.info("[ingest]", {
    key: result.key,
    contentHash: result.contentHash,
    redactionHits: result.redactionHits,
    vaultPath: persisted.vaultPath,
    recordId: persisted.recordId,
    sessionId: persisted.sessionId,
  });

  return c.json({
    ok: true,
    key: result.key,
    contentHash: result.contentHash,
    redactionHits: result.redactionHits,
    vaultPath: persisted.vaultPath,
    recordId: persisted.recordId,
    rawArtifactId: persisted.rawArtifactId,
    sessionId: persisted.sessionId,
    record: result.record,
  });
});

/**
 * Soft-delete stub — insert tombstone in `deletions` (vault forever, no purge).
 * Body: { targetType, targetId, reason? }
 */
app.post("/v1/deletions", async (c) => {
  const expected = process.env.CORTEX_INGEST_TOKEN;
  if (!expected) {
    return c.json(
      { error: "server misconfigured: CORTEX_INGEST_TOKEN is not set" },
      500,
    );
  }
  if (!requireBearer(c.req.header("authorization"), expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (typeof body.targetType !== "string" || !body.targetType) {
    return c.json({ error: "targetType is required" }, 400);
  }
  if (typeof body.targetId !== "string" || !body.targetId) {
    return c.json({ error: "targetId is required" }, 400);
  }

  const tombstone = await recordDeletion({
    targetType: body.targetType,
    targetId: body.targetId,
    reason: typeof body.reason === "string" ? body.reason : undefined,
  });

  const token = bearerFromHeader(c.req.header("authorization"));
  void logAuditEvent({
    source: "manual",
    tokenIdHash: hashTokenId(token ?? expected),
    route: "/v1/deletions",
    method: "POST",
    metadata: {
      targetType: tombstone.targetType,
      targetId: tombstone.targetId,
    },
  });

  return c.json({ ok: true, deletion: tombstone });
});
/**
 * GitHub webhook stub — verify HMAC when GITHUB_WEBHOOK_SECRET is set,
 * map work-history events to envelopes, enqueue via the same ingest path.
 */
app.post("/v1/webhooks/github", async (c) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  const rawBody = await c.req.text();

  if (secret) {
    const sig = c.req.header("x-hub-signature-256");
    if (!verifyGithubSignature(rawBody, sig, secret)) {
      return c.json({ error: "invalid signature" }, 401);
    }
  } else {
    console.warn(
      "[webhook/github] GITHUB_WEBHOOK_SECRET not set — skipping signature verification",
    );
  }

  const event = c.req.header("x-github-event") ?? "";
  const deliveryId = c.req.header("x-github-delivery");

  if (!event) {
    return c.json({ error: "missing X-GitHub-Event header" }, 400);
  }

  if (!GITHUB_WEBHOOK_EVENTS.has(event)) {
    return c.json({
      ok: true,
      ignored: true,
      event,
      reason: "event out of Cortex work-history scope",
    });
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const envelopes = mapGithubWebhookToEnvelopes(event, deliveryId, payload);
  const ingested: Array<{
    key: string;
    contentHash: string;
    recordType: string;
    recordId?: string | null;
    vaultPath?: string | null;
  }> = [];

  for (const env of envelopes) {
    const result = ingestEnvelope(env);
    let recordId: string | null = null;
    let vaultPath: string | null = null;
    if (isSupabaseConfigured()) {
      try {
        const persisted = await persistIngest({
          source: env.source,
          sourceRecordId: env.sourceRecordId,
          occurredAt: env.occurredAt,
          mimeType: env.mimeType,
          redactedBody: result.redactedBody,
          contentHash: result.contentHash,
          provenance: env.provenance,
          record: result.record,
        });
        recordId = persisted.recordId;
        vaultPath = persisted.vaultPath;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[webhook/github] persist failed", message);
        return c.json({ error: "persist failed", detail: message }, 502);
      }
    }
    console.info("[webhook/github]", {
      event,
      deliveryId,
      key: result.key,
      contentHash: result.contentHash,
      recordType: result.record.recordType,
      recordId,
    });
    ingested.push({
      key: result.key,
      contentHash: result.contentHash,
      recordType: result.record.recordType,
      recordId,
      vaultPath,
    });
  }

  return c.json({
    ok: true,
    event,
    deliveryId: deliveryId ?? null,
    signatureVerified: Boolean(secret),
    enqueued: ingested.length,
    items: ingested,
  });
});

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.info(`Cortex API listening on http://localhost:${info.port}`);
});

export { app };
