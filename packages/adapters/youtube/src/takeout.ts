/**
 * Google Takeout → YouTube watch-history JSON parser stub.
 * Official Takeout only; no scraping. API has no full watch firehose.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { extractVideoIdFromUrl } from "./map.js";

export interface TakeoutWatchRow {
  header?: string;
  title?: string;
  titleUrl?: string;
  time?: string;
  subtitles?: { name?: string; url?: string }[];
  products?: string[];
  activityControls?: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function isWatchHistoryName(name: string): boolean {
  const base = basename(name).toLowerCase();
  return (
    base === "watch-history.json" ||
    base === "watch_history.json" ||
    base.endsWith("/watch-history.json")
  );
}

function parseWatchHistoryArray(text: string): TakeoutWatchRow[] {
  const parsed = JSON.parse(stripBom(text)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("watch-history.json must be a JSON array");
  }
  const rows: TakeoutWatchRow[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const subtitles = Array.isArray(item.subtitles)
      ? item.subtitles.filter(isRecord).map((s) => ({
          name: typeof s.name === "string" ? s.name : undefined,
          url: typeof s.url === "string" ? s.url : undefined,
        }))
      : undefined;
    rows.push({
      header: typeof item.header === "string" ? item.header : undefined,
      title: typeof item.title === "string" ? item.title : undefined,
      titleUrl: typeof item.titleUrl === "string" ? item.titleUrl : undefined,
      time: typeof item.time === "string" ? item.time : undefined,
      subtitles,
      products: Array.isArray(item.products)
        ? item.products.filter((p): p is string => typeof p === "string")
        : undefined,
      activityControls: Array.isArray(item.activityControls)
        ? item.activityControls.filter((p): p is string => typeof p === "string")
        : undefined,
    });
  }
  return rows;
}

function collectFromZip(
  entries: Record<string, Uint8Array>,
): { path: string; rows: TakeoutWatchRow[] }[] {
  const results: { path: string; rows: TakeoutWatchRow[] }[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith("/")) continue;
    if (!isWatchHistoryName(path) && !basename(path).toLowerCase().includes("watch-history")) {
      continue;
    }
    if (!basename(path).toLowerCase().endsWith(".json")) continue;
    try {
      results.push({
        path,
        rows: parseWatchHistoryArray(decodeUtf8(bytes)),
      });
    } catch {
      /* skip non-matching JSON */
    }
  }
  return results;
}

export interface YoutubeTakeoutLoadResult {
  sourcePath: string;
  rows: TakeoutWatchRow[];
  files: string[];
}

/**
 * Load Takeout watch-history from ZIP, folder, or direct JSON path.
 * Search-history is intentionally out of scope for this stub (library + watches).
 */
export async function loadYoutubeTakeout(
  inputPath: string,
): Promise<YoutubeTakeoutLoadResult> {
  const abs = resolve(inputPath);
  if (!existsSync(abs)) {
    throw new Error(`Path not found: ${abs}`);
  }

  const st = statSync(abs);

  if (st.isFile() && abs.toLowerCase().endsWith(".zip")) {
    const zipBytes = new Uint8Array(readFileSync(abs));
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(zipBytes);
    } catch (err) {
      throw new Error(
        `Failed to unzip ${abs}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const parts = collectFromZip(unzipped);
    if (parts.length === 0) {
      throw new Error(
        "ZIP has no watch-history.json (Google Takeout → YouTube?)",
      );
    }
    return {
      sourcePath: abs,
      rows: parts.flatMap((p) => p.rows),
      files: parts.map((p) => `${abs}#${p.path}`),
    };
  }

  if (st.isFile() && basename(abs).toLowerCase().includes("watch-history")) {
    const rows = parseWatchHistoryArray(readFileSync(abs, "utf8"));
    return { sourcePath: abs, rows, files: [abs] };
  }

  if (st.isDirectory()) {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const s = statSync(full);
        if (s.isDirectory()) walk(full);
        else if (basename(full).toLowerCase().includes("watch-history") &&
          full.toLowerCase().endsWith(".json")) {
          files.push(full);
        }
      }
    };
    walk(abs);
    if (files.length === 0) {
      throw new Error(`No watch-history.json under ${abs}`);
    }
    const rows: TakeoutWatchRow[] = [];
    for (const f of files) {
      rows.push(...parseWatchHistoryArray(readFileSync(f, "utf8")));
    }
    return { sourcePath: abs, rows, files };
  }

  throw new Error(
    `Unsupported path (need Takeout .zip, folder, or watch-history.json): ${abs}`,
  );
}

/** Convert a Takeout row into mapTakeoutWatch input (skips non-video rows). */
export function takeoutRowToWatchInput(row: TakeoutWatchRow): {
  videoId: string;
  title?: string;
  channelTitle?: string;
  channelUrl?: string;
  watchedAt?: string;
  titleUrl?: string;
  header?: string;
  products?: string[];
} | null {
  const videoId = extractVideoIdFromUrl(row.titleUrl);
  if (!videoId) return null;
  // Titles often look like "Watched Foo" — strip prefix when present
  let title = row.title;
  if (title?.toLowerCase().startsWith("watched ")) {
    title = title.slice("watched ".length);
  }
  const sub = row.subtitles?.[0];
  return {
    videoId,
    title,
    channelTitle: sub?.name,
    channelUrl: sub?.url,
    watchedAt: row.time,
    titleUrl: row.titleUrl,
    header: row.header,
    products: row.products,
  };
}
