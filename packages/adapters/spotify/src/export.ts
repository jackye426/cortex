/**
 * Load official Spotify privacy / account data download StreamingHistory*.json.
 * Supports ZIP, extracted folder, or a single StreamingHistory JSON file.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { unzipSync } from "fflate";

export interface StreamingHistoryRow {
  /** Legacy account-data field. */
  endTime?: string;
  /** Extended streaming history timestamp. */
  ts?: string;
  artistName?: string;
  trackName?: string;
  msPlayed?: number;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  spotify_track_uri?: string | null;
  ms_played?: number;
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

function normalizeRow(raw: Record<string, unknown>): StreamingHistoryRow | null {
  const endTime =
    (typeof raw.endTime === "string" && raw.endTime) ||
    (typeof raw.ts === "string" && raw.ts) ||
    undefined;
  const trackName =
    (typeof raw.trackName === "string" && raw.trackName) ||
    (typeof raw.master_metadata_track_name === "string" &&
      raw.master_metadata_track_name) ||
    undefined;
  const artistName =
    (typeof raw.artistName === "string" && raw.artistName) ||
    (typeof raw.master_metadata_album_artist_name === "string" &&
      raw.master_metadata_album_artist_name) ||
    undefined;
  const msPlayed =
    typeof raw.msPlayed === "number"
      ? raw.msPlayed
      : typeof raw.ms_played === "number"
        ? raw.ms_played
        : undefined;
  const trackUri =
    typeof raw.spotify_track_uri === "string"
      ? raw.spotify_track_uri
      : undefined;

  if (!endTime && !trackName) return null;
  return {
    endTime,
    artistName,
    trackName,
    msPlayed,
    spotify_track_uri: trackUri,
  };
}

function isStreamingHistoryName(name: string): boolean {
  const base = basename(name).toLowerCase();
  return (
    (base.startsWith("streaminghistory") && base.endsWith(".json")) ||
    (base.startsWith("endsong_") && base.endsWith(".json")) ||
    base === "streaming_history.json"
  );
}

function parseStreamingHistoryArray(text: string): StreamingHistoryRow[] {
  const parsed = JSON.parse(stripBom(text)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("StreamingHistory JSON must be an array");
  }
  const rows: StreamingHistoryRow[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const row = normalizeRow(item);
    if (row) rows.push(row);
  }
  return rows;
}

function collectFromZip(
  entries: Record<string, Uint8Array>,
): { path: string; rows: StreamingHistoryRow[] }[] {
  const results: { path: string; rows: StreamingHistoryRow[] }[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith("/")) continue;
    if (!isStreamingHistoryName(path)) continue;
    results.push({ path, rows: parseStreamingHistoryArray(decodeUtf8(bytes)) });
  }
  return results;
}

export interface SpotifyExportLoadResult {
  sourcePath: string;
  rows: StreamingHistoryRow[];
  files: string[];
}

/**
 * Load StreamingHistory / EndSong JSON from:
 * - Spotify privacy ZIP
 * - extracted folder
 * - a single StreamingHistory*.json / endsong_*.json file
 */
export async function loadSpotifyPrivacyExport(
  inputPath: string,
): Promise<SpotifyExportLoadResult> {
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
        "ZIP has no StreamingHistory*.json / endsong_*.json (Spotify privacy export?)",
      );
    }
    return {
      sourcePath: abs,
      rows: parts.flatMap((p) => p.rows),
      files: parts.map((p) => `${abs}#${p.path}`),
    };
  }

  if (st.isFile() && isStreamingHistoryName(abs)) {
    const rows = parseStreamingHistoryArray(readFileSync(abs, "utf8"));
    return { sourcePath: abs, rows, files: [abs] };
  }

  if (st.isDirectory()) {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const s = statSync(full);
        if (s.isDirectory()) walk(full);
        else if (isStreamingHistoryName(full)) files.push(full);
      }
    };
    walk(abs);
    if (files.length === 0) {
      throw new Error(
        `No StreamingHistory*.json / endsong_*.json under ${abs}`,
      );
    }
    const rows: StreamingHistoryRow[] = [];
    for (const f of files) {
      rows.push(...parseStreamingHistoryArray(readFileSync(f, "utf8")));
    }
    return { sourcePath: abs, rows, files };
  }

  throw new Error(
    `Unsupported path (need .zip, folder, or StreamingHistory JSON): ${abs}`,
  );
}

/** Map export row fields into the shape mapExportPlayRow expects. */
export function exportRowToPlayInput(row: StreamingHistoryRow): {
  endTime?: string;
  msPlayed?: number;
  trackName?: string;
  artistName?: string;
  trackUri?: string;
} {
  return {
    endTime: row.endTime ?? row.ts,
    msPlayed: row.msPlayed ?? row.ms_played,
    trackName: row.trackName ?? row.master_metadata_track_name ?? undefined,
    artistName:
      row.artistName ?? row.master_metadata_album_artist_name ?? undefined,
    trackUri: row.spotify_track_uri ?? undefined,
  };
}
