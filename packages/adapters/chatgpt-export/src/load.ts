/**
 * Load conversations.json from a ZIP, extracted folder, or direct JSON path.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
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

function findConversationsJsonInZip(entries: Record<string, Uint8Array>): {
  path: string;
  bytes: Uint8Array;
} {
  const keys = Object.keys(entries);
  const exact = keys.find(
    (k) =>
      !k.endsWith("/") &&
      (k === "conversations.json" ||
        k.endsWith("/conversations.json") ||
        basename(k) === "conversations.json"),
  );
  if (!exact) {
    throw new Error(
      "ZIP does not contain conversations.json (is this an official ChatGPT export?)",
    );
  }
  const bytes = entries[exact];
  if (!bytes) throw new Error(`ZIP entry missing: ${exact}`);
  return { path: exact, bytes };
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

export interface LoadResult {
  /** Absolute path or zip:entry descriptor for provenance. */
  sourcePath: string;
  conversations: ChatgptExportFile;
}

/**
 * Load export from:
 * - path to a `.zip` (official OpenAI download)
 * - path to an extracted folder containing `conversations.json`
 * - path directly to `conversations.json`
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
      unzipped = unzipSync(zipBytes);
    } catch (err) {
      throw new Error(
        `Failed to unzip ${abs}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const { path: entryPath, bytes } = findConversationsJsonInZip(unzipped);
    const parsed = parseJsonText(decodeUtf8(bytes));
    return {
      sourcePath: `${abs}#${entryPath}`,
      conversations: asConversations(parsed),
    };
  }

  if (st.isFile() && basename(abs).toLowerCase() === "conversations.json") {
    const parsed = parseJsonText(readFileSync(abs, "utf8"));
    return { sourcePath: abs, conversations: asConversations(parsed) };
  }

  if (st.isDirectory()) {
    const candidates = [
      join(abs, "conversations.json"),
      join(abs, "ChatGPT", "conversations.json"),
    ];
    const jsonPath = candidates.find((p) => existsSync(p));
    if (!jsonPath) {
      throw new Error(
        `No conversations.json under ${abs} (expected root or ChatGPT/ subfolder)`,
      );
    }
    const parsed = parseJsonText(readFileSync(jsonPath, "utf8"));
    return { sourcePath: jsonPath, conversations: asConversations(parsed) };
  }

  throw new Error(
    `Unsupported path (need .zip, folder, or conversations.json): ${abs}`,
  );
}
