import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { readdirSync, statSync } from "node:fs";

/** Default Claude Code projects root on Windows / Unix. */
export function defaultClaudeProjectsRoot(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * Recursively list `*.jsonl` session transcripts under a projects root.
 * Skips credentials and non-transcript paths.
 */
export function listClaudeSessionFiles(projectsRoot: string): string[] {
  const out: string[] = [];
  walk(projectsRoot, out);
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".jsonl")) continue;
    // Skip top-level history dumps if ever nested oddly
    if (entry.name === "history.jsonl") continue;
    try {
      if (statSync(full).size <= 0) continue;
    } catch {
      continue;
    }
    out.push(full);
  }
}

/** Stable relative path key for checkpoints (forward slashes). */
export function toPosixRel(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

/** Session id from `<uuid>.jsonl` filename when present. */
export function sessionIdFromFile(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base.replace(/\.jsonl$/i, "");
}
