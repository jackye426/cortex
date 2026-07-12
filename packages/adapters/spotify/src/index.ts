/**
 * Phase 5b — Spotify Web API adapter (library + playlists + recently played).
 * Official OAuth only; no scraping. Deep historical listening uses privacy export
 * via SpotifyExportAdapter (`--source=spotify-export`).
 */

import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import {
  loadSpotifyAuthConfigFromEnv,
  shouldUseSpotifyMock,
  spotifyAccountKey,
  type SpotifyAuthConfig,
} from "./auth.js";
import {
  SpotifyApiError,
  SpotifyClient,
  type SpotifyEpisodeObject,
  type SpotifyPaging,
  type SpotifyPlayHistoryItem,
  type SpotifyPlaylistObject,
  type SpotifyPlaylistTrackItem,
  type SpotifySavedEpisodeItem,
  type SpotifySavedShowItem,
  type SpotifySavedTrackItem,
  type SpotifyShowObject,
} from "./client.js";
import {
  exportRowToPlayInput,
  loadSpotifyPrivacyExport,
  type StreamingHistoryRow,
} from "./export.js";
import {
  episodePlaySourceRecordId,
  episodeSourceRecordId,
  isEpisodeLike,
  mapExportPlayRow,
  mapSpotifyEpisode,
  mapSpotifyPlay,
  mapSpotifyShow,
  mapSpotifyTrack,
  playSourceRecordId,
  showSourceRecordId,
  trackSourceRecordId,
  type SpotifyEpisodeEnvelopeBody,
  type SpotifyEpisodeSummary,
  type SpotifyPlayEnvelopeBody,
  type SpotifyPlaySummary,
  type SpotifyShowEnvelopeBody,
  type SpotifyShowSummary,
  type SpotifyTrackEnvelopeBody,
  type SpotifyTrackSummary,
} from "./map.js";
import {
  mockRecentlyPlayed,
  mockSavedEpisodes,
  mockSavedShows,
  mockSavedTracks,
  mockShowEpisodes,
  mockStreamingHistory,
} from "./mock.js";

export type {
  SpotifyEpisodeEnvelopeBody,
  SpotifyEpisodeSummary,
  SpotifyPlayEnvelopeBody,
  SpotifyPlaySummary,
  SpotifyShowEnvelopeBody,
  SpotifyShowSummary,
  SpotifyTrackEnvelopeBody,
  SpotifyTrackSummary,
} from "./map.js";
export {
  episodePlaySourceRecordId,
  episodeSourceRecordId,
  episodeUriOf,
  exportPlaySourceRecordId,
  isEpisodeLike,
  mapExportPlayRow,
  mapSpotifyEpisode,
  mapSpotifyPlay,
  mapSpotifyShow,
  mapSpotifyTrack,
  playSourceRecordId,
  showSourceRecordId,
  showUriOf,
  toIsoPlayedAt,
  trackSourceRecordId,
  trackUriOf,
} from "./map.js";
export {
  exportRowToPlayInput,
  loadSpotifyPrivacyExport,
  type StreamingHistoryRow,
} from "./export.js";
export {
  isSpotifyConfigured,
  isSpotifyMockForced,
  loadSpotifyAuthConfigFromEnv,
  shouldUseSpotifyMock,
  SPOTIFY_SCOPES,
  spotifyAccountKey,
} from "./auth.js";

export interface SpotifyAdapterOptions {
  pageSize?: number;
  limit?: number;
  collectorName?: string;
  mock?: boolean;
  /** Include followed/saved shows (default true; podcast priority). */
  includeShows?: boolean;
  /** Recent episodes per saved show via /shows/{id}/episodes (default true). */
  includeShowEpisodes?: boolean;
  /** Max recent episodes per show (default 15; capped at 20). */
  episodesPerShow?: number;
  /** Include user-saved episodes from /me/episodes (default true). */
  includeSavedEpisodes?: boolean;
  /** Include playlist tracks (default true). */
  includePlaylists?: boolean;
  /** Include recently played (default true). */
  includeRecentlyPlayed?: boolean;
  /** Include saved library tracks (default true). */
  includeLibrary?: boolean;
}

