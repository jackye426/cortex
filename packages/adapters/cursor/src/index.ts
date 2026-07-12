import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import { mapCursorSession } from "./map.js";
import {
  defaultCursorProjectsRoot,
  defaultCursorStateDb,
  defaultWorkspaceStorageRoot,
  pathExists,
} from "./paths.js";
import {
  conversationHeadersFromComposerData,
  listComposerHeaders,
  loadBubblesForComposer,
  loadComposerData,
  scrubSecrets,
  type ComposerHeaderRow,
} from "./read.js";
import { openCursorDb, type CursorDbHandle } from "./sqlite.js";
import {
  indexAgentTranscripts,
  readAgentTranscriptEvents,
} from "./transcripts.js";
import { loadWorkspaceMap, type WorkspaceInfo } from "./workspaces.js";

export type {
  CursorEnvelopeBody,
  CursorSessionSummary,
  CursorToolSummary,
  CursorTurnSummary,
} from "./map.js";
export type { ComposerHeaderRow, ConversationHeader } from "./read.js";
export type { WorkspaceInfo } from "./workspaces.js";
export {
  defaultCursorProjectsRoot,
  defaultCursorStateDb,
  defaultWorkspaceStorageRoot,
  listAgentTranscriptFiles,
  composerIdFromTranscriptPath,
  toPosixRel,
} from "./paths.js";
export { mapCursorSession } from "./map.js";
export { openCursorDb } from "./sqlite.js";
export { loadWorkspaceMap, decodeFolderUri } from "./workspaces.js";
export {
  listComposerHeaders,
  loadComposerData,
  loadBubble,
  loadBubblesForComposer,
  scrubSecrets,
} from "./read.js";
export { indexAgentTranscripts, readAgentTranscriptEvents } from "./transcripts.js";

export interface CursorAdapterOptions {
  /** Override path to state.vscdb. */
  stateDbPath?: string;
  /** Override workspaceStorage root. */
  workspaceStorageRoot?: string;
  /** Override `~\.cursor\projects` for agent-transcripts. */
  projectsRoot?: string;
  /** Merge agent-transcript JSONL when composerId matches (default true). */
  includeAgentTranscripts?: boolean;
  /** Skip subagent composers (default false — include with flag). */
  skipSubagents?: boolean;
  /** Force copy-then-read of the multi-GB DB (default false; RO open preferred). */
  copyBeforeRead?: boolean;
  pageSize?: number;
  /** Hard cap on composers discovered. */
  limit?: number;
  collectorName?: string;
}

/**
 * Cursor backfill adapter.
 * Read-only SQLite against `%APPDATA%\Cursor\User\globalStorage\state.vscdb`.
 * Imports composerHeaders + composerData + bubbleId keys; maps workspaces via
 * workspaceStorage; optionally merges agent-transcripts.
 * Never writes Cursor DBs; never reads secret:// ItemTable keys.
 */
export class CursorAdapter implements SourceAdapter {
  readonly source = "cursor" as const;

  private readonly stateDbPath: string;
  private readonly workspaceStorageRoot: string;
  private readonly projectsRoot: string;
  private readonly includeAgentTranscripts: boolean;
  private readonly skipSubagents: boolean;
  private readonly copyBeforeRead: boolean;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;

  private headerCache: ComposerHeaderRow[] | null = null;
  private workspaceCache: Map<string, WorkspaceInfo> | null = null;
  private transcriptIndex: Map<string, string> | null = null;

