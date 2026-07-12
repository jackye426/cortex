/**
 * Phase 5b — YouTube Data API v3 + Takeout adapter.
 * Official APIs / Takeout only; no scraping.
 * Watch history is not fully available via Data API — use Takeout for watches.
 */

import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import {
  createYoutubeOAuth2ClientFromEnv,
  ensureAccessToken,
  googleAccountKey,
  shouldUseYoutubeGoogleMock,
  youtubeApi,
  type OAuth2Client,
} from "@cortex/google-auth";
import {
  mapTakeoutWatch,
  mapYoutubePlaylistItem,
  videoSourceRecordId,
  type YoutubeVideoEnvelopeBody,
  type YoutubeVideoSummary,
  type YoutubeWatchEnvelopeBody,
  type YoutubeWatchSummary,
} from "./map.js";
import {
  mockPlaylistItems,
  mockTakeoutWatches,
  YOUTUBE_WATCH_HISTORY_NOTES,
} from "./mock.js";
import {
  loadYoutubeTakeout,
  takeoutRowToWatchInput,
  type TakeoutWatchRow,
} from "./takeout.js";
import type { YoutubePlaylistItemInput } from "./types.js";

export type {
  YoutubeVideoEnvelopeBody,
  YoutubeVideoSummary,
  YoutubeWatchEnvelopeBody,
  YoutubeWatchSummary,
} from "./map.js";
export {
  extractVideoIdFromUrl,
  mapTakeoutWatch,
  mapYoutubePlaylistItem,
  playlistItemWatchId,
  takeoutWatchId,
  videoSourceRecordId,
} from "./map.js";
export {
  loadYoutubeTakeout,
  takeoutRowToWatchInput,
  type TakeoutWatchRow,
} from "./takeout.js";
export { YOUTUBE_WATCH_HISTORY_NOTES } from "./mock.js";

export interface YoutubeAdapterOptions {
  pageSize?: number;
  limit?: number;
  collectorName?: string;
  mock?: boolean;
  auth?: OAuth2Client | null;
  /** Include Liked videos (LL). Default true. */
  includeLiked?: boolean;
  /** Include other playlists. Default true. */
  includePlaylists?: boolean;
}

interface SyncState {
  phase: "liked" | "playlists" | "playlist_items" | "done";
  pageToken?: string;
  playlistPageToken?: string;
  playlistId?: string;
  playlistTitle?: string;
}

/**
 * YouTube Data API library adapter (playlists + likes).
 * Full watch history → YoutubeTakeoutAdapter.
 */
export class YoutubeAdapter implements SourceAdapter {
  readonly source = "youtube" as const;

  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private readonly forceMock: boolean;
  private readonly includeLiked: boolean;
  private readonly includePlaylists: boolean;
  private readonly injectedAuth: OAuth2Client | null | undefined;

  constructor(options: YoutubeAdapterOptions = {}) {
    this.pageSize = options.pageSize ?? 25;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-youtube";
    this.forceMock = options.mock === true;
    this.includeLiked = options.includeLiked !== false;
    this.includePlaylists = options.includePlaylists !== false;
    this.injectedAuth = options.auth;
  }

  private useMock(): boolean {
    return this.forceMock || shouldUseYoutubeGoogleMock();
  }

