#!/usr/bin/env node
/**
 * Claude Code Stop / PostToolUse reference hook → Cortex ingest.
 *
 * Wire via ~/.claude/settings.json (or project settings) hooks:
 *
 * {
 *   "hooks": {
 *     "Stop": [{ "hooks": [{ "type": "command", "command": "node path/to/claude-stop.mjs" }] }],
 *     "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node path/to/claude-post-tool-use.mjs" }] }]
 *   }
 * }
 *
 * Claude Code posts JSON on stdin. We forward a redacted delta envelope.
 * Requires CORTEX_INGEST_URL + CORTEX_INGEST_TOKEN in the environment.
 */

import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { stdin } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { postIngest } from "./lib/post-ingest.mjs";

const HOOK_NAME = process.env.CORTEX_HOOK_NAME ?? "Stop";
const __dirname = dirname(fileURLToPath(import.meta.url));
void __dirname;

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Minimal inline redaction (hooks stay dependency-free). */
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
      kind: "claude_hook_delta",
      hook: HOOK_NAME,
      rawText: redactText(raw).slice(0, 50_000),
    };
  }

  const sessionId =
    parsed.session_id ??
    parsed.sessionId ??
    parsed.transcript_path?.match(/([0-9a-f-]{36})\.jsonl$/i)?.[1] ??
    "unknown";

  const toolName =
    parsed.tool_name ?? parsed.toolName ?? parsed.tool?.name ?? undefined;
  const toolInput = parsed.tool_input ?? parsed.toolInput ?? parsed.tool?.input;
  let argsPreview;
  try {
    argsPreview = JSON.stringify(toolInput ?? {}).slice(0, 200);
  } catch {
    argsPreview = undefined;
  }

  return {
    kind: "claude_hook_delta",
    hook: HOOK_NAME,
    sessionId,
    cwd: parsed.cwd ?? parsed.cwd_path,
    transcriptPath: parsed.transcript_path ?? parsed.transcriptPath,
    toolName,
    argsPreview,
    raw: JSON.parse(redactText(JSON.stringify(parsed))),
  };
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.exit(0);
  }

  const body = summarizePayload(raw);
  const sessionId = body.sessionId ?? "unknown";
  const sourceRecordId = `${sessionId}:${HOOK_NAME}:${sha256(raw).slice(0, 16)}`;

  const envelope = {
    source: "claude-code",
    sourceRecordId,
    occurredAt: new Date().toISOString(),
    mimeType: "application/json",
    body,
    provenance: {
      collector: `hook-claude-${HOOK_NAME}`,
      host: hostname(),
      workspace: typeof body.cwd === "string" ? body.cwd : undefined,
      extra: {
        kind: "claude_hook_summary",
        hook: HOOK_NAME,
        toolName: body.toolName,
        argsPreview: body.argsPreview,
      },
    },
  };

  await postIngest(envelope);
  process.exit(0);
}

main();
