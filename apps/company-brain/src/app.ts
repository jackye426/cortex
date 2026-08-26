import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import {
  CompanyBrain,
  MemoryCompanyBrainStore,
  SupabaseCompanyBrainStore,
  createCompanyBrainMcpServer,
  loadCompanyBrainConfig,
  resolveActorFromToken,
  verifyGithubSignature,
  type CompanyBrainConfig,
  type CompanyBrainStore,
} from "@cortex/company-brain";

const MAX_GITHUB_BODY_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {}

async function readBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new PayloadTooLargeError();
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function bearer(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

export interface CompanyBrainRuntime {
  app: Hono;
  brain: CompanyBrain;
  config: CompanyBrainConfig;
  store: CompanyBrainStore;
}

export function createCompanyBrainRuntime(
  env: NodeJS.Dict<string> = process.env,
): CompanyBrainRuntime {
  const config = loadCompanyBrainConfig(env);
  if (env.NODE_ENV === "production" && config.storeMode === "memory") {
    throw new Error(
      "production Company Brain requires COMPANY_BRAIN_STORE=supabase",
    );
  }
  const store: CompanyBrainStore =
    config.storeMode === "supabase"
      ? new SupabaseCompanyBrainStore(
          config.supabase!.url,
          config.supabase!.serviceRoleKey,
        )
      : new MemoryCompanyBrainStore();
  const brain = new CompanyBrain(config, store);
  const app = new Hono();

  app.get("/health", async (c) =>
    c.json({
      ok: true,
      service: "company-brain",
      store: config.storeMode,
      cutoverAt: config.cutoverAt.toISOString(),
      eventCount: await brain.store.countEvents(),
    }),
  );

  app.post("/v1/webhooks/github", async (c) => {
    let rawBody: string;
    try {
      rawBody = await readBodyLimited(c.req.raw, MAX_GITHUB_BODY_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return c.json({ error: "payload_too_large" }, 413);
      }
      throw error;
    }

    const signature = c.req.header("x-hub-signature-256");
    if (
      !verifyGithubSignature(
        rawBody,
        signature,
        config.github.webhookSecret,
      )
    ) {
      return c.json({ error: "invalid_signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const result = await brain.ingestGithubWebhook({
      eventName: c.req.header("x-github-event") ?? "",
      deliveryId: c.req.header("x-github-delivery"),
      rawBody,
      signatureHeader: signature,
      payload,
    });
    if (!result.accepted) {
      // Valid, signed deliveries that are intentionally excluded are terminal,
      // not retryable failures.
      return c.json({ ok: true, ignored: true, ...result }, 202);
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

  return { app, brain, config, store };
}
