/**
 * Local backfill checkpoint files under `.cortex/checkpoints/` (gitignored).
 * Opaque cursors for resume; not the Supabase sync_checkpoints table.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { SourceId } from "@cortex/core";

export interface LocalCheckpoint {
  source: string;
  accountKey: string;
  /** Opaque cursor (last sourceRecordId, page token, ISO since, etc.). */
  cursor: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CheckpointStoreOptions {
  /** Override root (default: `<cwd>/.cortex/checkpoints` then `~/.cortex/checkpoints`). */
  rootDir?: string;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "default";
}

/** Resolve checkpoint directory; prefer repo-local `.cortex/checkpoints`. */
export function resolveCheckpointDir(rootDir?: string): string {
  if (rootDir) return resolve(rootDir);
  const local = resolve(process.cwd(), ".cortex", "checkpoints");
  const parent = resolve(process.cwd(), "..", "..", ".cortex", "checkpoints");
  // Prefer cwd when collector runs from repo root or apps/collector
  if (existsSync(join(process.cwd(), "pnpm-workspace.yaml"))) {
    return local;
  }
  if (existsSync(join(process.cwd(), "..", "..", "pnpm-workspace.yaml"))) {
    return parent;
  }
  if (existsSync(dirname(local))) return local;
  return resolve(homedir(), ".cortex", "checkpoints");
}

export function checkpointPath(
  source: string,
  accountKey: string,
  rootDir?: string,
): string {
  const dir = resolveCheckpointDir(rootDir);
  const file = `${sanitizeSegment(source)}__${sanitizeSegment(accountKey)}.json`;
  return join(dir, file);
}

export function loadCheckpoint(
  source: string,
  accountKey: string,
  options: CheckpointStoreOptions = {},
): LocalCheckpoint | null {
  const path = checkpointPath(source, accountKey, options.rootDir);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<LocalCheckpoint>;
    if (
      typeof raw.source !== "string" ||
      typeof raw.accountKey !== "string" ||
      typeof raw.cursor !== "string" ||
      typeof raw.updatedAt !== "string"
    ) {
      return null;
    }
    return {
      source: raw.source,
      accountKey: raw.accountKey,
      cursor: raw.cursor,
      updatedAt: raw.updatedAt,
      metadata:
        raw.metadata && typeof raw.metadata === "object"
          ? (raw.metadata as Record<string, unknown>)
          : undefined,
    };
  } catch {
    return null;
  }
}

export function saveCheckpoint(
  checkpoint: LocalCheckpoint,
  options: CheckpointStoreOptions = {},
): string {
  const path = checkpointPath(
    checkpoint.source,
    checkpoint.accountKey,
    options.rootDir,
  );
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const payload: LocalCheckpoint = {
    ...checkpoint,
    updatedAt: checkpoint.updatedAt || new Date().toISOString(),
  };
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
  return path;
}

/** Advance cursor after a successful ingest (sourceRecordId as cursor by default). */
export function advanceCheckpoint(input: {
  source: SourceId | string;
  accountKey?: string;
  cursor: string;
  metadata?: Record<string, unknown>;
  rootDir?: string;
}): string {
  return saveCheckpoint(
    {
      source: input.source,
      accountKey: input.accountKey ?? "default",
      cursor: input.cursor,
      updatedAt: new Date().toISOString(),
      metadata: input.metadata,
    },
    { rootDir: input.rootDir },
  );
}
