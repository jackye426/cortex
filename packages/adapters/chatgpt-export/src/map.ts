/**
 * ChatGPT export conversation → envelope body + summary for provenance.
 * Noise rule: promote user/assistant text previews; keep full mapping in raw body.
 */

import {
  conversationId,
  linearizeConversation,
  unixToIso,
  type ChatgptLinearMessage,
} from "./parse.js";
import type { ChatgptExportConversation } from "./types.js";

const TEXT_PREVIEW_MAX = 2_000;

export interface ChatgptTurnSummary {
  role: "user" | "assistant" | "tool" | "system" | "unknown";
  textPreview?: string;
  messageId?: string;
  timestamp?: string;
  modelSlug?: string;
}

export interface ChatgptConversationSummary {
  conversationId: string;
  title?: string;
  model?: string;
  occurredAt?: string;
  updatedAt?: string;
  turnCount: number;
  userTurnCount: number;
  assistantTurnCount: number;
  turns: ChatgptTurnSummary[];
}

export interface ChatgptEnvelopeBody {
  kind: "chatgpt_conversation";
  conversationId: string;
  title?: string;
  /** Linearized active branch (from current_node walk). */
  messages: ChatgptLinearMessage[];
  /** Original create/update unix times. */
  createTime?: number;
  updateTime?: number;
  /** Raw mapping retained for vault; may be large. */
  mapping?: Record<string, unknown>;
  currentNode?: string | null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  // Avoid splitting a UTF-16 surrogate pair (orphans break PostgREST/Postgres jsonb).
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${s.slice(0, end)}…`;
}

function toRole(role: string): ChatgptTurnSummary["role"] {
  if (role === "user" || role === "assistant" || role === "tool" || role === "system") {
    return role;
  }
  return "unknown";
}

export function mapChatgptConversation(conversation: ChatgptExportConversation): {
  body: ChatgptEnvelopeBody;
  summary: ChatgptConversationSummary;
} {
  const id = conversationId(conversation);
  const messages = linearizeConversation(conversation);
  const title =
    typeof conversation.title === "string" && conversation.title.trim()
      ? conversation.title.trim()
      : undefined;

  const turns: ChatgptTurnSummary[] = [];
  let userTurnCount = 0;
  let assistantTurnCount = 0;
  let model: string | undefined =
    typeof conversation.default_model_slug === "string"
      ? conversation.default_model_slug
      : undefined;

  for (const m of messages) {
    const role = toRole(m.role);
    if (role === "user") userTurnCount += 1;
    if (role === "assistant") assistantTurnCount += 1;
    if (!model && m.modelSlug) model = m.modelSlug;
    turns.push({
      role,
      textPreview: m.text ? truncate(m.text, TEXT_PREVIEW_MAX) : undefined,
      messageId: m.id,
      timestamp: unixToIso(m.createTime),
      modelSlug: m.modelSlug,
    });
  }

  const occurredAt =
    unixToIso(conversation.create_time) ??
    (messages[0]?.createTime != null ? unixToIso(messages[0].createTime) : undefined);
  const updatedAt =
    unixToIso(conversation.update_time) ??
    (messages.at(-1)?.createTime != null
      ? unixToIso(messages.at(-1)!.createTime)
      : undefined);

  const summary: ChatgptConversationSummary = {
    conversationId: id,
    title,
    model,
    occurredAt,
    updatedAt,
    turnCount: turns.length,
    userTurnCount,
    assistantTurnCount,
    turns,
  };

  const body: ChatgptEnvelopeBody = {
    kind: "chatgpt_conversation",
    conversationId: id,
    title,
    messages,
    createTime:
      typeof conversation.create_time === "number" ? conversation.create_time : undefined,
    updateTime:
      typeof conversation.update_time === "number" ? conversation.update_time : undefined,
    mapping: conversation.mapping as Record<string, unknown> | undefined,
    currentNode: conversation.current_node ?? null,
  };

  return { body, summary };
}
