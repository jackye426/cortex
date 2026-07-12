import type { CalibreBookRow } from "./db.js";

export interface CalibreEbookSummary {
  calibreId: number;
  uuid: string;
  title: string;
  authors: string[];
  tags: string[];
  formats: string[];
  libraryRelativePath: string;
  formatPaths: string[];
  lastModified?: string;
  occurredAt?: string;
  identifiers: Record<string, string>;
  hasCover: boolean;
}

export interface CalibreEnvelopeBody {
  kind: "calibre_ebook";
  calibreId: number;
  uuid: string;
  title: string;
  sort?: string;
  authorSort?: string;
  authors: string[];
  tags: string[];
  identifiers: Record<string, string>;
  comment?: string;
  libraryRelativePath: string;
  seriesIndex?: number;
  hasCover: boolean;
  timestamp?: string;
  pubdate?: string;
  lastModified?: string;
  formats: Array<{
    format: string;
    name: string;
    uncompressedSize: number;
    path: string;
  }>;
}

/** Idempotency id: Calibre uuid preferred, else `book:{id}`. */
export function calibreSourceRecordId(book: CalibreBookRow): string {
  return book.uuid || `book:${book.id}`;
}

export function mapCalibreBook(book: CalibreBookRow): {
  body: CalibreEnvelopeBody;
  summary: CalibreEbookSummary;
} {
  const body: CalibreEnvelopeBody = {
    kind: "calibre_ebook",
    calibreId: book.id,
    uuid: book.uuid,
    title: book.title,
    sort: book.sort,
    authorSort: book.authorSort,
    authors: book.authors,
    tags: book.tags,
    identifiers: book.identifiers,
    comment: book.comment,
    libraryRelativePath: book.path,
    seriesIndex: book.seriesIndex,
    hasCover: book.hasCover,
    timestamp: book.timestamp,
    pubdate: book.pubdate,
    lastModified: book.lastModified,
    formats: book.formats.map((f) => ({
      format: f.format,
      name: f.name,
      uncompressedSize: f.uncompressedSize,
      path: f.path,
    })),
  };

  const summary: CalibreEbookSummary = {
    calibreId: book.id,
    uuid: book.uuid,
    title: book.title,
    authors: book.authors,
    tags: book.tags,
    formats: book.formats.map((f) => f.format),
    libraryRelativePath: book.path,
    formatPaths: book.formats.map((f) => f.path),
    lastModified: book.lastModified,
    occurredAt: book.lastModified ?? book.timestamp,
    identifiers: book.identifiers,
    hasCover: book.hasCover,
  };

  return { body, summary };
}
