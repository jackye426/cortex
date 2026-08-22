import { parseFrontmatter } from "./yaml.js";
import { SESSION_SCHEMA, type SessionDetail } from "./types.js";

function unfence(raw: string): string {
  const t = raw.trim();
  const m =
    t.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/) ??
    t.match(/^~~~~[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n~~~~$/);
  return m ? m[1]! : t;
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function splitHeadingBlocks(
  body: string,
  headingRe: RegExp,
): Array<{ heading: string; content: string }> {
  const lines = body.split(/\r?\n/);
  const out: Array<{ heading: string; content: string }> = [];
  let current: { heading: string; content: string[] } | null = null;
  for (const line of lines) {
    if (headingRe.test(line)) {
      if (current) {
        out.push({ heading: current.heading, content: current.content.join("\n") });
      }
      current = { heading: line, content: [] };
      continue;
    }
    if (current) current.content.push(line);
  }
  if (current) {
    out.push({ heading: current.heading, content: current.content.join("\n") });
  }
  return out;
}

function section(body: string, title: string): string | null {
  const re = new RegExp(`^## ${title}\\s*$`, "im");
  const m = re.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

/**
 * Inverse of renderSessionPage. Reconstructs SessionDetail for extractSessionOps.
 * A page with turns but no ## Tools section yields toolCalls: [] (text-only ingest).
 */
export function parseSessionPage(markdown: string): SessionDetail {
  const { fields, body } = parseFrontmatter(markdown);
  const schema = fields.cortex_schema;
  if (schema && schema !== SESSION_SCHEMA) {
    throw new Error(`unsupported cortex_schema: ${schema}`);
  }

  const turnsSection = section(body, "Turns") ?? "";
  const toolsSection = section(body, "Tools");

  const messages: SessionDetail["messages"] = [];
  const turnRe = /^### Turn `([^`]+)` \(`([^`]+)`\)\s*$/;
  for (const block of splitHeadingBlocks(turnsSection, /^### Turn /)) {
    const hm = block.heading.match(turnRe);
    if (!hm) continue;
    messages.push({
      id: hm[1]!,
      role: hm[2]!,
      content: unfence(block.content),
    });
  }

  const toolCalls: SessionDetail["toolCalls"] = [];
  if (toolsSection != null && toolsSection.length > 0 && !/^_No tools\._$/m.test(toolsSection)) {
    const toolRe = /^### Tool `([^`]+)` \(`([^`]+)`\)(?: — (.+))?\s*$/;
    for (const block of splitHeadingBlocks(toolsSection, /^### Tool /)) {
      const hm = block.heading.match(toolRe);
      if (!hm) continue;
      toolCalls.push({
        id: hm[1]!,
        toolName: hm[2]!,
        status: hm[3]?.trim() || null,
        argsSummary: unfence(block.content),
      });
    }
  }

  return {
    id: fields.id ?? fields.source_session_id ?? "unknown",
    sourceId: fields.harness ?? "unknown",
    sourceSessionId: fields.source_session_id ?? fields.id ?? "unknown",
    title: fields.title ?? null,
    workspace: fields.workspace ?? null,
    startedAt: fields.started_at ?? null,
    endedAt: fields.ended_at ?? null,
    metadata: parseJsonObject(fields.metadata),
    messages,
    toolCalls,
    distillate: null,
  };
}

/** True when the page has a ## Tools heading (even if empty). */
export function sessionPageHasToolsSection(markdown: string): boolean {
  return /^## Tools\s*$/m.test(markdown);
}
