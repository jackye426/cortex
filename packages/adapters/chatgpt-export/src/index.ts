/**
 * ChatGPT official export adapter.
 * Parses ZIP / folder / conversations.json; walks mapping DAG via current_node.
 */

import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import { loadChatgptExport } from "./load.js";
import { mapChatgptConversation } from "./map.js";
import type { ChatgptExportConversation } from "./types.js";

export type {
  ChatgptEnvelopeBody,
  ChatgptConversationSummary,
  ChatgptTurnSummary,
} from "./map.js";
export type { ChatgptLinearMessage } from "./parse.js";
export type {
  ChatgptExportConversation,
  ChatgptExportFile,
  ChatgptExportMappingNode,
  ChatgptExportMessage,
} from "./types.js";
export { loadChatgptExport } from "./load.js";
export { mapChatgptConversation } from "./map.js";
export {
  conversationId,
  extractMessageText,
  linearizeConversation,
  unixToIso,
} from "./parse.js";

export interface ChatgptExportAdapterOptions {
  /**
   * Path to official export ZIP, extracted folder, or conversations.json.
   * Required for backfill; fetchPage without path returns empty.
   */
  exportPath?: string;
  pageSize?: number;
  limit?: number;
  collectorName?: string;
  /** When false, omit raw mapping from envelope body (smaller payloads). Default true. */
  includeMapping?: boolean;
}

export class ChatgptExportAdapter implements SourceAdapter {
  readonly source = "chatgpt-export" as const;

  private readonly exportPath: string | undefined;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private readonly includeMapping: boolean;
  private cache: {
    sourcePath: string;
    conversations: ChatgptExportConversation[];
  } | null = null;

  constructor(options: ChatgptExportAdapterOptions = {}) {
    this.exportPath = options.exportPath;
    this.pageSize = options.pageSize ?? 25;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-chatgpt-export";
    this.includeMapping = options.includeMapping !== false;
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.exportPath) {
      return { ok: false, detail: "exportPath not set" };
    }
    try {
      const { sourcePath, conversations } = await this.ensureLoaded();
      return {
        ok: true,
        detail: `${conversations.length} conversation(s) from ${sourcePath}`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    if (!this.exportPath) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    const list = await this.listConversations();
    const start = this.resolveStartIndex(list.length, checkpoint?.cursor);
    const slice = list.slice(start, start + this.pageSize);
    const items = slice.map((c) => this.envelopeForConversation(c));
    const nextIndex = start + slice.length;
    const hasMore = nextIndex < list.length;
    return {
      items,
      nextCursor: hasMore ? String(nextIndex) : null,
      hasMore,
    };
  }

  async backfillAll(): Promise<RawEnvelope[]> {
    if (!this.exportPath) {
      throw new Error(
        "ChatgptExportAdapter requires exportPath (ZIP, folder, or conversations.json)",
      );
    }
    const list = await this.listConversations();
    return list.map((c) => this.envelopeForConversation(c));
  }

  private async ensureLoaded(): Promise<{
    sourcePath: string;
    conversations: ChatgptExportConversation[];
  }> {
    if (this.cache) return this.cache;
    if (!this.exportPath) {
      throw new Error("exportPath not set");
    }
    const loaded = await loadChatgptExport(this.exportPath);
    this.cache = {
      sourcePath: loaded.sourcePath,
      conversations: loaded.conversations,
    };
    return this.cache;
  }

  private async listConversations(): Promise<ChatgptExportConversation[]> {
    let list = (await this.ensureLoaded()).conversations;
    if (this.limit != null && this.limit >= 0) {
      list = list.slice(0, this.limit);
    }
    return list;
  }

  private resolveStartIndex(total: number, cursor?: string): number {
    if (!cursor) return 0;
    const asNum = Number(cursor);
    if (Number.isFinite(asNum) && asNum >= 0) {
      return Math.min(Math.floor(asNum), total);
    }
    return 0;
  }

  private envelopeForConversation(
    conversation: ChatgptExportConversation,
  ): RawEnvelope {
    const { body, summary } = mapChatgptConversation(conversation);
    if (!this.includeMapping) {
      delete body.mapping;
    }

    return {
      source: "chatgpt-export",
      sourceRecordId: summary.conversationId,
      occurredAt: summary.occurredAt ?? summary.updatedAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        extra: {
          kind: "chatgpt_conversation_summary",
          exportPath: this.cache?.sourcePath ?? this.exportPath,
          summary,
        },
      },
    };
  }
}

export function createChatgptExportAdapter(
  options?: ChatgptExportAdapterOptions,
): ChatgptExportAdapter {
  return new ChatgptExportAdapter(options);
}
