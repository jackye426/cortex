/**
 * Spotify track / play / show / episode → raw envelope body + summary.
 */

import { createHash } from "node:crypto";
import type {
  SpotifyEpisodeObject,
  SpotifyShowObject,
  SpotifyTrackObject,
} from "./client.js";

export interface SpotifyTrackSummary {
  trackUri: string;
  trackId?: string;
  name?: string;
  artists?: string[];
  album?: string;
  addedAt?: string;
  playlistId?: string;
  playlistName?: string;
  occurredAt?: string;
}

export interface SpotifyPlaySummary {
  trackUri: string;
  trackId?: string;
  name?: string;
  artists?: string[];
  playedAt: string;
  occurredAt: string;
  sourceKind: "recently_played" | "privacy_export";
}

export interface SpotifyTrackEnvelopeBody {
  kind: "spotify_track";
  trackUri: string;
  trackId?: string;
  name?: string;
  artists?: { id?: string; name?: string; uri?: string }[];
  album?: { id?: string; name?: string; uri?: string };
  durationMs?: number;
  explicit?: boolean;
  externalUrl?: string;
  addedAt?: string;
  playlistId?: string;
  playlistName?: string;
  capture: "library" | "playlist";
}

export interface SpotifyPlayEnvelopeBody {
  kind: "spotify_play";
  trackUri: string;
  trackId?: string;
  name?: string;
  artists?: { id?: string; name?: string; uri?: string }[];
  album?: { id?: string; name?: string; uri?: string };
  playedAt: string;
  contextUri?: string;
  contextType?: string;
  capture: "recently_played" | "privacy_export";
  /** Original export fields when present. */
  export?: {
    endTime?: string;
    msPlayed?: number;
    trackName?: string;
    artistName?: string;
  };
}

export interface SpotifyShowSummary {
  showUri: string;
  showId?: string;
  name?: string;
  publisher?: string;
  addedAt?: string;
  occurredAt?: string;
}

export interface SpotifyEpisodeSummary {
  episodeUri: string;
  episodeId?: string;
  name?: string;
  showUri?: string;
  showName?: string;
  publisher?: string;
  releaseDate?: string;
  addedAt?: string;
  playedAt?: string;
  occurredAt?: string;
  capture: SpotifyEpisodeEnvelopeBody["capture"];
}

export interface SpotifyShowEnvelopeBody {
  kind: "spotify_show";
  showUri: string;
  showId?: string;
  name?: string;
  description?: string;
  publisher?: string;
  totalEpisodes?: number;
  explicit?: boolean;
  externalUrl?: string;
  addedAt?: string;
  capture: "library";
}

export interface SpotifyEpisodeEnvelopeBody {
  kind: "spotify_episode";
  episodeUri: string;
  episodeId?: string;
  name?: string;
  description?: string;
  durationMs?: number;
  explicit?: boolean;
  releaseDate?: string;
  externalUrl?: string;
  showUri?: string;
  showId?: string;
  showName?: string;
  publisher?: string;
  addedAt?: string;
  playedAt?: string;
  contextUri?: string;
  contextType?: string;
  capture: "library" | "show_feed" | "recently_played";
}

export function trackUriOf(track: SpotifyTrackObject | null | undefined): string | null {
  if (!track) return null;
  if (track.uri) return track.uri;
  if (track.id) return `spotify:track:${track.id}`;
  return null;
}

export function showUriOf(show: SpotifyShowObject | null | undefined): string | null {
  if (!show) return null;
  if (show.uri) return show.uri;
  if (show.id) return `spotify:show:${show.id}`;
  return null;
}

export function episodeUriOf(
  episode: SpotifyEpisodeObject | null | undefined,
): string | null {
  if (!episode) return null;
  if (episode.uri) return episode.uri;
  if (episode.id) return `spotify:episode:${episode.id}`;
  return null;
}

/** True when a recently-played `track` slot is actually an episode object. */
export function isEpisodeLike(
  obj: unknown,
): obj is SpotifyEpisodeObject {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (o.type === "episode") return true;
  if (typeof o.uri === "string" && o.uri.startsWith("spotify:episode:")) {
    return true;
  }
  // Episode objects carry a nested show; tracks carry artists/album.
  if (o.show != null && typeof o.show === "object" && !Array.isArray(o.artists)) {
    return true;
  }
  return false;
}

export function trackSourceRecordId(trackUri: string): string {
  return trackUri;
}

export function showSourceRecordId(showUri: string): string {
  return showUri;
}

