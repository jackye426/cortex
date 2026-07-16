/**
 * Claude Code JSONL → envelope body + canonical-oriented summary.
 *
 * Noise rule: promote user prompts, assistant text, tool name + short args,
 * paths touched. Full tool outputs / thinking / attachments stay in raw only.
 */

const SHORT_ARG_MAX = 200;
const TEXT_PREVIEW_MAX = 2_000;

export interface ClaudeToolSummary {
  name: string;
  id?: string;
  /** Truncated JSON args for canonical; full args remain in raw events. */
  argsPreview?: string;
  paths?: string[];
}

export interface ClaudeTurnSummary {
  role: "user" | "assistant" | "tool";
  /** Short text for canonical (prompts / replies). Empty for tool-only. */
  textPreview?: string;
  tools?: ClaudeToolSummary[];
  /** Present when the line carried toolUseResult (full result stays in raw). */
  toolUseResultMeta?: {
    keys: string[];
    type?: string;
  };
  uuid?: string;
  timestamp?: string;
}

export interface ClaudeSessionSummary {
  sessionId: string;
  projectDir?: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  version?: string;
  occurredAt?: string;
  turnCount: number;
  userTurnCount: number;
  assistantTurnCount: number;
  toolCallCount: number;
  pathsTouched: string[];
  turns: ClaudeTurnSummary[];
}

