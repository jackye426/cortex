import assert from "node:assert/strict";
import { it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadCompanyBrainConfig } from "./env.js";
import { CompanyBrain } from "./service.js";
import { MemoryCompanyBrainStore } from "./store.js";
import { createCompanyBrainMcpServer } from "./tools.js";

const config = loadCompanyBrainConfig({
  COMPANY_BRAIN_STORE: "memory",
  COMPANY_BRAIN_CUTOVER_AT: "2026-08-01T00:00:00Z",
  COMPANY_BRAIN_GITHUB_ALLOWED_REPOS: "forma/app",
  COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET:
    "webhook-secret-32-bytes-minimum-value",
  COMPANY_BRAIN_INGEST_TOKEN: "ingest-token-value-at-least-32-bytes",
  COMPANY_BRAIN_AGENT_TOKEN: "agent-token-value-at-least-32-bytes-x",
  COMPANY_BRAIN_FOUNDER_JACK_TOKEN:
    "jack-token-value-at-least-32-bytes-x",
  COMPANY_BRAIN_FOUNDER_ERIC_TOKEN:
    "eric-token-value-at-least-32-bytes-x",
});

it("marks MCP domain failures as protocol tool errors", async () => {
  const brain = new CompanyBrain(config, new MemoryCompanyBrainStore());
  const server = createCompanyBrainMcpServer(brain, {
    id: "agent",
    kind: "agent",
    displayName: "Agent",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const result = await client.callTool({
    name: "brain_approve_proposal",
    arguments: { proposalId: "does-not-matter" },
  });
  assert.equal(result.isError, true);
  await Promise.all([client.close(), server.close()]);
});
