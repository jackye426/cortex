import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { readdirSync, statSync } from "node:fs";

export function defaultCodexHome(): string {
  return join(homedir(), ".codex");
}

export function defaultCodexSessionsRoot(codexHome = defaultCodexHome()): string {
  return join(codexHome, "sessions");
}

export function defaultCodexStateDb(codexHome = defaultCodexHome()): string {
  return join(codexHome, "state_5.sqlite");
}

/** Never read — credentials live here. */
export function codexAuthPath(codexHome = defaultCodexHome()): string {
  return join(codexHome, "auth.json");
}

/**
 * Recursively list `rollout-*.jsonl` under sessions root.
 * Does not follow into auth or other credential paths.
 */
export function listCodexRolloutFiles(sessionsRoot: string): string[] {
  const out: string[] = [];
  walk(sessionsRoot, out);
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
    // Hard skip credential-ish names if ever nested
    if (entry.name === "auth.json" || entry.name.endsWith(".credentials.json")) {
      continue;
    }
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (!lower.startsWith("rollout-") || !lower.endsWith(".jsonl")) continue;
    try {
      if (statSync(full).size <= 0) continue;
    } catch {
      continue;
    }
    out.push(full);
  }
}

export function toPosixRel(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

/** Extract session UUID from `rollout-...-<uuid>.jsonl`. */
export function sessionIdFromRolloutPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  const m = base.match(
    /rollout-.*?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
  );
  if (m?.[1]) return m[1];
  return base.replace(/\.jsonl$/i, "");
}
