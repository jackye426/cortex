import type { BookmarkRow, SearchQueryRow } from "./read.js";
import {
  bookmarkSourceRecordId,
  searchQuerySourceRecordId,
} from "./read.js";

export interface BookmarkSummary {
  browser: string;
  profile: string;
  guid: string;
  name: string;
  url: string;
  folderPath: string;
  dateAdded?: string;
  occurredAt?: string;
}

export interface BookmarkEnvelopeBody {
  kind: "browser_bookmark";
  browser: string;
  profile: string;
  accountKey: string;
  guid: string;
  name: string;
  url: string;
  folderPath: string;
  dateAdded?: string;
}

export interface SearchQuerySummary {
  browser: string;
  profile: string;
  urlId: number;
  term: string;
  normalizedTerm: string;
  resultUrl?: string;
  occurredAt?: string;
}

export interface SearchQueryEnvelopeBody {
  kind: "browser_search_query";
  browser: string;
  profile: string;
  accountKey: string;
  keywordId: number;
  urlId: number;
  term: string;
  normalizedTerm: string;
  resultUrl?: string;
  resultTitle?: string;
  lastVisitTimeChrome?: number;
}

export function mapBookmark(row: BookmarkRow): {
  sourceRecordId: string;
  body: BookmarkEnvelopeBody;
  summary: BookmarkSummary;
} {
  const sourceRecordId = bookmarkSourceRecordId(
    row.browser,
    row.profile,
    row.guid,
  );
  const body: BookmarkEnvelopeBody = {
    kind: "browser_bookmark",
    browser: row.browser,
    profile: row.profile,
    accountKey: row.accountKey,
    guid: row.guid,
    name: row.name,
    url: row.url,
    folderPath: row.folderPath,
    dateAdded: row.dateAdded,
  };
  const summary: BookmarkSummary = {
    browser: row.browser,
    profile: row.profile,
    guid: row.guid,
    name: row.name,
    url: row.url,
    folderPath: row.folderPath,
    dateAdded: row.dateAdded,
    occurredAt: row.dateAdded,
  };
  return { sourceRecordId, body, summary };
}

export function mapSearchQuery(row: SearchQueryRow): {
  sourceRecordId: string;
  body: SearchQueryEnvelopeBody;
  summary: SearchQuerySummary;
} {
  const sourceRecordId = searchQuerySourceRecordId(
    row.browser,
    row.profile,
    row.urlId,
    row.normalizedTerm,
  );
  const body: SearchQueryEnvelopeBody = {
    kind: "browser_search_query",
    browser: row.browser,
    profile: row.profile,
    accountKey: row.accountKey,
    keywordId: row.keywordId,
    urlId: row.urlId,
    term: row.term,
    normalizedTerm: row.normalizedTerm,
    resultUrl: row.resultUrl,
    resultTitle: row.resultTitle,
    lastVisitTimeChrome: row.lastVisitTimeChrome,
  };
  const summary: SearchQuerySummary = {
    browser: row.browser,
    profile: row.profile,
    urlId: row.urlId,
    term: row.term,
    normalizedTerm: row.normalizedTerm,
    resultUrl: row.resultUrl,
    occurredAt: row.occurredAt,
  };
  return { sourceRecordId, body, summary };
}
