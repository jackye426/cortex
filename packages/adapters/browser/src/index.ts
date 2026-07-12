import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import { mapBookmark, mapSearchQuery } from "./map.js";
import {
  defaultChromeUserDataRoot,
  defaultEdgeUserDataRoot,
  listBrowserProfiles,
  type BrowserProfileRef,
} from "./paths.js";
import { loadBookmarks, loadSearchQueries } from "./read.js";

export type {
  BookmarkEnvelopeBody,
  BookmarkSummary,
  SearchQueryEnvelopeBody,
  SearchQuerySummary,
} from "./map.js";
export type { BookmarkRow, SearchQueryRow } from "./read.js";
export type { BrowserKind, BrowserProfileRef } from "./paths.js";
export {
  bookmarkSourceRecordId,
  chromeTimeToIso,
  loadBookmarks,
  loadSearchQueries,
  searchQuerySourceRecordId,
} from "./read.js";
export {
  defaultChromeUserDataRoot,
  defaultEdgeUserDataRoot,
  listBrowserProfiles,
} from "./paths.js";
export { mapBookmark, mapSearchQuery } from "./map.js";

export interface BrowserAdapterOptions {
  chromeRoot?: string | null;
  edgeRoot?: string | null;
  pageSize?: number;
  /** Hard cap on total envelopes (bookmarks + searches). */
  limit?: number;
  collectorName?: string;
}

type CachedItem =
  | { kind: "bookmark"; envelope: RawEnvelope }
  | { kind: "search_query"; envelope: RawEnvelope };

/**
 * Chrome/Edge bookmarks + keyword search adapter.
 * Noise rule: Bookmarks JSON + History.keyword_search_terms only.
 * Does NOT ingest urls/visits firehose.
 */
export class BrowserAdapter implements SourceAdapter {
  readonly source = "browser" as const;

  private readonly chromeRoot: string | null;
  private readonly edgeRoot: string | null;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private itemCache: CachedItem[] | null = null;

  constructor(options: BrowserAdapterOptions = {}) {
    this.chromeRoot =
      options.chromeRoot === undefined
        ? defaultChromeUserDataRoot()
        : options.chromeRoot;
    this.edgeRoot =
      options.edgeRoot === undefined
        ? defaultEdgeUserDataRoot()
        : options.edgeRoot;
    this.pageSize = options.pageSize ?? 100;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-browser";
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    const profiles = this.profiles();
    if (profiles.length === 0) {
      return { ok: false, detail: "no Chrome/Edge profiles with Bookmarks/History" };
    }
    const items = this.listItems();
    const bookmarks = items.filter((i) => i.kind === "bookmark").length;
    const searches = items.filter((i) => i.kind === "search_query").length;
    return {
      ok: true,
      detail: `${profiles.length} profile(s); ${bookmarks} bookmark(s); ${searches} search_query(ies)`,
    };
  }

  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    const items = this.listItems();
    const start = this.resolveStartIndex(items, checkpoint?.cursor);
    const slice = items.slice(start, start + this.pageSize);
    const nextIndex = start + slice.length;
    const hasMore = nextIndex < items.length;
    return {
      items: slice.map((i) => i.envelope),
      nextCursor: hasMore ? String(nextIndex) : null,
      hasMore,
    };
  }

  async backfillAll(): Promise<RawEnvelope[]> {
    return this.listItems().map((i) => i.envelope);
  }

  /** Counts without applying limit (for reporting). */
  discoverCounts(): {
    profiles: number;
    bookmarks: number;
    searches: number;
  } {
    const profiles = this.profiles();
    let bookmarks = 0;
    let searches = 0;
    for (const p of profiles) {
      bookmarks += loadBookmarks(p).length;
      searches += loadSearchQueries(p).length;
    }
    return { profiles: profiles.length, bookmarks, searches };
  }

  private profiles(): BrowserProfileRef[] {
    return listBrowserProfiles({
      chromeRoot: this.chromeRoot,
      edgeRoot: this.edgeRoot,
    });
  }

  private listItems(): CachedItem[] {
    if (!this.itemCache) {
      const items: CachedItem[] = [];
      for (const profile of this.profiles()) {
        for (const bm of loadBookmarks(profile)) {
          const { sourceRecordId, body, summary } = mapBookmark(bm);
          items.push({
            kind: "bookmark",
            envelope: {
              source: "browser",
              sourceRecordId,
              occurredAt: summary.occurredAt,
              mimeType: "application/json",
              body,
              provenance: {
                collector: this.collectorName,
                host: hostname(),
                workspace: profile.accountKey,
                extra: {
                  kind: "browser_bookmark_summary",
                  accountKey: profile.accountKey,
                  summary,
                },
              },
            },
          });
        }
        for (const q of loadSearchQueries(profile)) {
          const { sourceRecordId, body, summary } = mapSearchQuery(q);
          items.push({
            kind: "search_query",
            envelope: {
              source: "browser",
              sourceRecordId,
              occurredAt: summary.occurredAt,
              mimeType: "application/json",
              body,
              provenance: {
                collector: this.collectorName,
                host: hostname(),
                workspace: profile.accountKey,
                extra: {
                  kind: "browser_search_query_summary",
                  accountKey: profile.accountKey,
                  summary,
                },
              },
            },
          });
        }
      }
      this.itemCache =
        this.limit != null && this.limit >= 0
          ? items.slice(0, this.limit)
          : items;
    }
    return this.itemCache;
  }

  private resolveStartIndex(items: CachedItem[], cursor?: string): number {
    if (!cursor) return 0;
    const asNum = Number(cursor);
    if (Number.isFinite(asNum) && asNum >= 0) {
      return Math.min(Math.floor(asNum), items.length);
    }
    const idx = items.findIndex((i) => i.envelope.sourceRecordId === cursor);
    return idx >= 0 ? idx + 1 : 0;
  }
}

export function createBrowserAdapter(
  options?: BrowserAdapterOptions,
): BrowserAdapter {
  return new BrowserAdapter(options);
}
