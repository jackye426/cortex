import { existsSync } from "node:fs";
import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import { loadCalibreBooks, type CalibreBookRow } from "./db.js";
import { calibreSourceRecordId, mapCalibreBook } from "./map.js";
import {
  calibreMetadataDbPath,
  defaultCalibreGlobalConfigPath,
  defaultCalibreLibraryPath,
  resolveCalibreLibraryPath,
} from "./paths.js";

export type { CalibreBookRow } from "./db.js";
export type { CalibreEbookSummary, CalibreEnvelopeBody } from "./map.js";
export {
  calibreSourceRecordId,
  mapCalibreBook,
} from "./map.js";
export {
  calibreMetadataDbPath,
  defaultCalibreGlobalConfigPath,
  defaultCalibreLibraryPath,
  formatFilePath,
  resolveCalibreLibraryPath,
} from "./paths.js";
export { loadCalibreBooks } from "./db.js";

export interface CalibreAdapterOptions {
  /** Override Calibre library root. */
  libraryPath?: string;
  /** Override metadata.db path. */
  metadataDbPath?: string;
  pageSize?: number;
  /** Hard cap on books (dry-run / smoke). */
  limit?: number;
  collectorName?: string;
}

/**
 * Calibre library metadata adapter.
 * Reads `metadata.db` (copy-then-ro). Emits ebook envelopes with metadata +
 * path strings — never vaults ebook binaries.
 */
export class CalibreAdapter implements SourceAdapter {
  readonly source = "calibre" as const;

  private readonly libraryPath: string;
  private readonly metadataDbPath: string;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private bookCache: CalibreBookRow[] | null = null;

  constructor(options: CalibreAdapterOptions = {}) {
    this.libraryPath =
      options.libraryPath ?? resolveCalibreLibraryPath();
    this.metadataDbPath =
      options.metadataDbPath ?? calibreMetadataDbPath(this.libraryPath);
    this.pageSize = options.pageSize ?? 50;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-calibre";
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!existsSync(this.metadataDbPath)) {
      return {
        ok: false,
        detail: `metadata.db not found at ${this.metadataDbPath}`,
      };
    }
    const books = this.listBooks();
    return {
      ok: true,
      detail: `${books.length} book(s) in ${this.libraryPath}`,
    };
  }

  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    const books = this.listBooks();
    const start = this.resolveStartIndex(books, checkpoint?.cursor);
    const slice = books.slice(start, start + this.pageSize);
    const items = slice.map((b) => this.envelopeForBook(b));
    const nextIndex = start + slice.length;
    const hasMore = nextIndex < books.length;
    return {
      items,
      nextCursor: hasMore ? String(nextIndex) : null,
      hasMore,
    };
  }

  async backfillAll(): Promise<RawEnvelope[]> {
    return this.listBooks().map((b) => this.envelopeForBook(b));
  }

  private listBooks(): CalibreBookRow[] {
    if (!this.bookCache) {
      let books = loadCalibreBooks(this.libraryPath, this.metadataDbPath);
      if (this.limit != null && this.limit >= 0) {
        books = books.slice(0, this.limit);
      }
      this.bookCache = books;
    }
    return this.bookCache;
  }

  private resolveStartIndex(books: CalibreBookRow[], cursor?: string): number {
    if (!cursor) return 0;
    const asNum = Number(cursor);
    if (Number.isFinite(asNum) && asNum >= 0) {
      return Math.min(Math.floor(asNum), books.length);
    }
    // Cursor may be last_modified ISO or book uuid from prior run
    const byUuid = books.findIndex((b) => b.uuid === cursor);
    if (byUuid >= 0) return byUuid + 1;
    const byId = books.findIndex((b) => `book:${b.id}` === cursor);
    return byId >= 0 ? byId + 1 : 0;
  }

  private envelopeForBook(book: CalibreBookRow): RawEnvelope {
    const { body, summary } = mapCalibreBook(book);
    return {
      source: "calibre",
      sourceRecordId: calibreSourceRecordId(book),
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: this.libraryPath,
        extra: {
          kind: "calibre_ebook_summary",
          calibreId: book.id,
          summary,
        },
      },
    };
  }
}

export function createCalibreAdapter(
  options?: CalibreAdapterOptions,
): CalibreAdapter {
  return new CalibreAdapter(options);
}