interface ShowQueueItem {
  id: string;
  name?: string;
  uri?: string;
  publisher?: string;
}

interface SyncState {
  phase:
    | "shows"
    | "show_episodes"
    | "saved_episodes"
    | "library"
    | "playlists"
    | "playlist_tracks"
    | "recent"
    | "done";
  offset?: number;
  showOffset?: number;
  showQueue?: ShowQueueItem[];
  showId?: string;
  showName?: string;
  showUri?: string;
  showPublisher?: string;
  playlistOffset?: number;
  playlistId?: string;
  playlistName?: string;
  afterMs?: number;
}

/**
 * Spotify Web API adapter.
 *
 * Historical: followed shows (+ recent episodes), saved episodes, saved tracks,
 * playlists (paginated). Podcasts are fetched before music library.
 * Ongoing: recently-played with `after` cursor (unix ms); episode items mapped
 * when the API returns them.
 */
export class SpotifyAdapter implements SourceAdapter {
  readonly source = "spotify" as const;

  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private readonly forceMock: boolean;
  private readonly includeShows: boolean;
  private readonly includeShowEpisodes: boolean;
  private readonly episodesPerShow: number;
  private readonly includeSavedEpisodes: boolean;
  private readonly includePlaylists: boolean;
  private readonly includeRecentlyPlayed: boolean;
  private readonly includeLibrary: boolean;
  private config: SpotifyAuthConfig | null = null;

  constructor(options: SpotifyAdapterOptions = {}) {
    this.pageSize = options.pageSize ?? 50;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-spotify";
    this.forceMock = options.mock === true;
    this.includeShows = options.includeShows !== false;
    this.includeShowEpisodes = options.includeShowEpisodes !== false;
    this.episodesPerShow = Math.min(
      Math.max(options.episodesPerShow ?? 15, 1),
      20,
    );
    this.includeSavedEpisodes = options.includeSavedEpisodes !== false;
    this.includePlaylists = options.includePlaylists !== false;
    this.includeRecentlyPlayed = options.includeRecentlyPlayed !== false;
    this.includeLibrary = options.includeLibrary !== false;
  }

