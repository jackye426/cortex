import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface CodexThreadMeta {
  id: string;
  title?: string;
  cwd?: string;
  source?: string;
  model?: string;
  modelProvider?: string;
  gitBranch?: string;
  gitSha?: string;
  firstUserMessage?: string;
  rolloutPath?: string;
  createdAt?: number;
  updatedAt?: number;
  cliVersion?: string;
  preview?: string;
}

/**
 * Read-only join against `~\.codex\state_5.sqlite` threads table.
 * Never opens auth.json. Returns empty map if DB missing / unreadable.
 */
export function loadThreadMetadata(stateDbPath: string): Map<string, CodexThreadMeta> {
  const map = new Map<string, CodexThreadMeta>();
  if (!existsSync(stateDbPath)) return map;

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(stateDbPath, { readOnly: true });
  } catch {
    return map;
  }

  try {
    const rows = db
      .prepare(
        `SELECT id, title, cwd, source, model, model_provider, git_branch, git_sha,
                first_user_message, rollout_path, created_at, updated_at, cli_version, preview
         FROM threads`,
      )
      .all() as Array<Record<string, unknown>>;

    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : null;
      if (!id) continue;
      const meta: CodexThreadMeta = {
        id,
        title: str(row.title),
        cwd: str(row.cwd),
        source: str(row.source),
        model: str(row.model),
        modelProvider: str(row.model_provider),
        gitBranch: str(row.git_branch),
        gitSha: str(row.git_sha),
        firstUserMessage: str(row.first_user_message),
        rolloutPath: str(row.rollout_path),
        createdAt: num(row.created_at),
        updatedAt: num(row.updated_at),
        cliVersion: str(row.cli_version),
        preview: str(row.preview),
      };
      map.set(id, meta);
      if (meta.rolloutPath) {
        map.set(normalizePathKey(meta.rolloutPath), meta);
      }
    }
  } catch {
    // Schema drift — ignore; JSONL remains source of truth
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }

  return map;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function normalizePathKey(p: string): string {
  return p.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").toLowerCase();
}
