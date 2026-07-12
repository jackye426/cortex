#!/usr/bin/env node
/**
 * Cursor hooks → Cortex ingest (stop / afterFileEdit / afterShellExecution).
 *
 * Wire via ~/.cursor/hooks.json (see hooks/README.md). JSON arrives on stdin.
 * Posts a cursor_hook_delta envelope with noise-filtered summaries only for
 * shell/file hooks (full shell output truncated). Never blocks the agent.
 *
 * Requires CORTEX_INGEST_URL + CORTEX_INGEST_TOKEN.
 */

import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { stdin } from "node:process";
import { postIngest } from "./lib/post-ingest.mjs";

const HOOK_NAME = process.env.CORTEX_HOOK_NAME ?? "stop";

const OUTPUT_PREVIEW_MAX = 2_000;
const ARGS_PREVIEW_MAX = 200;

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
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, "Bearer [REDACTED:bearer_token]")
    .replace(/secret:\/\/[^\s"']+/g, "[REDACTED:cursor_secret_ref]");
}

function truncate(s, max) {
  if (typeof s !== "string") return s;
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function summarizePayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      kind: "cursor_hook_delta",
      hook: HOOK_NAME,
      rawText: redactText(raw).slice(0, 50_000),
    };
  }

  const sessionId =
    parsed.conversation_id ??
    parsed.conversationId ??
    parsed.composerId ??
    parsed.generation_id ??
    "unknown";

  const base = {
    kind: "cursor_hook_delta",
    hook: HOOK_NAME,
    sessionId,
    generationId: parsed.generation_id ?? parsed.generationId,
    status: parsed.status,
    model: parsed.model ?? parsed.model_id,
    workspaceRoots: parsed.workspace_roots ?? parsed.workspaceRoots,
  };

  if (HOOK_NAME === "afterFileEdit" || parsed.file_path || parsed.filePath) {
    const filePath = parsed.file_path ?? parsed.filePath;
    const edits = Array.isArray(parsed.edits) ? parsed.edits : [];
    return {
      ...base,
      filePath,
      editCount: edits.length,
      // Keep edit previews short — full old/new stay out of summary
      editsPreview: edits.slice(0, 5).map((e) => ({
        oldPreview: truncate(String(e?.old_string ?? e?.old_line ?? ""), 80),
        newPreview: truncate(String(e?.new_string ?? e?.new_line ?? ""), 80),
      })),
      raw: JSON.parse(redactText(JSON.stringify(parsed))),
    };
  }

  if (HOOK_NAME === "afterShellExecution" || parsed.command) {
    return {
      ...base,
      command: truncate(String(parsed.command ?? ""), ARGS_PREVIEW_MAX),
      durationMs: parsed.duration,
      sandbox: parsed.sandbox,
      outputPreview: truncate(String(parsed.output ?? ""), OUTPUT_PREVIEW_MAX),
      // Full shell output can be huge — omit from vault body by default
      raw: JSON.parse(
        redactText(
          JSON.stringify({
            ...parsed,
            output: truncate(String(parsed.output ?? ""), OUTPUT_PREVIEW_MAX),
          }),
        ),
      ),
    };
  }

  // stop (and unknown)
  return {
    ...base,
    loopCount: parsed.loop_count ?? parsed.loopCount,
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

  const workspace =
    Array.isArray(body.workspaceRoots) && typeof body.workspaceRoots[0] === "string"
      ? body.workspaceRoots[0]
      : typeof body.filePath === "string"
        ? body.filePath
        : undefined;

  const envelope = {
    source: "cursor",
    sourceRecordId,
    occurredAt: new Date().toISOString(),
    mimeType: "application/json",
    body,
    provenance: {
      collector: `hook-cursor-${HOOK_NAME}`,
      host: hostname(),
      workspace,
      extra: {
        kind: "cursor_hook_summary",
        hook: HOOK_NAME,
        command: body.command,
        filePath: body.filePath,
        status: body.status,
      },
    },
  };

  await postIngest(envelope);
  process.exit(0);
}

main();
