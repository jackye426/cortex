import type {
  GithubSyncCheckpointCursor,
  SyncCheckpoint,
} from "@cortex/core";

export function emptyGithubCursor(
  since?: string,
): GithubSyncCheckpointCursor {
  return {
    v: 1,
    phase: "repos",
    page: 1,
    since,
    repoQueue: [],
    etags: {},
  };
}

export function parseGithubCursor(
  checkpoint?: SyncCheckpoint,
): GithubSyncCheckpointCursor {
  const sinceFromMeta =
    checkpoint?.metadata &&
    typeof checkpoint.metadata.since === "string"
      ? checkpoint.metadata.since
      : undefined;

  if (!checkpoint?.cursor) {
    return emptyGithubCursor(sinceFromMeta);
  }

  try {
    const parsed = JSON.parse(checkpoint.cursor) as Partial<GithubSyncCheckpointCursor>;
    if (parsed.v === 1 && parsed.phase) {
      return {
        v: 1,
        phase: parsed.phase,
        page: typeof parsed.page === "number" && parsed.page > 0 ? parsed.page : 1,
        since: parsed.since ?? sinceFromMeta,
        etag: parsed.etag,
        login: parsed.login,
        repoQueue: Array.isArray(parsed.repoQueue) ? parsed.repoQueue : [],
        currentRepo: parsed.currentRepo,
        etags:
          parsed.etags && typeof parsed.etags === "object" ? parsed.etags : {},
      };
    }
  } catch {
    // Cursor may be a bare ISO `since` from an older/simple checkpoint.
    if (/^\d{4}-\d{2}-\d{2}/.test(checkpoint.cursor)) {
      return emptyGithubCursor(checkpoint.cursor);
    }
  }

  return emptyGithubCursor(sinceFromMeta);
}

export function serializeGithubCursor(
  cursor: GithubSyncCheckpointCursor,
): string {
  return JSON.stringify(cursor);
}

export function toSyncCheckpoint(
  cursor: GithubSyncCheckpointCursor,
  accountKey: string,
): SyncCheckpoint {
  return {
    source: "github",
    accountKey,
    cursor: serializeGithubCursor(cursor),
    updatedAt: new Date().toISOString(),
    metadata: {
      since: cursor.since,
      phase: cursor.phase,
      etag: cursor.etag,
      ...(cursor.etags ? { etags: cursor.etags } : {}),
    },
  };
}

export function etagKey(
  scope: "repos" | "issues" | "pulls" | "commits",
  repoFullName?: string,
): string {
  if (scope === "repos") return "repos";
  return `${repoFullName ?? ""}:${scope}`;
}
