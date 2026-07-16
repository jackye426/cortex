/**
 * Load conversations.json (or sharded conversations-NNN.json) from a ZIP,
 * extracted folder, or direct JSON path.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import type { ChatgptExportConversation, ChatgptExportFile } from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asConversations(parsed: unknown): ChatgptExportConversation[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord) as ChatgptExportConversation[];
  }
  // Rare: wrapped object
  if (isRecord(parsed) && Array.isArray(parsed.conversations)) {
    return parsed.conversations.filter(isRecord) as ChatgptExportConversation[];
  }
  throw new Error("conversations.json must be a JSON array of conversations");
}

/** Match `conversations.json` or sharded `conversations-000.json` etc. */
function isConversationsJsonName(name: string): boolean {
  const base = basename(name).toLowerCase();
  return (
    base === "conversations.json" || /^conversations-\d+\.json$/i.test(base)
  );
}

function conversationShardSortKey(path: string): string {
  const base = basename(path).toLowerCase();
  if (base === "conversations.json") return "conversations.json";
  const m = /^conversations-(\d+)\.json$/i.exec(base);
  if (m?.[1]) return `conversations-${m[1].padStart(6, "0")}.json`;
  return base;
}

function findConversationsJsonInZip(entries: Record<string, Uint8Array>): {
  paths: string[];
  bytesList: Uint8Array[];
} {
  const keys = Object.keys(entries)
    .filter((k) => !k.endsWith("/") && isConversationsJsonName(k))
    .sort((a, b) =>
      conversationShardSortKey(a).localeCompare(conversationShardSortKey(b)),
    );
  if (keys.length === 0) {
    throw new Error(
      "ZIP does not contain conversations.json or conversations-NNN.json (is this an official ChatGPT export?)",
    );
  }
  const bytesList = keys.map((k) => {
    const bytes = entries[k];
    if (!bytes) throw new Error(`ZIP entry missing: ${k}`);
    return bytes;
  });
  return { paths: keys, bytesList };
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** Strip UTF-8 BOM (common on Windows-saved JSON). */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseJsonText(text: string): unknown {
  return JSON.parse(stripBom(text)) as unknown;
}

function mergeConversationFiles(
  parts: { path: string; parsed: unknown }[],
): ChatgptExportConversation[] {
  const out: ChatgptExportConversation[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const convs = asConversations(part.parsed);
    for (const c of convs) {
      const id =
        typeof c.conversation_id === "string"
          ? c.conversation_id
          : typeof c.id === "string"
            ? c.id
            : null;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(c);
    }
  }
  return out;
}

function listConversationsJsonInDir(dir: string): string[] {
  const names = readdirSync(dir);
  const direct = names
    .filter((n) => isConversationsJsonName(n))
    .map((n) => join(dir, n));
  const nestedDir = join(dir, "ChatGPT");
  const nested = existsSync(nestedDir)
    ? readdirSync(nestedDir)
        .filter((n) => isConversationsJsonName(n))
        .map((n) => join(nestedDir, n))
    : [];
  return [...direct, ...nested].sort((a, b) =>
    conversationShardSortKey(a).localeCompare(conversationShardSortKey(b)),
  );
}

export interface LoadResult {
  /** Absolute path or zip:entry descriptor for provenance. */
  sourcePath: string;
  conversations: ChatgptExportFile;
}

/**
 * Load export from:
 * - path to a `.zip` (official OpenAI download)
 * - path to an extracted folder containing `conversations.json` / shards
 * - path directly to `conversations.json` (or a single shard)
 */
export async function loadChatgptExport(inputPath: string): Promise<LoadResult> {
  const abs = resolve(inputPath);
  if (!existsSync(abs)) {
    throw new Error(`Path not found: ${abs}`);
  }

  const st = statSync(abs);

  if (st.isFile() && abs.toLowerCase().endsWith(".zip")) {
    const zipBytes = new Uint8Array(readFileSync(abs));
    let unzipped: Record<string, Uint8Array>;
    try {
      // Skip chat.html / attachment blobs — only need conversation JSON.
      unzipped = unzipSync(zipBytes, {
        filter: (file) => isConversationsJsonName(file.name),
      });
    } catch (err) {
      throw new Error(
        `Failed to unzip ${abs}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const { paths, bytesList } = findConversationsJsonInZip(unzipped);
    const parts = paths.map((path, i) => ({
      path,
      parsed: parseJsonText(decodeUtf8(bytesList[i]!)),
    }));
    return {
      sourcePath: `${abs}#${paths.join(",")}`,
      conversations: mergeConversationFiles(parts),
    };
  }

  if (
    st.isFile() &&
    (basename(abs).toLowerCase() === "conversations.json" ||
      /^conversations-\d+\.json$/i.test(basename(abs)))
  ) {
    const parsed = parseJsonText(readFileSync(abs, "utf8"));
    return { sourcePath: abs, conversations: asConversations(parsed) };
  }

  if (st.isDirectory()) {
    const jsonPaths = listConversationsJsonInDir(abs);
    if (jsonPaths.length === 0) {
      throw new Error(
        `No conversations.json / conversations-NNN.json under ${abs} (expected root or ChatGPT/ subfolder)`,
      );
    }
    const parts = jsonPaths.map((jsonPath) => ({
      path: jsonPath,
      parsed: parseJsonText(readFileSync(jsonPath, "utf8")),
    }));
    return {
      sourcePath:
        jsonPaths.length === 1 ? jsonPaths[0]! : `${abs}#${jsonPaths.length}-shards`,
      conversations: mergeConversationFiles(parts),
    };
  }

  throw new Error(
    `Unsupported path (need .zip, folder, or conversations.json): ${abs}`,
  );
}