  constructor(options: CursorAdapterOptions = {}) {
    this.stateDbPath = options.stateDbPath ?? defaultCursorStateDb();
    this.workspaceStorageRoot =
      options.workspaceStorageRoot ?? defaultWorkspaceStorageRoot();
    this.projectsRoot = options.projectsRoot ?? defaultCursorProjectsRoot();
    this.includeAgentTranscripts = options.includeAgentTranscripts !== false;
    this.skipSubagents = options.skipSubagents === true;
    this.copyBeforeRead = options.copyBeforeRead === true;
    this.pageSize = options.pageSize ?? 10;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-cursor";
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!pathExists(this.stateDbPath)) {
      return { ok: false, detail: `state.vscdb missing: ${this.stateDbPath}` };
    }
    const headers = this.listHeaders();
    const transcripts = this.includeAgentTranscripts
      ? this.getTranscriptIndex().size
      : 0;
    const workspaces = this.getWorkspaces().size;
    return {
      ok: true,
      detail: `${headers.length} composer(s); ${workspaces} workspace(s); ${transcripts} agent-transcript(s); db=${this.stateDbPath}`,
    };
  }

  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    const headers = this.listHeaders();
    const start = this.resolveStartIndex(headers, checkpoint?.cursor);
    const slice = headers.slice(start, start + this.pageSize);
    const items: RawEnvelope[] = [];

    const handle = this.openDb();
    try {
      for (const header of slice) {
        items.push(await this.envelopeForComposer(handle, header));
      }
    } finally {
      handle.dispose();
    }

    const nextIndex = start + slice.length;
    const hasMore = nextIndex < headers.length;
    return {
      items,
      nextCursor: hasMore ? String(nextIndex) : null,
      hasMore,
    };
  }

  /** One-shot: all composers (respecting limit) as envelopes. */
  async backfillAll(): Promise<RawEnvelope[]> {
    const headers = this.listHeaders();
    const out: RawEnvelope[] = [];
    const handle = this.openDb();
    try {
      for (const header of headers) {
        out.push(await this.envelopeForComposer(handle, header));
      }
    } finally {
      handle.dispose();
    }
    return out;
  }

  private openDb(): CursorDbHandle {
    return openCursorDb(this.stateDbPath, { copyBeforeRead: this.copyBeforeRead });
  }

  private listHeaders(): ComposerHeaderRow[] {
    if (!this.headerCache) {
      const handle = this.openDb();
      try {
        let headers = listComposerHeaders(handle.db);
        if (this.skipSubagents) {
          headers = headers.filter((h) => !h.isSubagent);
        }
        if (this.limit != null && this.limit >= 0) {
          headers = headers.slice(0, this.limit);
        }
        this.headerCache = headers;
      } finally {
        handle.dispose();
      }
    }
    return this.headerCache;
  }

  private getWorkspaces(): Map<string, WorkspaceInfo> {
    if (this.workspaceCache == null) {
      this.workspaceCache = loadWorkspaceMap(this.workspaceStorageRoot);
    }
    return this.workspaceCache;
  }

  private getTranscriptIndex(): Map<string, string> {
    if (!this.transcriptIndex) {
      this.transcriptIndex = this.includeAgentTranscripts
        ? indexAgentTranscripts(this.projectsRoot)
        : new Map();
    }
    return this.transcriptIndex;
  }

  private resolveStartIndex(headers: ComposerHeaderRow[], cursor?: string): number {
    if (!cursor) return 0;
    const asNum = Number(cursor);
    if (Number.isFinite(asNum) && asNum >= 0) {
      return Math.min(Math.floor(asNum), headers.length);
    }
    const idx = headers.findIndex((h) => h.composerId === cursor);
    return idx >= 0 ? idx + 1 : 0;
  }

  private async envelopeForComposer(
    handle: CursorDbHandle,
    headerRow: ComposerHeaderRow,
  ): Promise<RawEnvelope> {
    const composerDataRaw = loadComposerData(handle.db, headerRow.composerId);
    const conversationHeaders = conversationHeadersFromComposerData(composerDataRaw);
    const bubblesRaw = loadBubblesForComposer(
      handle.db,
      headerRow.composerId,
      conversationHeaders,
    );

    const workspace = headerRow.workspaceId
      ? this.getWorkspaces().get(headerRow.workspaceId)
      : undefined;

    let agentTranscript: {
      path: string;
      events: unknown[];
      lineCount: number;
    } | undefined;
    if (this.includeAgentTranscripts) {
      const tPath = this.getTranscriptIndex().get(headerRow.composerId.toLowerCase());
      if (tPath) {
        const events = await readAgentTranscriptEvents(tPath);
        agentTranscript = { path: tPath, events, lineCount: events.length };
      }
    }

    // Scrub secrets before anything leaves the adapter
    const composerData = scrubSecrets(composerDataRaw) as Record<string, unknown> | null;
    const bubbles = scrubSecrets(bubblesRaw) as Record<string, Record<string, unknown>>;
    const header = scrubSecrets(headerRow.header) as Record<string, unknown>;

    const { body, summary } = mapCursorSession({
      headerRow: { ...headerRow, header },
      composerData,
      conversationHeaders,
      bubbles,
      workspace,
      agentTranscript,
    });

    return {
      source: "cursor",
      sourceRecordId: summary.sessionId,
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: summary.cwd ?? summary.workspaceId,
        extra: {
          kind: "cursor_session_summary",
          summary,
        },
      },
    };
  }
}

export function createCursorAdapter(options?: CursorAdapterOptions): CursorAdapter {
  return new CursorAdapter(options);
}
