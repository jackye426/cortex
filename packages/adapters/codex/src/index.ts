import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import { mapCodexSession } from "./map.js";
import {
  defaultCodexHome,
  defaultCodexSessionsRoot,
  defaultCodexStateDb,
  listCodexRolloutFiles,
  sessionIdFromRolloutPath,
  toPosixRel,
} from "./paths.js";
import { readJsonlEvents } from "./read.js";
import {
  loadThreadMetadata,
  normalizePathKey,
  type CodexThreadMeta,
} from "./threads.js";

export type { CodexEnvelopeBody, CodexSessionSummary, CodexTurnSummary } from "./map.js";
export type { CodexThreadMeta } from "./threads.js";
export {
  defaultCodexHome,
  defaultCodexSessionsRoot,
  defaultCodexStateDb,
  listCodexRolloutFiles,
  sessionIdFromRolloutPath,
  toPosixRel,
  codexAuthPath,
} from "./paths.js";
export { mapCodexSession } from "./map.js";
export { readJsonlEvents } from "./read.js";
export { loadThreadMetadata } from "./threads.js";

export interface CodexAdapterOptions {
  /** Override `~\.codex`. */
  codexHome?: string;
  /** Override sessions directory. */
  sessionsRoot?: string;
  /** Override state DB path; set null to skip SQLite join. */
  stateDbPath?: string | null;
  pageSize?: number;
  limit?: number;
  collectorName?: string;
}

/**
 * Codex backfill adapter.
 * Reads `~\.codex\sessions\**\rollout-*.jsonl` and optionally joins
 * `state_5.sqlite` thread metadata. Never reads `auth.json`.
 */
export class CodexAdapter implements SourceAdapter {
  readonly source = "codex" as const;

  private readonly codexHome: string;
  private readonly sessionsRoot: string;
  private readonly stateDbPath: string | null;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private fileCache: string[] | null = null;
  private metaCache: Map<string, CodexThreadMeta> | null = null;

  constructor(options: CodexAdapterOptions = {}) {
    this.codexHome = options.codexHome ?? defaultCodexHome();
    this.sessionsRoot =
      options.sessionsRoot ?? defaultCodexSessionsRoot(this.codexHome);
    this.stateDbPath =
      options.stateDbPath === null
        ? null
        : (options.stateDbPath ?? defaultCodexStateDb(this.codexHome));
    this.pageSize = options.pageSize ?? 10;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-codex";
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    const files = this.listFiles();
    const meta = this.threadMeta();
    const threadIds = new Set(
      [...meta.values()].map((t) => t.id).filter(Boolean),
    );
    return {
      ok: true,
      detail: `${files.length} rollout(s) under ${this.sessionsRoot}; ${threadIds.size} thread(s) in sqlite`,
    };
  }

  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    const files = this.listFiles();
    const start = this.resolveStartIndex(files, checkpoint?.cursor);
    const slice = files.slice(start, start + this.pageSize);
    const items: RawEnvelope[] = [];

    for (const filePath of slice) {
      items.push(await this.envelopeForFile(filePath));
    }

    const nextIndex = start + slice.length;
    const hasMore = nextIndex < files.length;
    return {
      items,
      nextCursor: hasMore ? String(nextIndex) : null,
      hasMore,
    };
  }

  async backfillAll(): Promise<RawEnvelope[]> {
    const files = this.listFiles();
    const out: RawEnvelope[] = [];
    for (const filePath of files) {
      out.push(await this.envelopeForFile(filePath));
    }
    return out;
  }

  private listFiles(): string[] {
    if (!this.fileCache) {
      let files = listCodexRolloutFiles(this.sessionsRoot);
      if (this.limit != null && this.limit >= 0) {
        files = files.slice(0, this.limit);
      }
      this.fileCache = files;
    }
    return this.fileCache;
  }

  private threadMeta(): Map<string, CodexThreadMeta> {
    if (!this.metaCache) {
      this.metaCache =
        this.stateDbPath == null
          ? new Map()
          : loadThreadMetadata(this.stateDbPath);
    }
    return this.metaCache;
  }

  private resolveStartIndex(files: string[], cursor?: string): number {
    if (!cursor) return 0;
    const asNum = Number(cursor);
    if (Number.isFinite(asNum) && asNum >= 0) {
      return Math.min(Math.floor(asNum), files.length);
    }
    const idx = files.findIndex((f) => toPosixRel(this.sessionsRoot, f) === cursor);
    return idx >= 0 ? idx + 1 : 0;
  }

  private resolveMeta(sessionId: string, filePath: string): CodexThreadMeta | undefined {
    const meta = this.threadMeta();
    return (
      meta.get(sessionId) ??
      meta.get(normalizePathKey(filePath)) ??
      undefined
    );
  }

  private async envelopeForFile(filePath: string): Promise<RawEnvelope> {
    const sessionId = sessionIdFromRolloutPath(filePath);
    const events = await readJsonlEvents(filePath);
    const thread = this.resolveMeta(sessionId, filePath);
    const threadMeta = thread
      ? {
          id: thread.id,
          title: thread.title,
          cwd: thread.cwd,
          source: thread.source,
          model: thread.model,
          modelProvider: thread.modelProvider,
          gitBranch: thread.gitBranch,
          gitSha: thread.gitSha,
          firstUserMessage: thread.firstUserMessage,
          cliVersion: thread.cliVersion,
          preview: thread.preview,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        }
      : undefined;

    const { body, summary } = mapCodexSession({
      sessionId,
      localPath: filePath,
      events,
      threadMeta,
    });

    return {
      source: "codex",
      sourceRecordId: summary.sessionId,
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: summary.cwd,
        extra: {
          kind: "codex_session_summary",
          relativePath: toPosixRel(this.sessionsRoot, filePath),
          summary,
        },
      },
    };
  }
}

export function createCodexAdapter(options?: CodexAdapterOptions): CodexAdapter {
  return new CodexAdapter(options);
}
