#!/usr/bin/env node
/**
 * Codex Stop reference hook → Cortex ingest.
 *
 * Example Codex config (config.toml / hooks — adjust to your Codex version):
 *
 *   [hooks]
 *   stop = ["node C:/path/to/Cortex/hooks/codex-stop.mjs"]
 *
 * Or shell wrapper that pipes the stop payload on stdin.
 * Requires CORTEX_INGEST_URL + CORTEX_INGEST_TOKEN.
 *
 * Never reads ~/.codex/auth.json.
 */

import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { stdin } from "node:process";
import { postIngest } from "./lib/post-ingest.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function redactText(text) {
  return text
    .replace(/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:anthropic_api_key]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:openai_api_key]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED:github_token]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED:github_token]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, "Bearer [REDACTED:bearer_token]");
}

function summarizePayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      kind: "codex_hook_delta",
      hook: "Stop",
      rawText: redactText(raw).slice(0, 50_000),
    };
  }

  const sessionId =
    parsed.session_id ??
    parsed.sessionId ??
    parsed.thread_id ??
    parsed.conversation_id ??
    "unknown";

  const lastMessage =
    parsed.last_agent_message ??
    parsed.message ??
    parsed.preview ??
    undefined;

  return {
    kind: "codex_hook_delta",
    hook: "Stop",
    sessionId,
    cwd: parsed.cwd,
    title: typeof lastMessage === "string" ? lastMessage.slice(0, 200) : undefined,
    raw: JSON.parse(redactText(JSON.stringify(parsed))),
  };
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  const body = summarizePayload(raw);
  const sessionId = body.sessionId ?? "unknown";
  const sourceRecordId = `${sessionId}:Stop:${sha256(raw).slice(0, 16)}`;

  const envelope = {
    source: "codex",
    sourceRecordId,
    occurredAt: new Date().toISOString(),
    mimeType: "application/json",
    body,
    provenance: {
      collector: "hook-codex-Stop",
      host: hostname(),
      workspace: typeof body.cwd === "string" ? body.cwd : undefined,
      extra: {
        kind: "codex_hook_summary",
        hook: "Stop",
        title: body.title,
      },
    },
  };

  await postIngest(envelope);
  process.exit(0);
}

main();
