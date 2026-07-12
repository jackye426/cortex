import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Default Calibre library path used when config is missing (Jack's machine). */
export function defaultCalibreLibraryPath(): string {
  return join(homedir(), "Calibre Library");
}

/** `%APPDATA%\calibre\global.py.json` */
export function defaultCalibreGlobalConfigPath(): string {
  const appData = process.env.APPDATA;
  if (appData) return join(appData, "calibre", "global.py.json");
  return join(homedir(), "AppData", "Roaming", "calibre", "global.py.json");
}

/**
 * Resolve Calibre library root from global.py.json `library_path`,
 * falling back to `~/Calibre Library` when present.
 */
export function resolveCalibreLibraryPath(
  configPath = defaultCalibreGlobalConfigPath(),
  fallback = defaultCalibreLibraryPath(),
): string {
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
        library_path?: unknown;
      };
      if (typeof raw.library_path === "string" && raw.library_path.trim()) {
        return raw.library_path.trim();
      }
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

export function calibreMetadataDbPath(libraryPath: string): string {
  return join(libraryPath, "metadata.db");
}

/** Reconstruct on-disk format path: `{library}/{books.path}/{data.name}.{format}` */
export function formatFilePath(
  libraryPath: string,
  bookPath: string,
  dataName: string,
  format: string,
): string {
  return join(libraryPath, bookPath, `${dataName}.${format.toLowerCase()}`);
}