  watchHistoryNotes(): string {
    return YOUTUBE_WATCH_HISTORY_NOTES;
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (this.useMock()) {
      return {
        ok: true,
        detail: `mock mode — ${mockPlaylistItems().length} playlist item(s); watch history via Takeout`,
      };
    }
    try {
      const auth = this.auth();
      if (!auth) return { ok: false, detail: "GOOGLE_* credentials incomplete" };
      await ensureAccessToken(auth);
      const yt = youtubeApi(auth);
      const channels = await yt.channels.list({
        part: ["id", "snippet"],
        mine: true,
        maxResults: 1,
      });
      const ch = channels.data.items?.[0];
      return {
        ok: true,
        detail: `live YouTube ${ch?.snippet?.title ?? ch?.id ?? "me"}`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    if (this.useMock()) return this.fetchMockPage(checkpoint);
    return this.fetchLivePage(checkpoint);
  }

  async backfillAll(): Promise<RawEnvelope[]> {
    if (this.useMock()) {
      let items = mockPlaylistItems().flatMap((i) => this.envelopeForItem(i));
      if (this.limit != null) items = items.slice(0, this.limit);
      return items;
    }
    const items: RawEnvelope[] = [];
    let cursor: string | undefined;
    let guard = 0;
    while (guard++ < 500) {
      const page = await this.fetchLivePage(
        cursor
          ? {
              source: "youtube",
              accountKey: googleAccountKey(),
              cursor,
              updatedAt: new Date().toISOString(),
            }
          : undefined,
      );
      items.push(...page.items);
      if (this.limit != null && items.length >= this.limit) {
        return items.slice(0, this.limit);
      }
      if (!page.hasMore || !page.nextCursor) break;
      const state = this.parseState(page.nextCursor);
      if (state.phase === "done") break;
      cursor = page.nextCursor;
    }
    return items;
  }

  private auth(): OAuth2Client | null {
    if (this.injectedAuth !== undefined) return this.injectedAuth;
    return createYoutubeOAuth2ClientFromEnv();
  }

  private parseState(cursor?: string): SyncState {
    if (!cursor) {
      return {
        phase: this.includeLiked
          ? "liked"
          : this.includePlaylists
            ? "playlists"
            : "done",
      };
    }
    try {
      return JSON.parse(cursor) as SyncState;
    } catch {
      return { phase: "done" };
    }
  }

  private encodeState(state: SyncState): string {
    return JSON.stringify(state);
  }

  private fetchMockPage(checkpoint?: SyncCheckpoint): AdapterPage {
    const all = mockPlaylistItems().flatMap((i) => this.envelopeForItem(i));
    const start = checkpoint?.cursor ? Number(checkpoint.cursor) || 0 : 0;
    const slice = all.slice(start, start + this.pageSize);
    const next = start + slice.length;
    const hasMore = next < all.length;
    return {
      items: slice,
      nextCursor: hasMore ? String(next) : null,
      hasMore,
    };
  }

  private async fetchLivePage(
    checkpoint?: SyncCheckpoint,
  ): Promise<AdapterPage> {
    const auth = this.auth();
    if (!auth) {
      throw new Error(
        "YouTube live mode requires GOOGLE_YOUTUBE_CLIENT_ID/SECRET (or GOOGLE_CLIENT_*) and GOOGLE_YOUTUBE_REFRESH_TOKEN or GOOGLE_REFRESH_TOKEN (+ youtube.readonly)",
      );
    }
    await ensureAccessToken(auth);
    const yt = youtubeApi(auth);
    let state = this.parseState(checkpoint?.cursor);

    if (state.phase === "liked" && !this.includeLiked) {
      state = { phase: this.includePlaylists ? "playlists" : "done" };
    }

    if (state.phase === "liked") {
      const res = await yt.playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId: "LL",
        maxResults: Math.min(this.pageSize, 50),
        pageToken: state.pageToken,
      });
      const items: RawEnvelope[] = [];
      for (const it of res.data.items ?? []) {
        const videoId =
          it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
        if (!videoId || !it.id) continue;
        items.push(
          ...this.envelopeForItem({
            playlistId: "LL",
            playlistItemId: it.id,
            videoId,
            title: it.snippet?.title ?? undefined,
            description: it.snippet?.description ?? undefined,
            channelId: it.snippet?.videoOwnerChannelId ?? undefined,
            channelTitle: it.snippet?.videoOwnerChannelTitle ?? undefined,
            publishedAt: it.snippet?.publishedAt ?? undefined,
            position: it.snippet?.position ?? undefined,
            capture: "liked",
          }),
        );
      }
      if (res.data.nextPageToken) {
        return {
          items,
          nextCursor: this.encodeState({
            phase: "liked",
            pageToken: res.data.nextPageToken,
          }),
          hasMore: true,
        };
      }
      return {
        items,
        nextCursor: this.encodeState(
          this.includePlaylists
            ? { phase: "playlists" }
            : { phase: "done" },
        ),
        hasMore: this.includePlaylists,
      };
    }

    if (state.phase === "playlists") {
      const res = await yt.playlists.list({
        part: ["snippet", "contentDetails"],
        mine: true,
        maxResults: Math.min(this.pageSize, 50),
        pageToken: state.playlistPageToken,
      });
      const playlists = (res.data.items ?? []).filter(
        (p) => p.id && p.id !== "LL",
      );
      if (playlists.length === 0) {
        if (res.data.nextPageToken) {
          return {
            items: [],
            nextCursor: this.encodeState({
              phase: "playlists",
              playlistPageToken: res.data.nextPageToken,
            }),
            hasMore: true,
          };
        }
        return {
          items: [],
          nextCursor: this.encodeState({ phase: "done" }),
          hasMore: false,
        };
      }
      const first = playlists[0]!;
      // Continue remaining playlists on this page via playlistPageToken trick:
      // re-list with same token and skip until after first — simpler: advance by
      // storing next playlist via a secondary index. For MVP, process one playlist
      // per page fetch and re-fetch list with pageToken only when first on page done.
      return {
        items: [],
        nextCursor: this.encodeState({
          phase: "playlist_items",
          playlistId: first.id!,
          playlistTitle: first.snippet?.title ?? undefined,
          playlistPageToken: state.playlistPageToken,
          pageToken: undefined,
        }),
        hasMore: true,
      };
    }

    if (state.phase === "playlist_items" && state.playlistId) {
      const res = await yt.playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId: state.playlistId,
        maxResults: Math.min(this.pageSize, 50),
        pageToken: state.pageToken,
      });
      const items: RawEnvelope[] = [];
      for (const it of res.data.items ?? []) {
        const videoId =
          it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
        if (!videoId || !it.id) continue;
        items.push(
          ...this.envelopeForItem({
            playlistId: state.playlistId,
            playlistItemId: it.id,
            videoId,
            title: it.snippet?.title ?? undefined,
            description: it.snippet?.description ?? undefined,
            channelId: it.snippet?.videoOwnerChannelId ?? undefined,
            channelTitle: it.snippet?.videoOwnerChannelTitle ?? undefined,
            publishedAt: it.snippet?.publishedAt ?? undefined,
            position: it.snippet?.position ?? undefined,
            capture: "playlist",
          }),
        );
      }
      if (res.data.nextPageToken) {
        return {
          items,
          nextCursor: this.encodeState({
            ...state,
            pageToken: res.data.nextPageToken,
          }),
          hasMore: true,
        };
      }
      // Move to next playlist page — re-fetch playlists and skip current id
      const listRes = await yt.playlists.list({
        part: ["snippet"],
        mine: true,
        maxResults: Math.min(this.pageSize, 50),
        pageToken: state.playlistPageToken,
      });
      const list = (listRes.data.items ?? []).filter(
        (p) => p.id && p.id !== "LL",
      );
      const idx = list.findIndex((p) => p.id === state.playlistId);
      const nextPl = idx >= 0 ? list[idx + 1] : undefined;
      if (nextPl?.id) {
        return {
          items,
          nextCursor: this.encodeState({
            phase: "playlist_items",
            playlistId: nextPl.id,
            playlistTitle: nextPl.snippet?.title ?? undefined,
            playlistPageToken: state.playlistPageToken,
          }),
          hasMore: true,
        };
      }
      if (listRes.data.nextPageToken) {
        return {
          items,
          nextCursor: this.encodeState({
            phase: "playlists",
            playlistPageToken: listRes.data.nextPageToken,
          }),
          hasMore: true,
        };
      }
      return {
        items,
        nextCursor: this.encodeState({ phase: "done" }),
        hasMore: false,
      };
    }

    return { items: [], nextCursor: null, hasMore: false };
  }

  private envelopeForItem(item: YoutubePlaylistItemInput): RawEnvelope[] {
    const mapped = mapYoutubePlaylistItem(item);
    return [
      this.videoEnvelope(mapped.video.body, mapped.video.summary),
      this.watchEnvelope(
        mapped.watch.body,
        mapped.watch.summary,
        mapped.watch.sourceRecordId,
        "api",
      ),
    ];
  }

  private videoEnvelope(
    body: YoutubeVideoEnvelopeBody,
    summary: YoutubeVideoSummary,
  ): RawEnvelope {
    return {
      source: "youtube",
      sourceRecordId: videoSourceRecordId(body.videoId),
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: googleAccountKey(),
        extra: {
          kind: "youtube_video_summary",
          accountKey: googleAccountKey(),
          mock: this.useMock(),
          captureMode: "api",
          playlistItemId: body.playlistItemId,
          summary,
        },
      },
    };
  }

  private watchEnvelope(
    body: YoutubeWatchEnvelopeBody,
    summary: YoutubeWatchSummary,
    sourceRecordId: string,
    captureMode: "api" | "takeout",
  ): RawEnvelope {
    return {
      source: "youtube",
      sourceRecordId,
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: googleAccountKey(),
        extra: {
          kind: "youtube_watch_summary",
          accountKey: googleAccountKey(),
          mock: this.useMock(),
          captureMode,
          summary,
        },
      },
    };
  }
}

