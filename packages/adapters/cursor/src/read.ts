import type { DatabaseSync } from "node:sqlite";
import { getKvText, parseJsonValue } from "./sqlite.js";

export interface ComposerHeaderRow {
  composerId: string;
  workspaceId?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  isArchived?: boolean;
  isSubagent?: boolean;
  /** Parsed header JSON from composerHeaders.value or ItemTable blob. */
  header: Record<string, unknown>;
}

export interface ConversationHeader {
  bubbleId: string;
  type?: number;
  createdAt?: string;
  grouping?: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * List composers from dedicated `composerHeaders` table when present,
 * else fall back to ItemTable `composer.composerHeaders` JSON.
 */
export function listComposerHeaders(db: DatabaseSync): ComposerHeaderRow[] {
  const fromTable = listFromComposerHeadersTable(db);
  if (fromTable.length > 0) return fromTable;
  return listFromItemTableBlob(db);
}

function listFromComposerHeadersTable(db: DatabaseSync): ComposerHeaderRow[] {
  try {
    const rows = db
      .prepare(
        `SELECT composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, value
         FROM composerHeaders
         ORDER BY COALESCE(lastUpdatedAt, createdAt, 0) DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    const out: ComposerHeaderRow[] = [];
    for (const row of rows) {
      const composerId = typeof row.composerId === "string" ? row.composerId : null;
      if (!composerId) continue;
      const valueText =
        typeof row.value === "string"
          ? row.value
          : row.value != null
            ? Buffer.from(row.value as Uint8Array).toString("utf8")
            : "{}";
      let header: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(valueText) as unknown;
        if (isRecord(parsed)) header = parsed;
      } catch {
        header = {};
      }
      out.push({
        composerId,
        workspaceId:
          typeof row.workspaceId === "string"
            ? row.workspaceId
            : typeof header.workspaceIdentifier === "object" &&
                header.workspaceIdentifier !== null &&
                typeof (header.workspaceIdentifier as { id?: unknown }).id === "string"
              ? (header.workspaceIdentifier as { id: string }).id
              : undefined,
        createdAt: typeof row.createdAt === "number" ? row.createdAt : undefined,
        lastUpdatedAt:
          typeof row.lastUpdatedAt === "number" ? row.lastUpdatedAt : undefined,
        isArchived: row.isArchived === 1 || row.isArchived === true,
        isSubagent: row.isSubagent === 1 || row.isSubagent === true,
        header,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function listFromItemTableBlob(db: DatabaseSync): ComposerHeaderRow[] {
  const text = getKvText(db, "ItemTable", "composer.composerHeaders");
  const parsed = parseJsonValue(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.allComposers)) return [];

  const out: ComposerHeaderRow[] = [];
  for (const item of parsed.allComposers) {
    if (!isRecord(item)) continue;
    const composerId = typeof item.composerId === "string" ? item.composerId : null;
    if (!composerId) continue;
    const ws =
      isRecord(item.workspaceIdentifier) && typeof item.workspaceIdentifier.id === "string"
        ? item.workspaceIdentifier.id
        : undefined;
    out.push({
      composerId,
      workspaceId: ws,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : undefined,
      lastUpdatedAt:
        typeof item.lastUpdatedAt === "number" ? item.lastUpdatedAt : undefined,
      isArchived: item.isArchived === true,
      isSubagent: item.isBestOfNSubcomposer === true,
      header: item,
    });
  }
  out.sort(
    (a, b) => (b.lastUpdatedAt ?? b.createdAt ?? 0) - (a.lastUpdatedAt ?? a.createdAt ?? 0),
  );
  return out;
}

export function loadComposerData(
  db: DatabaseSync,
  composerId: string,
): Record<string, unknown> | null {
  const text = getKvText(db, "cursorDiskKV", `composerData:${composerId}`);
  const parsed = parseJsonValue(text);
  return isRecord(parsed) ? parsed : null;
}

export function conversationHeadersFromComposerData(
  composerData: Record<string, unknown> | null,
): ConversationHeader[] {
  if (!composerData) return [];
  const raw = composerData.fullConversationHeadersOnly;
  if (!Array.isArray(raw)) return [];
  const out: ConversationHeader[] = [];
  for (const h of raw) {
    if (!isRecord(h)) continue;
    const bubbleId = typeof h.bubbleId === "string" ? h.bubbleId : null;
    if (!bubbleId) continue;
    out.push({
      bubbleId,
      type: typeof h.type === "number" ? h.type : undefined,
      createdAt: typeof h.createdAt === "string" ? h.createdAt : undefined,
      grouping: isRecord(h.grouping) ? h.grouping : undefined,
    });
  }
  return out;
}

export function loadBubble(
  db: DatabaseSync,
  composerId: string,
  bubbleId: string,
): Record<string, unknown> | null {
  const text = getKvText(db, "cursorDiskKV", `bubbleId:${composerId}:${bubbleId}`);
  const parsed = parseJsonValue(text);
  return isRecord(parsed) ? parsed : null;
}

/**
 * Load all bubbles for a composer (keyed by bubbleId).
 * Missing keys are skipped.
 */
export function loadBubblesForComposer(
  db: DatabaseSync,
  composerId: string,
  headers: ConversationHeader[],
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const h of headers) {
    const bubble = loadBubble(db, composerId, h.bubbleId);
    if (bubble) out[h.bubbleId] = bubble;
  }
  return out;
}

/** Fields that look like encryption / opaque session blobs — never promote. */
const SECRETISH_KEYS = new Set([
  "speculativeSummarizationEncryptionKey",
  "blobEncryptionKey",
  "conversationState",
  "toolCallBinary",
]);

/**
 * Deep-clone JSON-ish values while dropping secretish keys and `secret://` paths.
 * Used for raw vault payload so we do not store Cursor crypto material.
 */
export function scrubSecrets(value: unknown, depth = 0): unknown {
  if (depth > 12 || value == null) return value;
  if (typeof value === "string") {
    if (value.startsWith("secret://")) return "[REDACTED:cursor_secret_ref]";
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrubSecrets(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRETISH_KEYS.has(k)) continue;
    if (k.startsWith("secret://")) continue;
    out[k] = scrubSecrets(v, depth + 1);
  }
  return out;
}
