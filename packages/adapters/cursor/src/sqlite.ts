import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type CursorDbHandle = {
  db: DatabaseSync;
  /** Path actually opened (may be a temp copy). */
  openedPath: string;
  /** True when we copied to a temp file — caller must dispose. */
  isTempCopy: boolean;
  dispose: () => void;
};

export interface OpenCursorDbOptions {
  /**
   * When true (or when read-only open fails), copy DB to temp then read.
   * Default false — state.vscdb can be multi-GB; prefer immutable RO open.
   */
  copyBeforeRead?: boolean;
}

/**
 * Open Cursor `state.vscdb` read-only. Never writes the live DB.
 * Tries `{ readOnly: true }` first; optionally falls back to copy-then-read.
 */
export function openCursorDb(
  dbPath: string,
  options: OpenCursorDbOptions = {},
): CursorDbHandle {
  if (!existsSync(dbPath)) {
    throw new Error(`Cursor state DB not found: ${dbPath}`);
  }

  if (!options.copyBeforeRead) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      return {
        db,
        openedPath: dbPath,
        isTempCopy: false,
        dispose: () => {
          try {
            db.close();
          } catch {
            /* ignore */
          }
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to open Cursor DB read-only (${msg}). Close Cursor or pass copyBeforeRead: true (DB may be multi-GB).`,
      );
    }
  }

  const tempDir = mkdtempSync(join(tmpdir(), "cortex-cursor-"));
  const tempDb = join(tempDir, "state.vscdb");
  copyFileSync(dbPath, tempDb);
  // Also copy WAL/SHM if present so snapshot is consistent
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${dbPath}${suffix}`;
    if (existsSync(side)) {
      try {
        copyFileSync(side, `${tempDb}${suffix}`);
      } catch {
        /* ignore */
      }
    }
  }

  const db = new DatabaseSync(tempDb, { readOnly: true });
  return {
    db,
    openedPath: tempDb,
    isTempCopy: true,
    dispose: () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value ?? "");
}

export function getKvText(
  db: DatabaseSync,
  table: "ItemTable" | "cursorDiskKV",
  key: string,
): string | null {
  try {
    const row = db.prepare(`SELECT value FROM ${table} WHERE key = ?`).get(key) as
      | { value: unknown }
      | undefined;
    if (!row) return null;
    return asText(row.value);
  } catch {
    return null;
  }
}

export function parseJsonValue(text: string | null): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