export interface ClaudeEnvelopeBody {
  kind: "claude_code_session";
  sessionId: string;
  /** Absolute local path (never uploaded as secret; redacted by ingest). */
  localPath: string;
  projectKey: string;
  /** Full parsed JSONL events — vault payload. */
  events: unknown[];
  lineCount: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${s.slice(0, end)}…`;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function collectPathsFromValue(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    // Heuristic path-like strings
    if (
      (value.includes("\\") || value.includes("/")) &&
      value.length < 500 &&
      !value.includes("\n") &&
      /[A-Za-z]:[\\/]|^\.{0,2}[\\/]|~[\\/]/.test(value)
    ) {
      into.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathsFromValue(item, into, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase();
    if (
      typeof v === "string" &&
      (key.includes("path") ||
        key === "file" ||
        key === "filename" ||
        key === "workdir" ||
        key === "cwd" ||
        key === "target")
    ) {
      if (v.length < 500 && !v.includes("\n")) into.add(v);
    }
    collectPathsFromValue(v, into, depth + 1);
  }
}

function summarizeToolUse(block: Record<string, unknown>): ClaudeToolSummary {
  const name = typeof block.name === "string" ? block.name : "unknown";
  const id = typeof block.id === "string" ? block.id : undefined;
  const input = block.input;
  const paths = new Set<string>();
  collectPathsFromValue(input, paths);
  let argsPreview: string | undefined;
  try {
    argsPreview = truncate(JSON.stringify(input ?? {}), SHORT_ARG_MAX);
  } catch {
    argsPreview = undefined;
  }
  return {
    name,
    id,
    argsPreview,
    paths: paths.size ? [...paths] : undefined,
  };
}

function isToolResultOnlyUser(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return false;
  return content.every(
    (b) => isRecord(b) && (b.type === "tool_result" || b.type === "tool_use_result"),
  );
}

/**
 * Build vault body + canonical summary from raw JSONL event objects.
 */
export function mapClaudeSession(opts: {
  sessionId: string;
  localPath: string;
  projectKey: string;
  events: unknown[];
}): { body: ClaudeEnvelopeBody; summary: ClaudeSessionSummary } {
  const pathsTouched = new Set<string>();
  const turns: ClaudeTurnSummary[] = [];
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let model: string | undefined;
  let version: string | undefined;
  let occurredAt: string | undefined;
  let userTurnCount = 0;
  let assistantTurnCount = 0;
  let toolCallCount = 0;

  for (const raw of opts.events) {
    if (!isRecord(raw)) continue;
    const type = typeof raw.type === "string" ? raw.type : "";
    const ts = typeof raw.timestamp === "string" ? raw.timestamp : undefined;
    if (ts && !occurredAt) occurredAt = ts;
    if (typeof raw.cwd === "string" && raw.cwd) cwd = raw.cwd;
    if (typeof raw.gitBranch === "string" && raw.gitBranch) gitBranch = raw.gitBranch;
    if (typeof raw.version === "string" && raw.version) version = raw.version;

    // Skip pure noise line types from summary (kept in raw events)
    if (
      type === "queue-operation" ||
      type === "attachment" ||
      type === "progress" ||
      type === "system" ||
      type === "file-history-snapshot" ||
      type === "last-prompt"
    ) {
      continue;
    }

    if (type === "user") {
      const message = isRecord(raw.message) ? raw.message : undefined;
      const content = message?.content;
      const hasToolUseResult = "toolUseResult" in raw && raw.toolUseResult != null;

      // Tool-result-only user turns: record meta only, not full content
      if (hasToolUseResult || isToolResultOnlyUser(content)) {
        const tur = raw.toolUseResult;
        const meta: ClaudeTurnSummary["toolUseResultMeta"] = {
          keys: isRecord(tur) ? Object.keys(tur).slice(0, 20) : [],
          type: isRecord(tur) && typeof tur.type === "string" ? tur.type : undefined,
        };
        // Paths from tool result meta (e.g. file path) — not full file body
        if (isRecord(tur)) {
          if (typeof tur.file === "string") pathsTouched.add(tur.file);
          if (isRecord(tur.file) && typeof tur.file.filePath === "string") {
            pathsTouched.add(tur.file.filePath);
          }
          collectPathsFromValue(
            {
              file: tur.file,
              filePath: tur.filePath,
              path: tur.path,
            },
            pathsTouched,
          );
        }
        turns.push({
          role: "tool",
          toolUseResultMeta: meta,
          uuid: typeof raw.uuid === "string" ? raw.uuid : undefined,
          timestamp: ts,
        });
        continue;
      }

      const text = extractTextFromContent(content);
      if (!text.trim()) continue;
      userTurnCount += 1;
      turns.push({
        role: "user",
        textPreview: truncate(text, TEXT_PREVIEW_MAX),
        uuid: typeof raw.uuid === "string" ? raw.uuid : undefined,
        timestamp: ts,
      });
      continue;
    }

    if (type === "assistant") {
      const message = isRecord(raw.message) ? raw.message : undefined;
      if (message && typeof message.model === "string") model = message.model;
      const content = message?.content;
      const tools: ClaudeToolSummary[] = [];
      let text = "";

      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === "text" && typeof block.text === "string") {
            text += (text ? "\n" : "") + block.text;
          } else if (block.type === "tool_use") {
            const tool = summarizeToolUse(block);
            tools.push(tool);
            toolCallCount += 1;
            for (const p of tool.paths ?? []) pathsTouched.add(p);
          }
          // thinking / redacted_thinking → raw only
        }
      } else if (typeof content === "string") {
        text = content;
      }

      if (!text.trim() && tools.length === 0) continue;
      assistantTurnCount += 1;
      turns.push({
        role: "assistant",
        textPreview: text.trim() ? truncate(text, TEXT_PREVIEW_MAX) : undefined,
        tools: tools.length ? tools : undefined,
        uuid: typeof raw.uuid === "string" ? raw.uuid : undefined,
        timestamp: ts,
      });
    }
  }

  const summary: ClaudeSessionSummary = {
    sessionId: opts.sessionId,
    projectDir: opts.projectKey,
    cwd,
    gitBranch,
    model,
    version,
    occurredAt,
    turnCount: turns.length,
    userTurnCount,
    assistantTurnCount,
    toolCallCount,
    pathsTouched: [...pathsTouched].slice(0, 200),
    turns,
  };

  const body: ClaudeEnvelopeBody = {
    kind: "claude_code_session",
    sessionId: opts.sessionId,
    localPath: opts.localPath,
    projectKey: opts.projectKey,
    events: opts.events,
    lineCount: opts.events.length,
  };

  return { body, summary };
}
