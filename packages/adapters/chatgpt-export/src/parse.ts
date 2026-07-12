/**
 * Walk ChatGPT export mapping DAG from current_node → root via parent links,
 * then reverse to chronological order (active branch only).
 */

import type {
  ChatgptExportConversation,
  ChatgptExportMappingNode,
  ChatgptExportMessage,
} from "./types.js";

export interface ChatgptLinearMessage {
  id: string;
  role: string;
  text: string;
  createTime?: number;
  modelSlug?: string;
  contentType?: string;
  /** True when this is the synthetic root / empty system placeholder. */
  skip?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function partToText(part: unknown): string {
  if (typeof part === "string") return part;
  if (!isRecord(part)) return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (part.content_type === "image_asset_pointer") {
    const asset = typeof part.asset_pointer === "string" ? part.asset_pointer : "image";
    return `[image:${asset}]`;
  }
  return "";
}

export function extractMessageText(message: ChatgptExportMessage): string {
  const content = message.content;
  if (!content) return "";
  if (typeof content.text === "string" && content.text) return content.text;
  if (Array.isArray(content.parts)) {
    return content.parts.map(partToText).filter(Boolean).join("\n");
  }
  if (typeof content.result === "string") return content.result;
  return "";
}

function shouldSkipMessage(message: ChatgptExportMessage, text: string): boolean {
  const role = message.author?.role ?? "";
  if (role === "system") {
    const meta = message.metadata ?? {};
    if (meta.is_user_system_message === true) return false;
    return text.trim().length === 0;
  }
  // Empty placeholder nodes
  if (!text.trim() && role !== "tool") return true;
  return false;
}

/**
 * Reconstruct the user-visible thread for one conversation.
 * Prefer `current_node`; fall back to a leaf with children=[] if missing.
 */
export function linearizeConversation(
  conversation: ChatgptExportConversation,
): ChatgptLinearMessage[] {
  const mapping = conversation.mapping ?? {};
  let nodeId = conversation.current_node ?? null;

  if (!nodeId) {
    // Fallback: pick any leaf (no children)
    for (const [id, node] of Object.entries(mapping)) {
      if (!node.children || node.children.length === 0) {
        nodeId = id;
        break;
      }
    }
  }

  const reverse: ChatgptLinearMessage[] = [];
  const seen = new Set<string>();
  let guard = 0;

  while (nodeId && !seen.has(nodeId) && guard < 50_000) {
    guard += 1;
    seen.add(nodeId);
    const node: ChatgptExportMappingNode | undefined = mapping[nodeId];
    if (!node) break;

    const message = node.message;
    if (message) {
      const text = extractMessageText(message);
      const role = message.author?.role ?? "unknown";
      const modelSlug =
        typeof message.metadata?.model_slug === "string"
          ? message.metadata.model_slug
          : undefined;
      reverse.push({
        id: message.id ?? node.id ?? nodeId,
        role,
        text,
        createTime:
          typeof message.create_time === "number" ? message.create_time : undefined,
        modelSlug,
        contentType: message.content?.content_type,
        skip: shouldSkipMessage(message, text),
      });
    }

    nodeId = node.parent ?? null;
  }

  return reverse.reverse().filter((m) => !m.skip);
}

export function conversationId(conversation: ChatgptExportConversation): string {
  if (typeof conversation.conversation_id === "string" && conversation.conversation_id) {
    return conversation.conversation_id;
  }
  if (typeof conversation.id === "string" && conversation.id) {
    return conversation.id;
  }
  // Stable-ish fallback from title + create_time
  const title = conversation.title ?? "untitled";
  const t = conversation.create_time ?? 0;
  return `chatgpt:${title}:${t}`;
}

export function unixToIso(unix: number | null | undefined): string | undefined {
  if (unix == null || !Number.isFinite(unix)) return undefined;
  // Export times are unix seconds (float)
  const ms = unix > 1e12 ? unix : unix * 1000;
  return new Date(ms).toISOString();
}
