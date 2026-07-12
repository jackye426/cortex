import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { formatFilePath } from "./paths.js";

export interface CalibreFormatRow {
  format: string;
  name: string;
  uncompressedSize: number;
  /** Absolute path string — not file bytes. */
  path: string;
}

export interface CalibreBookRow {
  id: number;
  uuid: string;
  title: string;
  sort?: string;
  authorSort?: string;
  path: string;
  timestamp?: string;
  pubdate?: string;
  lastModified?: string;
  seriesIndex?: number;
  hasCover: boolean;
  authors: string[];
  tags: string[];
  identifiers: Record<string, string>;
  comment?: string;
  formats: CalibreFormatRow[];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Copy `metadata.db` then open read-only (Calibre may lock the live file).
 * Returns book rows with authors/tags/identifiers/formats; never reads ebook bytes.
 */
export function loadCalibreBooks(libraryPath: string, metadataDbPath: string): CalibreBookRow[] {
  if (!existsSync(metadataDbPath)) return [];

  const tmpDir = mkdtempSync(join(tmpdir(), "cortex-calibre-"));
  const tmpDb = join(tmpDir, "metadata.db");
  try {
    copyFileSync(metadataDbPath, tmpDb);
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
    const books = db
      .prepare(
        `SELECT id, title, sort, timestamp, pubdate, series_index, author_sort,
                path, uuid, has_cover, last_modified
         FROM books
         ORDER BY id ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    const authorsByBook = groupStrings(
      db
        .prepare(
          `SELECT l.book AS book, a.name AS name
           FROM books_authors_link l
           JOIN authors a ON a.id = l.author
           ORDER BY l.id ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    );

    const tagsByBook = groupStrings(
      db
        .prepare(
          `SELECT l.book AS book, t.name AS name
           FROM books_tags_link l
           JOIN tags t ON t.id = l.tag
           ORDER BY l.id ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    );

    const identifiersByBook = new Map<number, Record<string, string>>();
    for (const row of db
      .prepare(`SELECT book, type, val FROM identifiers`)
      .all() as Array<Record<string, unknown>>) {
      const bookId = num(row.book);
      const type = str(row.type);
      const val = str(row.val);
      if (bookId == null || !type || !val) continue;
      const bag = identifiersByBook.get(bookId) ?? {};
      bag[type] = val;
      identifiersByBook.set(bookId, bag);
    }

    const commentsByBook = new Map<number, string>();
    for (const row of db
      .prepare(`SELECT book, text FROM comments`)
      .all() as Array<Record<string, unknown>>) {
      const bookId = num(row.book);
      const text = str(row.text);
      if (bookId == null || !text) continue;
      commentsByBook.set(bookId, text);
    }

    const pathByBookId = new Map<number, string>();
    for (const row of books) {
      const id = num(row.id);
      const path = str(row.path);
      if (id != null && path) pathByBookId.set(id, path);
    }

    const formatsByBook = new Map<number, CalibreFormatRow[]>();
    for (const row of db
      .prepare(
        `SELECT book, format, uncompressed_size, name FROM data ORDER BY id ASC`,
      )
      .all() as Array<Record<string, unknown>>) {
      const bookId = num(row.book);
      const format = str(row.format);
      const name = str(row.name);
      if (bookId == null || !format || !name) continue;
      const bookPath = pathByBookId.get(bookId);
      const list = formatsByBook.get(bookId) ?? [];
      list.push({
        format: format.toUpperCase(),
        name,
        uncompressedSize: num(row.uncompressed_size) ?? 0,
        path: bookPath
          ? formatFilePath(libraryPath, bookPath, name, format)
          : join(libraryPath, `${name}.${format.toLowerCase()}`),
      });
      formatsByBook.set(bookId, list);
    }

    const out: CalibreBookRow[] = [];
    for (const row of books) {
      const id = num(row.id);
      const uuid = str(row.uuid);
      const title = str(row.title);
      const path = str(row.path);
      if (id == null || !uuid || !title || !path) continue;
      out.push({
        id,
        uuid,
        title,
        sort: str(row.sort),
        authorSort: str(row.author_sort),
        path,
        timestamp: str(row.timestamp),
        pubdate: str(row.pubdate),
        lastModified: str(row.last_modified),
        seriesIndex: num(row.series_index),
        hasCover: Boolean(row.has_cover),
        authors: authorsByBook.get(id) ?? [],
        tags: tagsByBook.get(id) ?? [],
        identifiers: identifiersByBook.get(id) ?? {},
        comment: commentsByBook.get(id),
        formats: formatsByBook.get(id) ?? [],
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

function groupStrings(
  rows: Array<Record<string, unknown>>,
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const row of rows) {
    const bookId = num(row.book);
    const name = str(row.name);
    if (bookId == null || !name) continue;
    const list = map.get(bookId) ?? [];
    list.push(name);
    map.set(bookId, list);
  }
  return map;
}
