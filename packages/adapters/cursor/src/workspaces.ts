import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface WorkspaceInfo {
  /** workspaceStorage folder name (hash / id). */
  workspaceId: string;
  /** Decoded folder path when scheme is file. */
  folderPath?: string;
  /** Raw folder URI from workspace.json. */
  folderUri?: string;
}

/** Map workspaceStorage entries via workspace.json to folder paths. */
export function loadWorkspaceMap(workspaceStorageRoot: string): Map<string, WorkspaceInfo> {
  const map = new Map<string, WorkspaceInfo>();
  let entries;
  try {
    entries = readdirSync(workspaceStorageRoot, { withFileTypes: true });
  } catch {
    return map;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspaceId = entry.name;
    const jsonPath = join(workspaceStorageRoot, workspaceId, "workspace.json");
    let raw: string;
    try {
      raw = readFileSync(jsonPath, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as { folder?: string; workspace?: string };
      const folderUri = parsed.folder ?? parsed.workspace;
      const info: WorkspaceInfo = { workspaceId, folderUri };
      if (typeof folderUri === "string") {
        const decoded = decodeFolderUri(folderUri);
        if (decoded) info.folderPath = decoded;
      }
      map.set(workspaceId, info);
    } catch {
      map.set(workspaceId, { workspaceId });
    }
  }

  return map;
}

/** Decode a file:// folder URI to a Windows path. */
export function decodeFolderUri(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try {
    const u = new URL(uri);
    let p = decodeURIComponent(u.pathname);
    // URL path is `/c:/Users/...` on Windows
    if (/^\/[A-Za-z]:\//.test(p)) {
      p = p.slice(1);
    }
    return p.replace(/\//g, "\\");
  } catch {
    return undefined;
  }
}
