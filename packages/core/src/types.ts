/**
 * Stable source identifiers used across adapters, ingest, and canonical tables.
 */
export type SourceId =
  | "cursor"
  | "claude-code"
  | "codex"
  | "chatgpt"
  | "chatgpt-export"
  | "gmail"
  | "calendar"
  | "drive"
  | "github"
  | "calibre"
  | "browser"
  | "spotify"
  | "youtube"
  | "manual";

/**
 * Provenance metadata attached to raw envelopes and artifacts.
 */
export interface Provenance {
  /** Adapter or collector that produced this envelope. */
  collector: string;
  /** Host machine hostname when available. */
  host?: string;
  /** Optional workspace / project path or id. */
  workspace?: string;
  /** Free-form adapter-specific metadata. */
  extra?: Record<string, unknown>;
}

/**
 * Content-addressable raw payload handed to the ingest API.
 * Full tool outputs / dumps stay in vault; canonicalizers may subset later.
 */
export interface RawEnvelope {
  /** Cortex source id (e.g. `claude-code`, `cursor`). */
  source: SourceId;
  /** Stable id within the source (session id, message id, etc.). */
  sourceRecordId: string;
  /** ISO-8601 timestamp of the original event when known. */
  occurredAt?: string;
  /** MIME type of `body` when serialized (default application/json). */
  mimeType?: string;
  /** Raw body — object or string; hashed before vault write. */
  body: unknown;
  /** Optional content hash (sha256 hex); computed by ingest if omitted. */
  contentHash?: string;
  provenance: Provenance;
}

/**
 * Sync checkpoint for incremental backfill / watchers.
 */
export interface SyncCheckpoint {
  source: SourceId;
  /** Optional account / device scope within a source. */
  accountKey: string;
  /** Opaque cursor (file offset, syncToken, since ISO, ETag, etc.). */
  cursor: string;
  /** ISO-8601 of last successful sync. */
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Shared shape for HTTP APIs that support `since` and/or ETag conditional requests.
 * Encode as `SyncCheckpoint.cursor` (JSON) and/or mirror fields on `SyncCheckpoint.metadata`.
 */
export interface IncrementalHttpCheckpoint {
  /** RFC 3339 / ISO-8601 lower bound when the API supports `since`. */
  since?: string;
  /** ETag from last successful response (`If-None-Match` on the next request). */
  etag?: string;
  /** Provider page token or 1-based page number. */
  page?: string | number;
}

/**
 * GitHub work-history checkpoint (repos → issues → PRs → commits).
 * Serialize with `JSON.stringify` into `SyncCheckpoint.cursor`.
 */
export interface GithubSyncCheckpointCursor extends IncrementalHttpCheckpoint {
  v: 1;
  phase: "repos" | "issues" | "pulls" | "commits" | "done";
  /** Authenticated login (also used as SyncCheckpoint.accountKey). */
  login?: string;
  /** 1-based page for the current phase list endpoint. */
  page: number;
  /** Queued `owner/name` repos discovered during the repos phase. */
  repoQueue?: string[];
  /** Repo currently being scanned for issues/PRs/commits. */
  currentRepo?: string;
  /** Per-resource ETags keyed by `repos` or `owner/name:issues|pulls|commits`. */
  etags?: Record<string, string>;
}

/**
 * Result of a single adapter fetch / backfill page.
 */
export interface AdapterPage<T = RawEnvelope> {
  items: T[];
  /** Next checkpoint cursor, or null if exhausted. */
  nextCursor: string | null;
  /** True when more pages may exist. */
  hasMore: boolean;
}

/**
 * Common contract for all Cortex source adapters.
 */
export interface SourceAdapter {
  readonly source: SourceId;

  /**
   * Backfill or incremental page from an optional checkpoint cursor.
   */
  fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage>;

  /**
   * Optional health / readiness probe.
   */
  healthcheck?(): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Compute a stable content hash helper input shape (hashing lives in API/adapters).
 */
export function envelopeKey(source: SourceId, sourceRecordId: string): string {
  return `${source}:${sourceRecordId}`;
}