export function episodeSourceRecordId(episodeUri: string): string {
  return episodeUri;
}

/** Recently-played episode plays keep played_at in the idempotency key. */
export function episodePlaySourceRecordId(
  playedAtIso: string,
  episodeUri: string,
): string {
  return `${playedAtIso}:${episodeUri}`;
}

export function playSourceRecordId(playedAtIso: string, trackUri: string): string {
  return `${playedAtIso}:${trackUri}`;
}

/** Stable id for privacy-export rows that may lack precise ISO timestamps. */
export function exportPlaySourceRecordId(row: {
  endTime?: string;
  trackName?: string;
  artistName?: string;
  msPlayed?: number;
  trackUri?: string;
}): string {
  if (row.endTime && row.trackUri) {
    return playSourceRecordId(toIsoPlayedAt(row.endTime), row.trackUri);
  }
  const hash = createHash("sha256")
    .update(
      [
        row.endTime ?? "",
        row.artistName ?? "",
        row.trackName ?? "",
        String(row.msPlayed ?? ""),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);
  return `export:${hash}`;
}

/** Spotify privacy export endTime is often "YYYY-MM-DD HH:MM" (UTC). */
export function toIsoPlayedAt(endTime: string): string {
  const trimmed = endTime.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // "2019-02-15 19:34" → treat as UTC
  const m = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/,
  );
  if (m) {
    const sec = m[2]!.length === 5 ? `${m[2]}:00` : m[2]!;
    const d = new Date(`${m[1]}T${sec}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
  return trimmed;
}

export function mapSpotifyTrack(input: {
  track: SpotifyTrackObject;
  addedAt?: string;
  playlistId?: string;
  playlistName?: string;
  capture: "library" | "playlist";
}): { body: SpotifyTrackEnvelopeBody; summary: SpotifyTrackSummary } | null {
  const uri = trackUriOf(input.track);
  if (!uri) return null;

  const artists = (input.track.artists ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    uri: a.uri,
  }));
  const artistNames = artists
    .map((a) => a.name)
    .filter((n): n is string => Boolean(n));

  const body: SpotifyTrackEnvelopeBody = {
    kind: "spotify_track",
    trackUri: uri,
    trackId: input.track.id,
    name: input.track.name,
    artists,
    album: input.track.album
      ? {
          id: input.track.album.id,
          name: input.track.album.name,
          uri: input.track.album.uri,
        }
      : undefined,
    durationMs: input.track.duration_ms,
    explicit: input.track.explicit,
    externalUrl: input.track.external_urls?.spotify,
    addedAt: input.addedAt,
    playlistId: input.playlistId,
    playlistName: input.playlistName,
    capture: input.capture,
  };

  const summary: SpotifyTrackSummary = {
    trackUri: uri,
    trackId: input.track.id,
    name: input.track.name,
    artists: artistNames,
    album: input.track.album?.name,
    addedAt: input.addedAt,
    playlistId: input.playlistId,
    playlistName: input.playlistName,
    occurredAt: input.addedAt,
  };

  return { body, summary };
}

export function mapSpotifyPlay(input: {
  track: SpotifyTrackObject;
  playedAt: string;
  contextUri?: string;
  contextType?: string;
  capture: "recently_played" | "privacy_export";
  export?: SpotifyPlayEnvelopeBody["export"];
}): { body: SpotifyPlayEnvelopeBody; summary: SpotifyPlaySummary } | null {
  const uri = trackUriOf(input.track);
  if (!uri) return null;
  const playedAt = toIsoPlayedAt(input.playedAt);

  const artists = (input.track.artists ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    uri: a.uri,
  }));
  const artistNames = artists
    .map((a) => a.name)
    .filter((n): n is string => Boolean(n));

  const body: SpotifyPlayEnvelopeBody = {
    kind: "spotify_play",
    trackUri: uri,
    trackId: input.track.id,
    name: input.track.name,
    artists,
    album: input.track.album
      ? {
          id: input.track.album.id,
          name: input.track.album.name,
          uri: input.track.album.uri,
        }
      : undefined,
    playedAt,
    contextUri: input.contextUri,
    contextType: input.contextType,
    capture: input.capture,
    export: input.export,
  };

  const summary: SpotifyPlaySummary = {
    trackUri: uri,
    trackId: input.track.id,
    name: input.track.name,
    artists: artistNames,
    playedAt,
    occurredAt: playedAt,
    sourceKind: input.capture,
  };

  return { body, summary };
}

export function mapSpotifyShow(input: {
  show: SpotifyShowObject;
  addedAt?: string;
}): { body: SpotifyShowEnvelopeBody; summary: SpotifyShowSummary } | null {
  const uri = showUriOf(input.show);
  if (!uri) return null;

  const body: SpotifyShowEnvelopeBody = {
    kind: "spotify_show",
    showUri: uri,
    showId: input.show.id,
    name: input.show.name,
    description: input.show.description,
    publisher: input.show.publisher,
    totalEpisodes: input.show.total_episodes,
    explicit: input.show.explicit,
    externalUrl: input.show.external_urls?.spotify,
    addedAt: input.addedAt,
    capture: "library",
  };

  const summary: SpotifyShowSummary = {
    showUri: uri,
    showId: input.show.id,
    name: input.show.name,
    publisher: input.show.publisher,
    addedAt: input.addedAt,
    occurredAt: input.addedAt,
  };

  return { body, summary };
}

export function mapSpotifyEpisode(input: {
  episode: SpotifyEpisodeObject;
  addedAt?: string;
  playedAt?: string;
  contextUri?: string;
  contextType?: string;
  /** When listing /shows/{id}/episodes, show may be omitted on items. */
  show?: SpotifyShowObject | null;
  capture: SpotifyEpisodeEnvelopeBody["capture"];
}): { body: SpotifyEpisodeEnvelopeBody; summary: SpotifyEpisodeSummary } | null {
  const uri = episodeUriOf(input.episode);
  if (!uri) return null;

  const show = input.episode.show ?? input.show ?? undefined;
  const showUri = showUriOf(show ?? null) ?? undefined;
  const playedAt = input.playedAt ? toIsoPlayedAt(input.playedAt) : undefined;

  const body: SpotifyEpisodeEnvelopeBody = {
    kind: "spotify_episode",
    episodeUri: uri,
    episodeId: input.episode.id,
    name: input.episode.name,
    description: input.episode.description,
    durationMs: input.episode.duration_ms,
    explicit: input.episode.explicit,
    releaseDate: input.episode.release_date,
    externalUrl: input.episode.external_urls?.spotify,
    showUri,
    showId: show?.id,
    showName: show?.name,
    publisher: show?.publisher,
    addedAt: input.addedAt,
    playedAt,
    contextUri: input.contextUri,
    contextType: input.contextType,
    capture: input.capture,
  };

  const summary: SpotifyEpisodeSummary = {
    episodeUri: uri,
    episodeId: input.episode.id,
    name: input.episode.name,
    showUri,
    showName: show?.name,
    publisher: show?.publisher,
    releaseDate: input.episode.release_date,
    addedAt: input.addedAt,
    playedAt,
    occurredAt: playedAt ?? input.addedAt ?? input.episode.release_date,
    capture: input.capture,
  };

  return { body, summary };
}

export function mapExportPlayRow(row: {
  endTime?: string;
  msPlayed?: number;
  trackName?: string;
  artistName?: string;
  trackUri?: string;
}): { body: SpotifyPlayEnvelopeBody; summary: SpotifyPlaySummary; sourceRecordId: string } | null {
  if (!row.endTime && !row.trackName) return null;

  const syntheticTrack: SpotifyTrackObject = {
    uri: row.trackUri,
    name: row.trackName,
    artists: row.artistName ? [{ name: row.artistName }] : [],
  };

  // Privacy export often lacks Spotify URIs — synthesize a stable pseudo-uri.
  if (!syntheticTrack.uri) {
    const slug = createHash("sha256")
      .update(`${row.artistName ?? ""}|${row.trackName ?? ""}`)
      .digest("hex")
      .slice(0, 16);
    syntheticTrack.uri = `spotify:track:export-${slug}`;
  }

  const playedAt = row.endTime ? toIsoPlayedAt(row.endTime) : new Date(0).toISOString();
  const mapped = mapSpotifyPlay({
    track: syntheticTrack,
    playedAt,
    capture: "privacy_export",
    export: {
      endTime: row.endTime,
      msPlayed: row.msPlayed,
      trackName: row.trackName,
      artistName: row.artistName,
    },
  });
  if (!mapped) return null;

  return {
    ...mapped,
    sourceRecordId: exportPlaySourceRecordId({
      endTime: row.endTime,
      trackName: row.trackName,
      artistName: row.artistName,
      msPlayed: row.msPlayed,
      trackUri: mapped.body.trackUri,
    }),
  };
}
