/**
 * Codex rollout JSONL → envelope body + canonical-oriented summary.
 *
 * Noise rule: promote user prompts, agent replies, tool name + short args,
 * paths / commands. Full function_call_output / reasoning stay in raw only.
 */

const SHORT_ARG_MAX = 200;
const TEXT_PREVIEW_MAX = 2_000;

export interface CodexToolSummary {
  name: string;
  callId?: string;
  argsPreview?: string;
  command?: string;
  paths?: string[];
}

export interface CodexTurnSummary {
  role: "user" | "assistant" | "tool" | "system";
  textPreview?: string;
  tools?: CodexToolSummary[];
  timestamp?: string;
}

export interface CodexSessionSummary {
  sessionId: string;
  title?: string;
  cwd?: string;
  source?: string;
  model?: string;
  modelProvider?: string;
  gitBranch?: string;
  cliVersion?: string;
  occurredAt?: string;
  turnCount: number;
  userTurnCount: number;
  assistantTurnCount: number;
  toolCallCount: number;
  pathsTouched: string[];
  commands: string[];
  turns: CodexTurnSummary[];
  /** Metadata joined from state_5.sqlite when available. */
  threadMeta?: Record<string, unknown>;
}

export interface CodexEnvelopeBody {
  kind: "codex_session";
  sessionId: string;
  localPath: string;
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

function textFromContentBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (
      (block.type === "input_text" ||
        block.type === "output_text" ||
        block.type === "text") &&
      typeof block.text === "string"
    ) {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function isEnvironmentContext(text: string): boolean {
  return text.trimStart().startsWith("<environment_context>");
}

function collectPaths(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    if (
      (value.includes("\\") || value.includes("/")) &&
      value.length < 500 &&
      !value.includes("\n") &&
      /[A-Za-z]:[\\/]|^\.{0,2}[\\/]|~[\\/]|\\\\\?\\/.test(value)
    ) {
      into.add(value.replace(/^\\\\\?\\/, ""));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, into, depth + 1);
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
        key === "cwd")
    ) {
      if (v.length < 500 && !v.includes("\n")) {
        into.add(v.replace(/^\\\\\?\\/, ""));
      }
    }
    collectPaths(v, into, depth + 1);
  }
}

function parseArgs(argumentsJson: unknown): unknown {
  if (typeof argumentsJson !== "string") return argumentsJson;
  try {
    return JSON.parse(argumentsJson) as unknown;
  } catch {
    return argumentsJson;
  }
}

