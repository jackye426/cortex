import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCompanyBrainRuntime } from "./app.js";

const SECRET = "webhook-secret-32-bytes-minimum-value";
const env = {
  NODE_ENV: "test",
  COMPANY_BRAIN_STORE: "memory",
  COMPANY_BRAIN_CUTOVER_AT: "2026-08-01T00:00:00Z",
  COMPANY_BRAIN_GITHUB_ALLOWED_REPOS: "forma/app",
  COMPANY_BRAIN_GITHUB_INSTALLATION_IDS: "99",
  COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET: SECRET,
  COMPANY_BRAIN_INGEST_TOKEN: "ingest-token-value-at-least-32-bytes",
  COMPANY_BRAIN_AGENT_TOKEN: "agent-token-value-at-least-32-bytes-x",
  COMPANY_BRAIN_FOUNDER_JACK_TOKEN: "jack-token-value-at-least-32-bytes-x",
  COMPANY_BRAIN_FOUNDER_ERIC_TOKEN: "eric-token-value-at-least-32-bytes-x",
};

function signature(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function webhookHeaders(body: string, event = "pull_request") {
  return {
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": "delivery-1",
    "x-hub-signature-256": signature(body),
  };
}

describe("Company Brain HTTP boundary", () => {
  it("rejects memory persistence in production", () => {
    assert.throws(
      () => createCompanyBrainRuntime({ ...env, NODE_ENV: "production" }),
      /requires COMPANY_BRAIN_STORE=supabase/,
    );
  });

  it("reports the real event count", async () => {
    const { app } = createCompanyBrainRuntime(env);
    const response = await app.request("/health");
    assert.equal(response.status, 200);
    const health = (await response.json()) as { eventCount: number };
    assert.equal(health.eventCount, 0);
  });

  it("authenticates before parsing JSON", async () => {
    const { app } = createCompanyBrainRuntime(env);
    const response = await app.request("/v1/webhooks/github", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=bad" },
      body: "{not-json",
    });
    assert.equal(response.status, 401);
  });

  it("rejects oversized webhook bodies", async () => {
    const { app } = createCompanyBrainRuntime(env);
    const response = await app.request("/v1/webhooks/github", {
      method: "POST",
      headers: {
        "content-length": String(1024 * 1024 + 1),
        "x-hub-signature-256": "sha256=irrelevant",
      },
      body: "{}",
    });
    assert.equal(response.status, 413);
  });

  it("acknowledges signed terminal exclusions without retry status", async () => {
    const { app } = createCompanyBrainRuntime(env);
    const body = JSON.stringify({
      action: "opened",
      installation: { id: 99 },
      repository: { full_name: "other/repo" },
      pull_request: {
        number: 1,
        title: "Out of scope",
        created_at: "2026-08-20T12:00:00Z",
        updated_at: "2026-08-20T12:00:00Z",
      },
    });
    const response = await app.request("/v1/webhooks/github", {
      method: "POST",
      headers: webhookHeaders(body),
      body,
    });
    assert.equal(response.status, 202);
    const result = (await response.json()) as {
      ignored: boolean;
      code: string;
    };
    assert.equal(result.ignored, true);
    assert.equal(result.code, "out_of_scope");
  });

  it("accepts a signed merged PR and enforces MCP bearer auth", async () => {
    const { app } = createCompanyBrainRuntime(env);
    const body = JSON.stringify({
      action: "closed",
      installation: { id: 99 },
      sender: { login: "eric-forma" },
      repository: { full_name: "forma/app" },
      pull_request: {
        number: 12,
        title: "Fix report",
        merged: true,
        merged_at: "2026-08-20T12:00:00Z",
        updated_at: "2026-08-20T12:00:00Z",
      },
    });
    const webhook = await app.request("/v1/webhooks/github", {
      method: "POST",
      headers: webhookHeaders(body),
      body,
    });
    assert.equal(webhook.status, 200);

    const unauthorized = await app.request("/mcp", { method: "POST" });
    assert.equal(unauthorized.status, 401);
  });
});
