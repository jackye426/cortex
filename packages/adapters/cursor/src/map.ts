/**
 * Cursor composer / bubbles → envelope body + canonical-oriented summary.
 *
 * Noise rule: promote prompts, final replies, tool name + short args, paths.
 * Full bubbles stay in raw only (after secret scrub).
 */

import type { ComposerHeaderRow, ConversationHeader } from "./read.js";
import type { WorkspaceInfo } from "./workspaces.js";

const SHORT_ARG_MAX = 200;
const TEXT_PREVIEW_MAX = 2_000;

export interface CursorToolSummary {
  name: string;
  callId?: string;
  argsPreview?: string;
  command?: string;
  paths?: string[];
  status?: string;
}

export interface CursorTurnSummary {
  role: "user" | "assistant" | "tool" | "system";
  bubbleId?: string;
  textPreview?: string;
  tools?: CursorToolSummary[];
  timestamp?: string;
}

export interface CursorSessionSummary {
  sessionId: string;
  title?: string;
  cwd?: string;
  workspaceId?: string;
  unifiedMode?: string;
  model?: string;
  isSubagent?: boolean;
  isArchived?: boolean;
  occurredAt?: string;
  turnCount: number;
  userTurnCount: number;
  assistantTurnCount: number;
  toolCallCount: number;
  bubbleCount: number;
  pathsTouched: string[];
  commands: string[];
  turns: CursorTurnSummary[];
  hasAgentTranscript?: boolean;
}