export interface YoutubeTakeoutAdapterOptions {
  exportPath?: string;
  pageSize?: number;
  limit?: number;
  collectorName?: string;
  mock?: boolean;
}

/**
 * Google Takeout watch-history parser.
 * Emits `youtube_watch` envelopes. Requires `--path=` unless mock.
 */
export class YoutubeTakeoutAdapter implements SourceAdapter {
  readonly source = "youtube" as const;

  private readonly exportPath: string | undefined;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private readonly forceMock: boolean;
  private cache: TakeoutWatchRow[] | null = null;
  private cachePath: string | null = null;

  constructor(options: YoutubeTakeoutAdapterOptions = {}) {
    this.exportPath = options.exportPath;
    this.pageSize = options.pageSize ?? 100;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-youtube-takeout";
    this.forceMock = options.mock === true;
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (this.forceMock || (!this.exportPath && shouldUseYoutubeGoogleMock())) {
      return {
        ok: true,
        detail: `mock takeout — ${mockTakeoutWatches().length} watch row(s)`,
      };
    }
    if (!this.exportPath) {
      return {
        ok: false,
        detail: "exportPath required (--path= to Takeout ZIP/folder)",
      };
    }
    try {
      const loaded = await this.load();
      return {
        ok: true,
        detail: `takeout ${loaded.rows.length} watch row(s) from ${loaded.files.length} file(s)`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    const rows = await this.rows();
    const start = checkpoint?.cursor ? Number(checkpoint.cursor) || 0 : 0;
    const slice = rows.slice(start, start + this.pageSize);
    const items = slice
      .map((r) => this.envelopeFor(r))
      .filter((e): e is RawEnvelope => e != null);
    const next = start + slice.length;
    const hasMore = next < rows.length;
    return {
      items,
      nextCursor: hasMore ? String(next) : null,
      hasMore,
    };
  }

  async backfillAll(): Promise<RawEnvelope[]> {
    const rows = await this.rows();
    const out: RawEnvelope[] = [];
    for (const row of rows) {
      const env = this.envelopeFor(row);
      if (env) out.push(env);
      if (this.limit != null && out.length >= this.limit) break;
    }
    return out;
  }

  private async load(): Promise<{
    rows: TakeoutWatchRow[];
    files: string[];
  }> {
    if (this.forceMock || (!this.exportPath && shouldUseYoutubeGoogleMock())) {
      return { rows: mockTakeoutWatches(), files: ["mock:watch-history"] };
    }
    if (!this.exportPath) {
      throw new Error("YoutubeTakeoutAdapter requires exportPath");
    }
    const loaded = await loadYoutubeTakeout(this.exportPath);
    return { rows: loaded.rows, files: loaded.files };
  }

  private async rows(): Promise<TakeoutWatchRow[]> {
    if (this.cache) return this.cache;
    const loaded = await this.load();
    this.cache = loaded.rows;
    this.cachePath = loaded.files[0] ?? null;
    return this.cache;
  }

  private envelopeFor(row: TakeoutWatchRow): RawEnvelope | null {
    const input = takeoutRowToWatchInput(row);
    if (!input) return null;
    const mapped = mapTakeoutWatch(input);
    return {
      source: "youtube",
      sourceRecordId: mapped.sourceRecordId,
      occurredAt: mapped.summary.occurredAt,
      mimeType: "application/json",
      body: mapped.body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: googleAccountKey(),
        extra: {
          kind: "youtube_watch_summary",
          accountKey: googleAccountKey(),
          mock: this.forceMock || !this.exportPath,
          captureMode: "takeout",
          exportPath: this.cachePath ?? this.exportPath ?? null,
          summary: mapped.summary,
        },
      },
    };
  }
}

export function createYoutubeAdapter(
  options?: YoutubeAdapterOptions,
): SourceAdapter {
  return new YoutubeAdapter(options);
}

export function createYoutubeTakeoutAdapter(
  options?: YoutubeTakeoutAdapterOptions,
): SourceAdapter {
  return new YoutubeTakeoutAdapter(options);
}
