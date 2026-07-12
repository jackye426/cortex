import { hostname } from "node:os";
import { dirname, basename } from "node:path";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import { mapClaudeSession } from "./map.js";
import {
  defaultClaudeProjectsRoot,
  listClaudeSessionFiles,
  sessionIdFromFile,
  toPosixRel,
} from "./paths.js";
import { readJsonlEvents } from "./read.js";

export type { ClaudeEnvelopeBody, ClaudeSessionSummary, ClaudeTurnSummary } from "./map.js";
export {
  defaultClaudeProjectsRoot,
  listClaudeSessionFiles,
  sessionIdFromFile,
  toPosixRel,
} from "./paths.js";
export { mapClaudeSession } from "./map.js";
export { readJsonlEvents } from "./read.js";

export interface ClaudeCodeAdapterOptions {
  /** Override `~\.claude\projects`. */
  projectsRoot?: string;
  /** Max sessions per fetchPage (default 25). */
  pageSize?: number;
  /** Hard cap on total sessions discovered (useful for dry-run). */
  limit?: number;
  collectorName?: string;
}

/**
 * Claude Code backfill adapter.
 * Reads `~\.claude\projects\**\*.jsonl` and emits one RawEnvelope per session.
 */
export class ClaudeCodeAdapter implements SourceAdapter {
  readonly source = "claude-code" as const;

  private readonly projectsRoot: string;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private fileCache: string[] | null = null;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.projectsRoot = options.projectsRoot ?? defaultClaudeProjectsRoot();
    this.pageSize = options.pageSize ?? 25;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-claude-code";
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    const files = this.listFiles();
    return {
      ok: true,
      detail: `${files.length} session file(s) under ${this.projectsRoot}`,
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

  /** One-shot helper: load all sessions (respecting limit) as envelopes. */
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
      let files = listClaudeSessionFiles(this.projectsRoot);
      if (this.limit != null && this.limit >= 0) {
        files = files.slice(0, this.limit);
      }
      this.fileCache = files;
    }
    return this.fileCache;
  }

  private resolveStartIndex(files: string[], cursor?: string): number {
    if (!cursor) return 0;
    const asNum = Number(cursor);
    if (Number.isFinite(asNum) && asNum >= 0) {
      return Math.min(Math.floor(asNum), files.length);
    }
    // Cursor may be a relative path from a prior run
    const idx = files.findIndex((f) => toPosixRel(this.projectsRoot, f) === cursor);
    return idx >= 0 ? idx + 1 : 0;
  }

  private async envelopeForFile(filePath: string): Promise<RawEnvelope> {
    const sessionId = sessionIdFromFile(filePath);
    const events = await readJsonlEvents(filePath);
    const projectKey = basename(dirname(filePath));
    const { body, summary } = mapClaudeSession({
      sessionId,
      localPath: filePath,
      projectKey,
      events,
    });

    const firstTs =
      summary.occurredAt ??
      (events.find(
        (e) =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as { timestamp?: unknown }).timestamp === "string",
      ) as { timestamp?: string } | undefined)?.timestamp;

    return {
      source: "claude-code",
      sourceRecordId: sessionId,
      occurredAt: firstTs,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: summary.cwd ?? projectKey,
        extra: {
          kind: "claude_code_session_summary",
          relativePath: toPosixRel(this.projectsRoot, filePath),
          summary,
        },
      },
    };
  }
}

export function createClaudeCodeAdapter(
  options?: ClaudeCodeAdapterOptions,
): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter(options);
}