export interface CursorEnvelopeBody {
  kind: "cursor_session";
  sessionId: string;
  header: Record<string, unknown>;
  composerData: Record<string, unknown> | null;
  conversationHeaders: ConversationHeader[];
  /** Full bubble JSON (secret-scrubbed). */
  bubbles: Record<string, unknown>;
  workspace?: WorkspaceInfo;
  /** Optional merged agent-transcript JSONL events. */
  agentTranscript?: {
    path: string;
    events: unknown[];
    lineCount: number;
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function msToIso(ms?: number): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  try {
    return new Date(ms).toISOString();
  } catch {
    return undefined;
  }
}

function collectPaths(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    if (
      (value.includes("\\") || value.includes("/")) &&
      value.length < 500 &&
      !value.includes("\n") &&
      /[A-Za-z]:[\\/]|^\.{0,2}[\\/]|~[\\/]|file:\/\//.test(value)
    ) {
      into.add(value.replace(/^file:\/\/\//, "").replace(/^\\\\\?\\/, ""));
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
        key === "targetfile" ||
        key === "workdir" ||
        key === "cwd")
    ) {
      if (v.length < 500 && !v.includes("\n")) {
        into.add(v.replace(/^file:\/\/\//, "").replace(/^\\\\\?\\/, ""));
      }
    }
    collectPaths(v, into, depth + 1);
  }
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}

function workspacePathFromHeader(
  header: Record<string, unknown>,
  workspace?: WorkspaceInfo,
): string | undefined {
  if (workspace?.folderPath) return workspace.folderPath;
  const wi = header.workspaceIdentifier;
  if (isRecord(wi) && isRecord(wi.uri) && typeof wi.uri.fsPath === "string") {
    return wi.uri.fsPath;
  }
  return undefined;
}

function modelFromComposer(composerData: Record<string, unknown> | null): string | undefined {
  if (!composerData) return undefined;
  const mc = composerData.modelConfig;
  if (isRecord(mc) && typeof mc.modelName === "string") return mc.modelName;
  return undefined;
}

/**
 * Map one Cursor composer session into raw body + noise-filtered summary.
 */
export function mapCursorSession(opts: {
  headerRow: ComposerHeaderRow;
  composerData: Record<string, unknown> | null;
  conversationHeaders: ConversationHeader[];
  bubbles: Record<string, Record<string, unknown>>;
  workspace?: WorkspaceInfo;
  agentTranscript?: CursorEnvelopeBody["agentTranscript"];
}): { body: CursorEnvelopeBody; summary: CursorSessionSummary } {
  const { headerRow, composerData, conversationHeaders, bubbles, workspace } = opts;
  const sessionId = headerRow.composerId;
  const header = headerRow.header;

  const pathsTouched = new Set<string>();
  const commands: string[] = [];
  const turns: CursorTurnSummary[] = [];
  let userTurnCount = 0;
  let assistantTurnCount = 0;
  let toolCallCount = 0;

  const cwd = workspacePathFromHeader(header, workspace);
  if (cwd) pathsTouched.add(cwd);

  // Paths from composer-level file state
  if (composerData) {
    if (isRecord(composerData.originalFileStates)) {
      for (const uri of Object.keys(composerData.originalFileStates)) {
        collectPaths(uri, pathsTouched);
      }
    }
    if (Array.isArray(composerData.newlyCreatedFiles)) {
      for (const f of composerData.newlyCreatedFiles) {
        if (isRecord(f) && typeof f.uri === "string") collectPaths(f.uri, pathsTouched);
        else collectPaths(f, pathsTouched);
      }
    }
  }

  for (const ch of conversationHeaders) {
    const bubble = bubbles[ch.bubbleId];
    if (!bubble) continue;

    const ts =
      (typeof bubble.createdAt === "string" ? bubble.createdAt : undefined) ??
      ch.createdAt;
    const text = typeof bubble.text === "string" ? bubble.text : "";
    const toolFormer = isRecord(bubble.toolFormerData) ? bubble.toolFormerData : null;
    const bubbleType = typeof bubble.type === "number" ? bubble.type : ch.type;

    // Tool call bubble (capabilityType 15 + toolFormerData)
    if (toolFormer && typeof toolFormer.name === "string") {
      const name = toolFormer.name;
      const args = parseMaybeJson(toolFormer.rawArgs ?? toolFormer.params);
      const paths = new Set<string>();
      collectPaths(args, paths);
      for (const p of paths) pathsTouched.add(p);

      let command: string | undefined;
      if (isRecord(args) && typeof args.command === "string") {
        command = truncate(args.command, SHORT_ARG_MAX);
        commands.push(command);
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
        bubbleId: ch.bubbleId,
        tools: [
          {
            name,
            callId:
              typeof toolFormer.toolCallId === "string"
                ? toolFormer.toolCallId.split("\n")[0]
                : undefined,
            argsPreview,
            command,
            paths: paths.size ? [...paths] : undefined,
            status: typeof toolFormer.status === "string" ? toolFormer.status : undefined,
          },
        ],
        timestamp: ts,
      });
      continue;
    }

    // Thinking / non-renderable / empty assistant scaffolding → skip from canonical
    const grouping = ch.grouping;
    const isThinking =
      bubble.capabilityType === 30 ||
      (isRecord(grouping) && grouping.hasThinking === true);
    if (isThinking && !text.trim()) continue;

    if (bubbleType === 1 && text.trim()) {
      userTurnCount += 1;
      turns.push({
        role: "user",
        bubbleId: ch.bubbleId,
        textPreview: truncate(text, TEXT_PREVIEW_MAX),
        timestamp: ts,
      });
      continue;
    }

    if (bubbleType === 2 && text.trim()) {
      assistantTurnCount += 1;
      turns.push({
        role: "assistant",
        bubbleId: ch.bubbleId,
        textPreview: truncate(text, TEXT_PREVIEW_MAX),
        timestamp: ts,
      });
      continue;
    }

    // Other bubbles (empty assistant shells, code-only) stay raw-only
  }

  const title =
    (typeof header.name === "string" && header.name) ||
    (typeof composerData?.name === "string" ? composerData.name : undefined) ||
    (turns.find((t) => t.role === "user")?.textPreview
      ? truncate(turns.find((t) => t.role === "user")!.textPreview!.replace(/\s+/g, " "), 120)
      : undefined);

  const occurredAt =
    (typeof conversationHeaders[0]?.createdAt === "string"
      ? conversationHeaders[0].createdAt
      : undefined) ??
    msToIso(headerRow.createdAt) ??
    msToIso(typeof composerData?.createdAt === "number" ? composerData.createdAt : undefined);

  const summary: CursorSessionSummary = {
    sessionId,
    title,
    cwd,
    workspaceId: headerRow.workspaceId ?? workspace?.workspaceId,
    unifiedMode:
      (typeof header.unifiedMode === "string" ? header.unifiedMode : undefined) ??
      (typeof composerData?.unifiedMode === "string" ? composerData.unifiedMode : undefined),
    model: modelFromComposer(composerData),
    isSubagent: headerRow.isSubagent,
    isArchived: headerRow.isArchived,
    occurredAt,
    turnCount: turns.length,
    userTurnCount,
    assistantTurnCount,
    toolCallCount,
    bubbleCount: Object.keys(bubbles).length,
    pathsTouched: [...pathsTouched].slice(0, 200),
    commands: commands.slice(0, 100),
    turns,
    hasAgentTranscript: Boolean(opts.agentTranscript),
  };

  const body: CursorEnvelopeBody = {
    kind: "cursor_session",
    sessionId,
    header,
    composerData,
    conversationHeaders,
    bubbles,
    workspace,
    agentTranscript: opts.agentTranscript,
  };

  return { body, summary };
}
