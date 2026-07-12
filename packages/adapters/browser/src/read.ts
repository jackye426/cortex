import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BrowserKind, BrowserProfileRef } from "./paths.js";

export interface BookmarkRow {
  browser: BrowserKind;
  profile: string;
  accountKey: string;
  guid: string;
  id?: string;
  name: string;
  url: string;
  dateAdded?: string;
  folderPath: string;
}

export interface SearchQueryRow {
  browser: BrowserKind;
  profile: string;
  accountKey: string;
  keywordId: number;
  urlId: number;
  term: string;
  normalizedTerm: string;
  /** Search-results URL metadata only — not a visit firehose row. */
  resultUrl?: string;
  resultTitle?: string;
  lastVisitTimeChrome?: number;
  occurredAt?: string;
}

/** Chromium GUID → `{browser}:{profile}:bm:{guid}` */
export function bookmarkSourceRecordId(
  browser: BrowserKind,
  profile: string,
  guid: string,
): string {
  return `${browser}:${profile}:bm:${guid}`;
}

/** `{browser}:{profile}:q:{url_id}:{hash(normalized_term)}` */
export function searchQuerySourceRecordId(
  browser: BrowserKind,
  profile: string,
  urlId: number,
  normalizedTerm: string,
): string {
  const hash = createHash("sha256")
    .update(normalizedTerm)
    .digest("hex")
    .slice(0, 16);
  return `${browser}:${profile}:q:${urlId}:${hash}`;
}

/**
 * Walk Chromium Bookmarks JSON (`roots.bookmark_bar` / `other` / `synced`).
 * Emits `type=url` nodes only.
 */
export function loadBookmarks(profile: BrowserProfileRef): BookmarkRow[] {
  if (!existsSync(profile.bookmarksPath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(profile.bookmarksPath, "utf8"));
  } catch {
    return [];
  }
  if (!isRecord(raw) || !isRecord(raw.roots)) return [];

  const roots = raw.roots;
  const out: BookmarkRow[] = [];
  for (const key of ["bookmark_bar", "other", "synced"] as const) {
    const root = roots[key];
    if (!isRecord(root)) continue;
    walkBookmarkNode(root, key, profile, out);
  }
  return out;
}

function walkBookmarkNode(
  node: Record<string, unknown>,
  folderPath: string,
  profile: BrowserProfileRef,
  out: BookmarkRow[],
): void {
  const type = typeof node.type === "string" ? node.type : "";
  if (type === "url") {
    const guid = typeof node.guid === "string" ? node.guid : "";
    const url = typeof node.url === "string" ? node.url : "";
    const name = typeof node.name === "string" ? node.name : "";
    if (!guid || !url) return;
    out.push({
      browser: profile.browser,
      profile: profile.profile,
      accountKey: profile.accountKey,
      guid,
      id: typeof node.id === "string" ? node.id : undefined,
      name,
      url,
      dateAdded: chromeTimeToIso(node.date_added),
      folderPath,
    });
    return;
  }

  if (type === "folder" || Array.isArray(node.children)) {
    const folderName =
      typeof node.name === "string" && node.name.length > 0
        ? node.name
        : folderPath;
    const nextPath =
      folderPath === folderName ? folderPath : `${folderPath}/${folderName}`;
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      if (isRecord(child)) {
        walkBookmarkNode(child, nextPath, profile, out);
      }
    }
  }
}

/**
 * Copy History SQLite then read `keyword_search_terms` only.
 * Joins `urls` solely for search-result URL metadata — never emits visits.
 */
export function loadSearchQueries(profile: BrowserProfileRef): SearchQueryRow[] {
  if (!existsSync(profile.historyPath)) return [];

  const tmpDir = mkdtempSync(join(tmpdir(), "cortex-browser-hist-"));
  const tmpDb = join(tmpDir, "History");
  try {
    copyFileSync(profile.historyPath, tmpDb);
  } catch {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return [];
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(tmpDb, { readOnly: true });
  } catch {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return [];
  }

  try {
    const rows = db
      .prepare(
        `SELECT k.keyword_id AS keyword_id,
                k.url_id AS url_id,
                k.term AS term,
                k.normalized_term AS normalized_term,
                u.url AS result_url,
                u.title AS result_title,
                CAST(u.last_visit_time AS TEXT) AS last_visit_time
         FROM keyword_search_terms k
         LEFT JOIN urls u ON u.id = k.url_id
         ORDER BY k.url_id ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    const out: SearchQueryRow[] = [];
    for (const row of rows) {
      const keywordId = toInt(row.keyword_id);
      const urlId = toInt(row.url_id);
      const term = str(row.term);
      const normalizedTerm = str(row.normalized_term) ?? term;
      if (keywordId == null || urlId == null || !term || !normalizedTerm) {
        continue;
      }
      const lastVisitRaw = row.last_visit_time;
      const lastVisit =
        typeof lastVisitRaw === "string" && /^\d+$/.test(lastVisitRaw)
          ? Number(lastVisitRaw)
          : toInt(lastVisitRaw);
      out.push({
        browser: profile.browser,
        profile: profile.profile,
        accountKey: profile.accountKey,
        keywordId,
        urlId,
        term,
        normalizedTerm,
        resultUrl: str(row.result_url),
        resultTitle: str(row.result_title),
        lastVisitTimeChrome:
          lastVisit != null && Number.isFinite(lastVisit) ? lastVisit : undefined,
        occurredAt: chromeTimeToIso(lastVisitRaw),
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Chromium time: microseconds since 1601-01-01 UTC → ISO-8601. */
export function chromeTimeToIso(value: unknown): string | undefined {
  let us: bigint;
  try {
    if (typeof value === "bigint") us = value;
    else if (typeof value === "string" && /^\d+$/.test(value)) us = BigInt(value);
    else if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      us = BigInt(Math.trunc(value));
    } else {
      return undefined;
    }
  } catch {
    return undefined;
  }
  if (us <= 0n) return undefined;
  const unixMs = Number(us / 1000n - 11_644_473_600_000n);
  if (!Number.isFinite(unixMs)) return undefined;
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function toInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  if (typeof v === "string" && /^-?\d+$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
  }
  return undefined;
}
