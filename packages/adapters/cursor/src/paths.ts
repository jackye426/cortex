import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";

/** `%APPDATA%\Cursor\User\globalStorage\state.vscdb` on Windows. */
export function defaultCursorStateDb(): string {
  const appData = process.env.APPDATA;
  if (appData) {
    return join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return join(homedir(), "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb");
}

/** `%APPDATA%\Cursor\User\workspaceStorage` */
export function defaultWorkspaceStorageRoot(): string {
  const appData = process.env.APPDATA;
  if (appData) {
    return join(appData, "Cursor", "User", "workspaceStorage");
  }
  return join(homedir(), "AppData", "Roaming", "Cursor", "User", "workspaceStorage");
}

/** `~\.cursor\projects` — agent-transcripts live under here. */
export function defaultCursorProjectsRoot(): string {
  return join(homedir(), ".cursor", "projects");
}

export function toPosixRel(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

/** List agent-transcripts JSONL files under ~/.cursor/projects. */
export function listAgentTranscriptFiles(projectsRoot: string): string[] {
  const out: string[] = [];
  walkTranscripts(projectsRoot, out, 0);
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

function walkTranscripts(dir: string, out: string[], depth: number): void {
  if (depth > 10) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTranscripts(full, out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".jsonl")) continue;
    // Prefer files under an agent-transcripts segment
    if (!full.toLowerCase().includes(`${sep}agent-transcripts${sep}`)) continue;
    try {
      if (statSync(full).size <= 0) continue;
    } catch {
      continue;
    }
    out.push(full);
  }
}

/** Composer / chat UUID from transcript filename or parent folder. */
export function composerIdFromTranscriptPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  const m = base.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
  );
  if (m?.[1]) return m[1].toLowerCase();
  return base.replace(/\.jsonl$/i, "").toLowerCase();
}

export function pathExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
