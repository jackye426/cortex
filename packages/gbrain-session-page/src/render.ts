import { createHash } from "node:crypto";
import { redactText, type RedactionHit } from "@cortex/redaction";
import { dumpFrontmatter } from "./yaml.js";
import {
  SESSION_SCHEMA,
  type SessionDetail,
  type SessionPageRender,
} from "./types.js";

export function sessionPageRelativePath(detail: SessionDetail): string {
  const harness = sanitizePathPart(detail.sourceId || "unknown");
  const id = sanitizePathPart(detail.sourceSessionId || detail.id || "session");
  return `conversations/${harness}/${id}.md`;
}

export function sanitizePathPart(s: string): string {
  return s.replace(/[<>:"|?*\\]/g, "_").replace(/\.\./g, "_");
}

function mergeHits(into: RedactionHit[], hits: RedactionHit[]): void {
  for (const h of hits) {
    const existing = into.find((x) => x.patternId === h.patternId);
    if (existing) existing.count += h.count;
    else into.push({ ...h });
  }
}

export function hashSessionContent(detail: Pick<
  SessionDetail,
  "id" | "sourceId" | "sourceSessionId" | "messages" | "toolCalls"
>): string {
  const payload = JSON.stringify({
    id: detail.id,
    sourceId: detail.sourceId,
    sourceSessionId: detail.sourceSessionId,
    messages: detail.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    })),
    toolCalls: detail.toolCalls.map((t) => ({
      id: t.id,
      toolName: t.toolName,
      argsSummary: t.argsSummary,
      status: t.status,
    })),
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function fence(body: string): string {
  const t = body ?? "";
  if (t.includes("```")) {
    return `~~~~text\n${t}\n~~~~`;
  }
  return `\`\`\`text\n${t}\n\`\`\``;
}

/**
 * Render a SessionDetail as a GBrain L1 session-v1 markdown page.
 * Redacts message content and tool args via @cortex/redaction.
 */
export function renderSessionPage(detail: SessionDetail): string {
  return renderSessionPageFull(detail).markdown;
}

export function renderSessionPageFull(detail: SessionDetail): SessionPageRender {
  const hits: RedactionHit[] = [];
  const messages = detail.messages.map((m) => {
    const raw = m.content ?? "";
    const r = redactText(raw);
    mergeHits(hits, r.hits);
    return { ...m, content: r.text };
  });
  const toolCalls = detail.toolCalls.map((t) => {
    const raw = t.argsSummary ?? "";
    const r = redactText(raw);
    mergeHits(hits, r.hits);
    return { ...t, argsSummary: r.text };
  });

  const redacted: SessionDetail = {
    ...detail,
    messages,
    toolCalls,
    distillate: null,
  };
  const contentHash = hashSessionContent(redacted);

  const fm = dumpFrontmatter({
    cortex_schema: SESSION_SCHEMA,
    harness: detail.sourceId,
    source_session_id: detail.sourceSessionId,
    id: detail.id,
    title: detail.title,
    workspace: detail.workspace,
    started_at: detail.startedAt,
    ended_at: detail.endedAt,
    content_hash: contentHash,
    metadata: detail.metadata ?? {},
  });

  const turnBlocks = messages.map((m) => {
    const body = m.content ?? "";
    return `### Turn \`${m.id}\` (\`${m.role}\`)\n\n${fence(body)}`;
  });

  const toolBlocks = toolCalls.map((t) => {
    const status = t.status ?? "unknown";
    const args = t.argsSummary ?? "";
    return `### Tool \`${t.id}\` (\`${t.toolName}\`) — ${status}\n\n${fence(args)}`;
  });

  const parts = [
    fm,
    "",
    "## Turns",
    "",
    turnBlocks.length ? turnBlocks.join("\n\n") : "_No turns._",
    "",
    "## Tools",
    "",
    toolBlocks.length ? toolBlocks.join("\n\n") : "_No tools._",
    "",
  ];

  const markdown = parts.join("\n");
  return {
    markdown,
    redactionHitCount: hits.reduce((s, h) => s + h.count, 0),
    relativePath: sessionPageRelativePath(detail),
    contentHash,
  };
}
