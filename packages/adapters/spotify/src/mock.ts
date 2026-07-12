import type {
  SpotifyEpisodeObject,
  SpotifyPlayHistoryItem,
  SpotifySavedEpisodeItem,
  SpotifySavedShowItem,
  SpotifySavedTrackItem,
} from "./client.js";
import type { StreamingHistoryRow } from "./export.js";

/** Deterministic Spotify fixtures for dry-run / missing credentials. */
export function mockSavedTracks(): SpotifySavedTrackItem[] {
  return [
    {
      added_at: "2026-06-01T12:00:00Z",
      track: {
        id: "mocktrack1",
        uri: "spotify:track:mocktrack1",
        name: "Mock Library Track",
        duration_ms: 210000,
        explicit: false,
        artists: [{ id: "a1", name: "Mock Artist", uri: "spotify:artist:a1" }],
        album: {
          id: "al1",
          name: "Mock Album",
          uri: "spotify:album:al1",
        },
        external_urls: { spotify: "https://open.spotify.com/track/mocktrack1" },
      },
    },
    {
      added_at: "2026-05-15T09:30:00Z",
      track: {
        id: "mocktrack2",
        uri: "spotify:track:mocktrack2",
        name: "Another Saved Song",
        duration_ms: 185000,
        artists: [{ id: "a2", name: "Second Artist", uri: "spotify:artist:a2" }],
        album: { id: "al2", name: "B-Sides", uri: "spotify:album:al2" },
      },
    },
  ];
}

export function mockSavedShows(): SpotifySavedShowItem[] {
  return [
    {
      added_at: "2026-04-01T10:00:00Z",
      show: {
        id: "mockshow1",
        uri: "spotify:show:mockshow1",
        name: "Mock Followed Show",
        description: "A sample podcast Jack follows.",
        publisher: "Mock Publisher",
        total_episodes: 42,
        explicit: false,
        external_urls: { spotify: "https://open.spotify.com/show/mockshow1" },
      },
    },
  ];
}

export function mockShowEpisodes(): SpotifyEpisodeObject[] {
  return [
    {
      id: "mockep1",
      uri: "spotify:episode:mockep1",
      name: "Latest Episode",
      description: "Recent episode from a followed show.",
      duration_ms: 3600000,
      release_date: "2026-07-01",
      type: "episode",
      show: {
        id: "mockshow1",
        uri: "spotify:show:mockshow1",
        name: "Mock Followed Show",
        publisher: "Mock Publisher",
      },
    },
    {
      id: "mockep2",
      uri: "spotify:episode:mockep2",
      name: "Previous Episode",
      duration_ms: 3300000,
      release_date: "2026-06-15",
      type: "episode",
      show: {
        id: "mockshow1",
        uri: "spotify:show:mockshow1",
        name: "Mock Followed Show",
        publisher: "Mock Publisher",
      },
    },
  ];
}

export function mockSavedEpisodes(): SpotifySavedEpisodeItem[] {
  return [
    {
      added_at: "2026-06-20T14:00:00Z",
      episode: {
        id: "mocksavedep1",
        uri: "spotify:episode:mocksavedep1",
        name: "Saved Episode",
        description: "An episode Jack saved.",
        duration_ms: 2400000,
        release_date: "2026-06-10",
        type: "episode",
        show: {
          id: "mockshow1",
          uri: "spotify:show:mockshow1",
          name: "Mock Followed Show",
          publisher: "Mock Publisher",
        },
      },
    },
  ];
}

export function mockRecentlyPlayed(): SpotifyPlayHistoryItem[] {
  return [
    {
      played_at: "2026-07-11T18:00:00.000Z",
      track: {
        id: "mocktrack1",
        uri: "spotify:track:mocktrack1",
        name: "Mock Library Track",
        artists: [{ name: "Mock Artist" }],
        album: { name: "Mock Album" },
        type: "track",
      },
      context: { type: "playlist", uri: "spotify:playlist:mockpl" },
    },
    {
      played_at: "2026-07-11T17:00:00.000Z",
      track: {
        id: "mockep1",
        uri: "spotify:episode:mockep1",
        name: "Latest Episode",
        type: "episode",
        show: {
          id: "mockshow1",
          uri: "spotify:show:mockshow1",
          name: "Mock Followed Show",
          publisher: "Mock Publisher",
        },
      },
      context: { type: "show", uri: "spotify:show:mockshow1" },
    },
  ];
}

export function mockStreamingHistory(): StreamingHistoryRow[] {
  return [
    {
      endTime: "2026-01-02 20:15",
      artistName: "Export Artist",
      trackName: "Deep History Song",
      msPlayed: 180000,
    },
    {
      endTime: "2026-01-02 20:18",
      artistName: "Export Artist",
      trackName: "Deep History Song",
      msPlayed: 45000,
    },
  ];
}