  private useMock(): boolean {
    return this.forceMock || shouldUseSpotifyMock();
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (this.useMock()) {
      return {
        ok: true,
        detail: `mock mode — ${mockSavedShows().length} show(s), ${mockShowEpisodes().length + mockSavedEpisodes().length} episode(s), ${mockSavedTracks().length} saved track(s), ${mockRecentlyPlayed().length} recent play(s)`,
      };
    }
    try {
      const client = this.client();
      const me = await client.get<{ id?: string; display_name?: string }>("/me");
      return {
        ok: true,
        detail: `live Spotify ${me.display_name ?? me.id ?? "me"}`,
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
      return this.mockEnvelopes();
    }
    const items: RawEnvelope[] = [];
    let cursor: string | undefined;
    let guard = 0;
    while (guard++ < 500) {
      const page = await this.fetchLivePage(
        cursor
          ? {
              source: "spotify",
              accountKey: spotifyAccountKey(),
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

  private client(): SpotifyClient {
    if (!this.config) {
      this.config = loadSpotifyAuthConfigFromEnv();
    }
    if (!this.config) {
      throw new Error(
        "Spotify live mode requires SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN",
      );
    }
    return new SpotifyClient(this.config);
  }

  private parseState(cursor?: string): SyncState {
    if (!cursor) return { phase: "shows", offset: 0 };
    try {
      return JSON.parse(cursor) as SyncState;
    } catch {
      return { phase: "done" };
    }
  }

  private encodeState(state: SyncState): string {
    return JSON.stringify(state);
  }

  /** Next phase after podcast ingestion (or when podcasts are disabled). */
  private afterPodcastsPhase(): SyncState {
    if (this.includeLibrary) return { phase: "library", offset: 0 };
    if (this.includePlaylists) return { phase: "playlists", playlistOffset: 0 };
    if (this.includeRecentlyPlayed) return { phase: "recent" };
    return { phase: "done" };
  }

  private afterSavedEpisodesPhase(): SyncState {
    return this.afterPodcastsPhase();
  }

  private afterShowsPhase(showOffset: number, hasMoreShows: boolean): SyncState {
    if (hasMoreShows) {
      return { phase: "shows", offset: showOffset };
    }
    if (this.includeSavedEpisodes) {
      return { phase: "saved_episodes", offset: 0 };
    }
    return this.afterPodcastsPhase();
  }

  private phaseAfterLibrary(): SyncState {
    if (this.includePlaylists) return { phase: "playlists", playlistOffset: 0 };
    if (this.includeRecentlyPlayed) return { phase: "recent" };
    return { phase: "done" };
  }

  private mockEnvelopes(): RawEnvelope[] {
    const out: RawEnvelope[] = [];
    for (const item of mockSavedShows()) {
      if (!item.show) continue;
      const mapped = mapSpotifyShow({
        show: item.show,
        addedAt: item.added_at,
      });
      if (mapped) out.push(this.showEnvelope(mapped.body, mapped.summary));
    }
    for (const ep of mockShowEpisodes()) {
      const mapped = mapSpotifyEpisode({
        episode: ep,
        show: ep.show,
        capture: "show_feed",
      });
      if (mapped) out.push(this.episodeEnvelope(mapped.body, mapped.summary));
    }
    for (const item of mockSavedEpisodes()) {
      if (!item.episode) continue;
      const mapped = mapSpotifyEpisode({
        episode: item.episode,
        addedAt: item.added_at,
        capture: "library",
      });
      if (mapped) out.push(this.episodeEnvelope(mapped.body, mapped.summary));
    }
    for (const item of mockSavedTracks()) {
      if (!item.track) continue;
      const mapped = mapSpotifyTrack({
        track: item.track,
        addedAt: item.added_at,
        capture: "library",
      });
      if (mapped) out.push(this.trackEnvelope(mapped.body, mapped.summary));
    }
    for (const item of mockRecentlyPlayed()) {
      if (!item.played_at) continue;
      const episodeObj =
        item.episode ??
        (isEpisodeLike(item.track) ? item.track : null);
      if (episodeObj) {
        const mapped = mapSpotifyEpisode({
          episode: episodeObj,
          playedAt: item.played_at,
          contextUri: item.context?.uri ?? undefined,
          contextType: item.context?.type ?? undefined,
          capture: "recently_played",
        });
        if (mapped) {
          out.push(
            this.episodeEnvelope(mapped.body, mapped.summary, {
              playKeyed: true,
            }),
          );
        }
        continue;
      }
      if (!item.track || isEpisodeLike(item.track)) continue;
      const mapped = mapSpotifyPlay({
        track: item.track,
        playedAt: item.played_at,
        contextUri: item.context?.uri,
        contextType: item.context?.type,
        capture: "recently_played",
      });
      if (mapped) out.push(this.playEnvelope(mapped.body, mapped.summary));
    }
    if (this.limit != null) return out.slice(0, this.limit);
    return out;
  }

  private fetchMockPage(checkpoint?: SyncCheckpoint): AdapterPage {
    const all = this.mockEnvelopes();
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
    const client = this.client();
    let state = this.parseState(checkpoint?.cursor);

    // Skip disabled phases (legacy checkpoints may start at library).
    if (state.phase === "shows" && !this.includeShows) {
      state = this.includeSavedEpisodes
        ? { phase: "saved_episodes", offset: 0 }
        : this.afterPodcastsPhase();
    }
    if (state.phase === "show_episodes" && !this.includeShowEpisodes) {
      state = this.afterShowsPhase(state.showOffset ?? state.offset ?? 0, false);
    }
    if (state.phase === "saved_episodes" && !this.includeSavedEpisodes) {
      state = this.afterPodcastsPhase();
    }
    if (state.phase === "library" && !this.includeLibrary) {
      state = this.phaseAfterLibrary();
    }
    if (state.phase === "playlists" && !this.includePlaylists) {
      state = this.includeRecentlyPlayed
        ? { phase: "recent" }
        : { phase: "done" };
    }
    if (state.phase === "recent" && !this.includeRecentlyPlayed) {
      state = { phase: "done" };
    }

    if (state.phase === "done") {
      return { items: [], nextCursor: null, hasMore: false };
    }

    if (state.phase === "shows") {
      return this.fetchShowsPage(client, state);
    }
    if (state.phase === "show_episodes") {
      return this.fetchShowEpisodesPage(client, state);
    }
    if (state.phase === "saved_episodes") {
      return this.fetchSavedEpisodesPage(client, state);
    }

    if (state.phase === "library") {
      const offset = state.offset ?? 0;
      const page = await client.get<SpotifyPaging<SpotifySavedTrackItem>>(
        "/me/tracks",
        { limit: this.pageSize, offset },
      );
      const items: RawEnvelope[] = [];
      for (const item of page.items ?? []) {
        if (!item.track?.uri && !item.track?.id) continue;
        const mapped = mapSpotifyTrack({
          track: item.track!,
          addedAt: item.added_at,
          capture: "library",
        });
        if (mapped) items.push(this.trackEnvelope(mapped.body, mapped.summary));
      }
      const nextOffset = offset + (page.items?.length ?? 0);
      const hasMore = Boolean(page.next) || nextOffset < (page.total ?? 0);
      if (hasMore) {
        return {
          items,
          nextCursor: this.encodeState({
            phase: "library",
            offset: nextOffset,
          }),
          hasMore: true,
        };
      }
      const next = this.phaseAfterLibrary();
      return {
        items,
        nextCursor: this.encodeState(next),
        hasMore: next.phase !== "done",
      };
    }

    if (state.phase === "playlists") {
      const offset = state.playlistOffset ?? 0;
      const page = await client.get<SpotifyPaging<SpotifyPlaylistObject>>(
        "/me/playlists",
        { limit: Math.min(this.pageSize, 50), offset },
      );
      const playlists = (page.items ?? []).filter((p) => p.id);
      if (playlists.length === 0) {
        return {
          items: [],
          nextCursor: this.encodeState(
            this.includeRecentlyPlayed
              ? { phase: "recent" }
              : { phase: "done" },
          ),
          hasMore: this.includeRecentlyPlayed,
        };
      }
      const first = playlists[0]!;
      return {
        items: [],
        nextCursor: this.encodeState({
          phase: "playlist_tracks",
          playlistId: first.id,
          playlistName: first.name,
          offset: 0,
          playlistOffset: offset + 1,
        }),
        hasMore: true,
      };
    }

    if (state.phase === "playlist_tracks" && state.playlistId) {
      const offset = state.offset ?? 0;
      let page: SpotifyPaging<SpotifyPlaylistTrackItem>;
      try {
        page = await client.get<SpotifyPaging<SpotifyPlaylistTrackItem>>(
          `/playlists/${state.playlistId}/tracks`,
          { limit: this.pageSize, offset },
        );
      } catch (err) {
        // Collaborative / region-restricted playlists can 403; skip and continue.
        if (
          err instanceof SpotifyApiError &&
          (err.status === 403 || err.status === 404)
        ) {
          console.warn(
            `[spotify] skip playlist ${state.playlistId} (${err.status})`,
          );
          return this.advanceAfterPlaylist(client, state, []);
        }
        throw err;
      }
      const items: RawEnvelope[] = [];
      for (const item of page.items ?? []) {
        if (!item.track?.uri && !item.track?.id) continue;
        // Skip local / episode placeholders without track uri
        if (!item.track?.uri?.startsWith("spotify:track:")) continue;
        const mapped = mapSpotifyTrack({
          track: item.track,
          addedAt: item.added_at,
          playlistId: state.playlistId,
          playlistName: state.playlistName,
          capture: "playlist",
        });
        if (mapped) items.push(this.trackEnvelope(mapped.body, mapped.summary));
      }
      const nextOffset = offset + (page.items?.length ?? 0);
      const hasMoreTracks =
        Boolean(page.next) || nextOffset < (page.total ?? 0);
      if (hasMoreTracks) {
        return {
          items,
          nextCursor: this.encodeState({
            ...state,
            offset: nextOffset,
          }),
          hasMore: true,
        };
      }
      return this.advanceAfterPlaylist(client, state, items);
    }

    // recent — tracks as spotify_play; episodes as spotify_episode when present
    const query: Record<string, string | number | undefined> = {
      limit: Math.min(this.pageSize, 50),
    };
    if (state.afterMs != null) query.after = state.afterMs;
    const page = await client.get<{
      items?: SpotifyPlayHistoryItem[];
      cursors?: { after?: string; before?: string };
      next?: string | null;
    }>("/me/player/recently-played", query);
    const items: RawEnvelope[] = [];
    let maxPlayedMs = state.afterMs ?? 0;
    for (const item of page.items ?? []) {
      if (!item.played_at) continue;
      const episodeObj =
        item.episode ?? (isEpisodeLike(item.track) ? item.track : null);
      if (episodeObj) {
        const mapped = mapSpotifyEpisode({
          episode: episodeObj,
          playedAt: item.played_at,
          contextUri: item.context?.uri ?? undefined,
          contextType: item.context?.type ?? undefined,
          capture: "recently_played",
        });
        if (mapped) {
          items.push(
            this.episodeEnvelope(mapped.body, mapped.summary, {
              playKeyed: true,
            }),
          );
        }
      } else if (item.track && !isEpisodeLike(item.track)) {
        const mapped = mapSpotifyPlay({
          track: item.track,
          playedAt: item.played_at,
          contextUri: item.context?.uri ?? undefined,
          contextType: item.context?.type ?? undefined,
          capture: "recently_played",
        });
        if (mapped) items.push(this.playEnvelope(mapped.body, mapped.summary));
      }
      const t = Date.parse(item.played_at);
      if (Number.isFinite(t) && t > maxPlayedMs) maxPlayedMs = t;
    }
    const hasMore = Boolean(page.next) || Boolean(page.cursors?.after);
    if (hasMore && page.cursors?.after) {
      return {
        items,
        nextCursor: this.encodeState({
          phase: "recent",
          afterMs: Number(page.cursors.after) || maxPlayedMs,
        }),
        hasMore: true,
      };
    }
    return {
      items,
      nextCursor: this.encodeState({ phase: "done", afterMs: maxPlayedMs }),
      hasMore: false,
    };
  }

  private async fetchShowsPage(
    client: SpotifyClient,
    state: SyncState,
  ): Promise<AdapterPage> {
    const offset = state.offset ?? 0;
    let page: SpotifyPaging<SpotifySavedShowItem>;
    try {
      page = await client.get<SpotifyPaging<SpotifySavedShowItem>>("/me/shows", {
        limit: Math.min(this.pageSize, 50),
        offset,
      });
    } catch (err) {
      if (err instanceof SpotifyApiError && err.status === 403) {
        console.warn(
          "[spotify] /me/shows returned 403 — refresh token may lack user-library-read; re-run OAuth and re-consent",
        );
        throw err;
      }
      throw err;
    }

    const items: RawEnvelope[] = [];
    const queue: ShowQueueItem[] = [];
    for (const item of page.items ?? []) {
      if (!item.show?.id && !item.show?.uri) continue;
      const mapped = mapSpotifyShow({
        show: item.show!,
        addedAt: item.added_at,
      });
      if (mapped) items.push(this.showEnvelope(mapped.body, mapped.summary));
      if (item.show?.id) {
        queue.push({
          id: item.show.id,
          name: item.show.name,
          uri: item.show.uri,
          publisher: item.show.publisher,
        });
      }
    }

    const nextOffset = offset + (page.items?.length ?? 0);
    const hasMoreShows = Boolean(page.next) || nextOffset < (page.total ?? 0);

    if (this.includeShowEpisodes && queue.length > 0) {
      return {
        items,
        nextCursor: this.encodeState({
          phase: "show_episodes",
          showQueue: queue,
          showOffset: nextOffset,
          // Preserve hasMoreShows via showOffset vs continuing shows phase
        }),
        hasMore: true,
      };
    }

    if (hasMoreShows) {
      return {
        items,
        nextCursor: this.encodeState({ phase: "shows", offset: nextOffset }),
        hasMore: true,
      };
    }

    const next = this.afterShowsPhase(nextOffset, false);
    return {
      items,
      nextCursor: this.encodeState(next),
      hasMore: next.phase !== "done",
    };
  }

  private async fetchShowEpisodesPage(
    client: SpotifyClient,
    state: SyncState,
  ): Promise<AdapterPage> {
    const queue = [...(state.showQueue ?? [])];
    const current = queue.shift();
    if (!current?.id) {
      return this.advanceAfterShowEpisodes(client, state, [], queue);
    }

    const showMeta: SpotifyShowObject = {
      id: current.id,
      name: current.name,
      uri: current.uri,
      publisher: current.publisher,
    };

    let page: SpotifyPaging<SpotifyEpisodeObject>;
    try {
      page = await client.get<SpotifyPaging<SpotifyEpisodeObject>>(
        `/shows/${current.id}/episodes`,
        { limit: this.episodesPerShow, offset: 0 },
      );
    } catch (err) {
      if (
        err instanceof SpotifyApiError &&
        (err.status === 403 || err.status === 404)
      ) {
        console.warn(
          `[spotify] skip show episodes ${current.id} (${err.status})`,
        );
        return this.advanceAfterShowEpisodes(client, state, [], queue);
      }
      throw err;
    }

    const items: RawEnvelope[] = [];
    for (const ep of page.items ?? []) {
      if (!ep?.uri && !ep?.id) continue;
      const mapped = mapSpotifyEpisode({
        episode: ep,
        show: ep.show ?? showMeta,
        capture: "show_feed",
      });
      if (mapped) items.push(this.episodeEnvelope(mapped.body, mapped.summary));
    }

    return this.advanceAfterShowEpisodes(client, state, items, queue);
  }

  private async advanceAfterShowEpisodes(
    client: SpotifyClient,
    state: SyncState,
    items: RawEnvelope[],
    remainingQueue: ShowQueueItem[],
  ): Promise<AdapterPage> {
    if (remainingQueue.length > 0) {
      return {
        items,
        nextCursor: this.encodeState({
          phase: "show_episodes",
          showQueue: remainingQueue,
          showOffset: state.showOffset ?? 0,
        }),
        hasMore: true,
      };
    }

    const showOffset = state.showOffset ?? 0;
    // Probe whether more saved shows remain after the page we just finished.
    let hasMoreShows = false;
    if (this.includeShows) {
      try {
        const probe = await client.get<SpotifyPaging<SpotifySavedShowItem>>(
          "/me/shows",
          { limit: 1, offset: showOffset },
        );
        hasMoreShows = (probe.items?.length ?? 0) > 0;
      } catch {
        hasMoreShows = false;
      }
    }

    const next = this.afterShowsPhase(showOffset, hasMoreShows);
    return {
      items,
      nextCursor: this.encodeState(next),
      hasMore: next.phase !== "done",
    };
  }

  private async fetchSavedEpisodesPage(
    client: SpotifyClient,
    state: SyncState,
  ): Promise<AdapterPage> {
    const offset = state.offset ?? 0;
    let page: SpotifyPaging<SpotifySavedEpisodeItem>;
    try {
      page = await client.get<SpotifyPaging<SpotifySavedEpisodeItem>>(
        "/me/episodes",
        { limit: Math.min(this.pageSize, 50), offset },
      );
    } catch (err) {
      if (err instanceof SpotifyApiError && err.status === 403) {
        console.warn(
          "[spotify] /me/episodes returned 403 — refresh token may lack user-library-read; re-run OAuth and re-consent",
        );
        throw err;
      }
      throw err;
    }

    const items: RawEnvelope[] = [];
    for (const item of page.items ?? []) {
      if (!item.episode?.uri && !item.episode?.id) continue;
      const mapped = mapSpotifyEpisode({
        episode: item.episode!,
        addedAt: item.added_at,
        capture: "library",
      });
      if (mapped) items.push(this.episodeEnvelope(mapped.body, mapped.summary));
    }

    const nextOffset = offset + (page.items?.length ?? 0);
    const hasMore = Boolean(page.next) || nextOffset < (page.total ?? 0);
    if (hasMore) {
      return {
        items,
        nextCursor: this.encodeState({
          phase: "saved_episodes",
          offset: nextOffset,
        }),
        hasMore: true,
      };
    }

    const next = this.afterSavedEpisodesPhase();
    return {
      items,
      nextCursor: this.encodeState(next),
      hasMore: next.phase !== "done",
    };
  }

  /** Move past the current playlist to the next list offset, or into recent/done. */
  private async advanceAfterPlaylist(
    client: SpotifyClient,
    state: SyncState,
    items: RawEnvelope[],
  ): Promise<AdapterPage> {
    const playlistOffset = state.playlistOffset ?? 0;
    const listProbe = await client.get<SpotifyPaging<SpotifyPlaylistObject>>(
      "/me/playlists",
      { limit: 1, offset: playlistOffset },
    );
    if ((listProbe.items?.length ?? 0) > 0) {
      return {
        items,
        nextCursor: this.encodeState({
          phase: "playlists",
          playlistOffset,
        }),
        hasMore: true,
      };
    }
    return {
      items,
      nextCursor: this.encodeState(
        this.includeRecentlyPlayed
          ? { phase: "recent" }
          : { phase: "done" },
      ),
      hasMore: this.includeRecentlyPlayed,
    };
  }

  private trackEnvelope(
    body: SpotifyTrackEnvelopeBody,
    summary: SpotifyTrackSummary,
  ): RawEnvelope {
    return {
      source: "spotify",
      sourceRecordId: trackSourceRecordId(body.trackUri),
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: spotifyAccountKey(),
        extra: {
          kind: "spotify_track_summary",
          accountKey: spotifyAccountKey(),
          mock: this.useMock(),
          captureMode: "api",
          summary,
        },
      },
    };
  }

  private showEnvelope(
    body: SpotifyShowEnvelopeBody,
    summary: SpotifyShowSummary,
  ): RawEnvelope {
    return {
      source: "spotify",
      sourceRecordId: showSourceRecordId(body.showUri),
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: spotifyAccountKey(),
        extra: {
          kind: "spotify_show_summary",
          accountKey: spotifyAccountKey(),
          mock: this.useMock(),
          captureMode: "api",
          summary,
        },
      },
    };
  }

  private episodeEnvelope(
    body: SpotifyEpisodeEnvelopeBody,
    summary: SpotifyEpisodeSummary,
    opts?: { playKeyed?: boolean },
  ): RawEnvelope {
    const sourceRecordId =
      opts?.playKeyed && body.playedAt
        ? episodePlaySourceRecordId(body.playedAt, body.episodeUri)
        : episodeSourceRecordId(body.episodeUri);
    return {
      source: "spotify",
      sourceRecordId,
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: spotifyAccountKey(),
        extra: {
          kind: "spotify_episode_summary",
          accountKey: spotifyAccountKey(),
          mock: this.useMock(),
          captureMode: "api",
          summary,
        },
      },
    };
  }

  private playEnvelope(
    body: SpotifyPlayEnvelopeBody,
    summary: SpotifyPlaySummary,
  ): RawEnvelope {
    return {
      source: "spotify",
      sourceRecordId: playSourceRecordId(body.playedAt, body.trackUri),
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: spotifyAccountKey(),
        extra: {
          kind: "spotify_play_summary",
          accountKey: spotifyAccountKey(),
          mock: this.useMock(),
          captureMode: "api",
          summary,
        },
      },
    };
  }
}

export interface SpotifyExportAdapterOptions {
  exportPath?: string;
  pageSize?: number;
  limit?: number;
  collectorName?: string;
  /** Force mock StreamingHistory rows (no path required). */
  mock?: boolean;
}

/**
 * Spotify privacy / account-data download parser (StreamingHistory*.json).
 * Emits `spotify_play` envelopes. Requires `--path=` unless mock.
 */
export class SpotifyExportAdapter implements SourceAdapter {
  readonly source = "spotify" as const;