export function mapCodexSession(opts: {
  sessionId: string;
  localPath: string;
  events: unknown[];
  threadMeta?: Record<string, unknown>;
}): { body: CodexEnvelopeBody; summary: CodexSessionSummary } {
  const pathsTouched = new Set<string>();
  const commands: string[] = [];
  const turns: CodexTurnSummary[] = [];
  let cwd: string | undefined;
  let source: string | undefined;
  let model: string | undefined;
  let modelProvider: string | undefined;
  let gitBranch: string | undefined;
  let cliVersion: string | undefined;
  let title: string | undefined;
  let occurredAt: string | undefined;
  let sessionId = opts.sessionId;
  let userTurnCount = 0;
  let assistantTurnCount = 0;
  let toolCallCount = 0;

  if (opts.threadMeta) {
    if (typeof opts.threadMeta.title === "string") title = opts.threadMeta.title;
    if (typeof opts.threadMeta.cwd === "string") {
      cwd = String(opts.threadMeta.cwd).replace(/^\\\\\?\\/, "");
    }
    if (typeof opts.threadMeta.source === "string") source = opts.threadMeta.source;
    if (typeof opts.threadMeta.model === "string") model = opts.threadMeta.model;
    if (typeof opts.threadMeta.modelProvider === "string") {
      modelProvider = opts.threadMeta.modelProvider;
    }
    if (typeof opts.threadMeta.gitBranch === "string") {
      gitBranch = opts.threadMeta.gitBranch;
    }
    if (typeof opts.threadMeta.cliVersion === "string") {
      cliVersion = opts.threadMeta.cliVersion;
    }
  }

  for (const raw of opts.events) {
    if (!isRecord(raw)) continue;
    const lineType = typeof raw.type === "string" ? raw.type : "";
    const ts = typeof raw.timestamp === "string" ? raw.timestamp : undefined;
    if (ts && !occurredAt) occurredAt = ts;
    const payload = isRecord(raw.payload) ? raw.payload : undefined;

    if (lineType === "session_meta" && payload) {
      if (typeof payload.session_id === "string") sessionId = payload.session_id;
      else if (typeof payload.id === "string") sessionId = payload.id;
      if (typeof payload.cwd === "string") {
        cwd = payload.cwd.replace(/^\\\\\?\\/, "");
      }
      if (typeof payload.source === "string") source = payload.source;
      if (typeof payload.model_provider === "string") {
        modelProvider = payload.model_provider;
      }
      if (typeof payload.cli_version === "string") cliVersion = payload.cli_version;
      if (typeof payload.timestamp === "string" && !occurredAt) {
        occurredAt = payload.timestamp;
      }
      continue;
    }

    if (lineType === "turn_context" && payload) {
      if (typeof payload.cwd === "string") {
        cwd = payload.cwd.replace(/^\\\\\?\\/, "");
      }
      if (Array.isArray(payload.workspace_roots)) {
        for (const r of payload.workspace_roots) {
          if (typeof r === "string") pathsTouched.add(r.replace(/^\\\\\?\\/, ""));
        }
      }
      continue;
    }

    if (lineType === "event_msg" && payload) {
      const et = typeof payload.type === "string" ? payload.type : "";
      if (et === "user_message" && typeof payload.message === "string") {
        const text = payload.message;
        if (isEnvironmentContext(text)) continue;
        userTurnCount += 1;
        if (!title) title = truncate(text.replace(/\s+/g, " ").trim(), 120);
        turns.push({
          role: "user",
          textPreview: truncate(text, TEXT_PREVIEW_MAX),
          timestamp: ts,
        });
      } else if (et === "agent_message" && typeof payload.message === "string") {
        assistantTurnCount += 1;
        turns.push({
          role: "assistant",
          textPreview: truncate(payload.message, TEXT_PREVIEW_MAX),
          timestamp: ts,
        });
      }
      // token_count, task_started, etc. → raw only
      continue;
    }

    if (lineType === "response_item" && payload) {
      const pt = typeof payload.type === "string" ? payload.type : "";

      if (pt === "message") {
        const role = typeof payload.role === "string" ? payload.role : "";
        const text = textFromContentBlocks(payload.content);
        if (!text.trim()) continue;
        if (role === "developer" || role === "system") {
          // Keep in raw; skip noisy system/developer from summary
          continue;
        }
        if (role === "user") {
          if (isEnvironmentContext(text)) continue;
          // Prefer event_msg.user_message when both exist — still count lightly
          if (!turns.some((t) => t.role === "user" && t.textPreview === truncate(text, TEXT_PREVIEW_MAX))) {
            userTurnCount += 1;
            turns.push({
              role: "user",
              textPreview: truncate(text, TEXT_PREVIEW_MAX),
              timestamp: ts,
            });
          }
        } else if (role === "assistant") {
          // Prefer event_msg.agent_message; only add if no recent identical
          if (!turns.some((t) => t.role === "assistant" && t.textPreview === truncate(text, TEXT_PREVIEW_MAX))) {
            assistantTurnCount += 1;
            turns.push({
              role: "assistant",
              textPreview: truncate(text, TEXT_PREVIEW_MAX),
              timestamp: ts,
            });
          }
        }
        continue;
      }

      if (pt === "function_call" || pt === "custom_tool_call" || pt === "web_search_call") {
        const name =
          typeof payload.name === "string"
            ? payload.name
            : pt === "web_search_call"
              ? "web_search"
              : "tool";
        const args = parseArgs(payload.arguments);
        const paths = new Set<string>();
        collectPaths(args, paths);
        for (const p of paths) pathsTouched.add(p);

        let command: string | undefined;
        if (isRecord(args) && typeof args.command === "string") {
          command = truncate(args.command, SHORT_ARG_MAX);
          commands.push(command);
        }
        if (isRecord(args) && typeof args.workdir === "string") {
          pathsTouched.add(args.workdir.replace(/^\\\\\?\\/, ""));
        }

        let argsPreview: string | undefined;
        try {
          argsPreview = truncate(JSON.stringify(args ?? {}), SHORT_ARG_MAX);
        } catch {
          argsPreview = undefined;
        }

        toolCallCount += 1;
        turns.push({
          role: "tool",
          tools: [
            {
              name,
              callId:
                typeof payload.call_id === "string"
                  ? payload.call_id
                  : typeof payload.id === "string"
                    ? payload.id
                    : undefined,
              argsPreview,
              command,
              paths: paths.size ? [...paths] : undefined,
            },
          ],
          timestamp: ts,
        });
        continue;
      }

      // function_call_output, reasoning, custom_tool_call_output → raw only
    }
  }

  const summary: CodexSessionSummary = {
    sessionId,
    title,
    cwd,
    source,
    model,
    modelProvider,
    gitBranch,
    cliVersion,
    occurredAt,
    turnCount: turns.length,
    userTurnCount,
    assistantTurnCount,
    toolCallCount,
    pathsTouched: [...pathsTouched].slice(0, 200),
    commands: commands.slice(0, 100),
    turns,
    threadMeta: opts.threadMeta,
  };

  const body: CodexEnvelopeBody = {
    kind: "codex_session",
    sessionId,
    localPath: opts.localPath,
    events: opts.events,
    lineCount: opts.events.length,
  };

  return { body, summary };
}
