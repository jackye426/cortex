/**
 * Minimal Spotify Web API client (official HTTPS only — no scraping).
 */

import {
  ensureSpotifyAccessToken,
  type SpotifyAuthConfig,
} from "./auth.js";

const API_BASE = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

export class SpotifyClient {
  constructor(private readonly config: SpotifyAuthConfig) {}

  async get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const token = await ensureSpotifyAccessToken(this.config);
    const url = new URL(`${API_BASE}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      // Force one refresh retry
      this.config.accessToken = undefined;
      const retryToken = await ensureSpotifyAccessToken(this.config);
      const retry = await fetch(url, {
        headers: { Authorization: `Bearer ${retryToken}` },
      });
      if (!retry.ok) {
        const text = await retry.text();
        throw new SpotifyApiError(
          `Spotify GET ${path} failed (${retry.status})`,
          retry.status,
          text,
        );
      }
      return (await retry.json()) as T;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new SpotifyApiError(
        `Spotify GET ${path} failed (${res.status})`,
        res.status,
        text,
      );
    }
    return (await res.json()) as T;
  }
}

export interface SpotifyPaging<T> {
  items: T[];
  next: string | null;
  total?: number;
  limit?: number;
  offset?: number;
  cursors?: { after?: string; before?: string };
}

export interface SpotifyArtistRef {
  id?: string;
  name?: string;
  uri?: string;
}

export interface SpotifyAlbumRef {
  id?: string;
  name?: string;
  uri?: string;
}

export interface SpotifyTrackObject {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  explicit?: boolean;
  artists?: SpotifyArtistRef[];
  album?: SpotifyAlbumRef;
  external_urls?: { spotify?: string };
}

export interface SpotifySavedTrackItem {
  added_at?: string;
  track?: SpotifyTrackObject | null;
}

export interface SpotifyPlaylistObject {
  id?: string;
  name?: string;
  uri?: string;
  snapshot_id?: string;
  tracks?: { total?: number; href?: string };
  owner?: { id?: string; display_name?: string };
}

export interface SpotifyPlaylistTrackItem {
  added_at?: string;
  track?: SpotifyTrackObject | null;
}

export interface SpotifyShowObject {
  id?: string;
  uri?: string;
  name?: string;
  description?: string;
  publisher?: string;
  total_episodes?: number;
  explicit?: boolean;
  media_type?: string;
  external_urls?: { spotify?: string };
  /** Present on full show objects from /shows/{id}. */
  episodes?: SpotifyPaging<SpotifyEpisodeObject>;
}

export interface SpotifySavedShowItem {
  added_at?: string;
  show?: SpotifyShowObject | null;
}

export interface SpotifyEpisodeObject {
  id?: string;
  uri?: string;
  name?: string;
  description?: string;
  duration_ms?: number;
  explicit?: boolean;
  release_date?: string;
  release_date_precision?: string;
  language?: string;
  languages?: string[];
  type?: string;
  external_urls?: { spotify?: string };
  show?: SpotifyShowObject | null;
}

export interface SpotifySavedEpisodeItem {
  added_at?: string;
  episode?: SpotifyEpisodeObject | null;
}

/**
 * Recently-played item. Official docs historically return tracks only; when
 * podcast plays appear they may be episode-shaped under `track` (type=episode)
 * or a dedicated `episode` field depending on API version.
 */
export interface SpotifyPlayHistoryItem {
  played_at?: string;
  track?: (SpotifyTrackObject & { type?: string }) | SpotifyEpisodeObject | null;
  episode?: SpotifyEpisodeObject | null;
  context?: { type?: string; uri?: string } | null;
}