  private readonly exportPath: string | undefined;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private readonly forceMock: boolean;
  private cache: StreamingHistoryRow[] | null = null;
  private cachePath: string | null = null;

  constructor(options: SpotifyExportAdapterOptions = {}) {
    this.exportPath = options.exportPath;
    this.pageSize = options.pageSize ?? 100;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-spotify-export";
    this.forceMock = options.mock === true;
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (this.forceMock || (!this.exportPath && shouldUseSpotifyMock())) {
      return {
        ok: true,
        detail: `mock privacy-export — ${mockStreamingHistory().length} StreamingHistory row(s)`,
      };
    }
    if (!this.exportPath) {
      return {
        ok: false,
        detail: "exportPath required (--path= to Spotify privacy ZIP/folder)",
      };
    }
    try {
      const loaded = await this.load();
      return {
        ok: true,
        detail: `privacy export ${loaded.rows.length} row(s) from ${loaded.files.length} file(s)`,
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
    rows: StreamingHistoryRow[];
    files: string[];
  }> {
    if (this.forceMock || (!this.exportPath && shouldUseSpotifyMock())) {
      return { rows: mockStreamingHistory(), files: ["mock:StreamingHistory"] };
    }
    if (!this.exportPath) {
      throw new Error("SpotifyExportAdapter requires exportPath");
    }
    const loaded = await loadSpotifyPrivacyExport(this.exportPath);
    return { rows: loaded.rows, files: loaded.files };
  }

  private async rows(): Promise<StreamingHistoryRow[]> {
    if (this.cache) return this.cache;
    const loaded = await this.load();
    this.cache = loaded.rows;
    this.cachePath = loaded.files[0] ?? null;
    return this.cache;
  }

  private envelopeFor(row: StreamingHistoryRow): RawEnvelope | null {
    const mapped = mapExportPlayRow(exportRowToPlayInput(row));
    if (!mapped) return null;
    return {
      source: "spotify",
      sourceRecordId: mapped.sourceRecordId,
      occurredAt: mapped.summary.occurredAt,
      mimeType: "application/json",
      body: mapped.body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: spotifyAccountKey(),
        extra: {
          kind: "spotify_play_summary",
          accountKey: spotifyAccountKey(),
          mock: this.forceMock || !this.exportPath,
          captureMode: "privacy-export",
          exportPath: this.cachePath ?? this.exportPath ?? null,
          summary: mapped.summary,
        },
      },
    };
  }
}

export function createSpotifyAdapter(
  options?: SpotifyAdapterOptions,
): SourceAdapter {
  return new SpotifyAdapter(options);
}

export function createSpotifyExportAdapter(
  options?: SpotifyExportAdapterOptions,
): SourceAdapter {
  return new SpotifyExportAdapter(options);
}
