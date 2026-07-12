import type { YoutubePlaylistItemInput } from "./types.js";
import type { TakeoutWatchRow } from "./takeout.js";

/** Deterministic YouTube fixtures for dry-run / missing credentials. */
export function mockPlaylistItems(): YoutubePlaylistItemInput[] {
  return [
    {
      playlistId: "LL",
      playlistItemId: "mock-pli-1",
      videoId: "dQw4w9WgXcQ",
      title: "Mock Liked Video",
      channelId: "UCmock1",
      channelTitle: "Mock Channel",
      publishedAt: "2026-07-01T10:00:00Z",
      position: 0,
      capture: "liked",
    },
    {
      playlistId: "PLmockPlaylist",
      playlistItemId: "mock-pli-2",
      videoId: "mockvid2abcde",
      title: "Mock Playlist Video",
      channelId: "UCmock2",
      channelTitle: "Another Channel",
      publishedAt: "2026-06-15T08:00:00Z",
      position: 1,
      capture: "playlist",
    },
  ];
}

export function mockTakeoutWatches(): TakeoutWatchRow[] {
  return [
    {
      header: "YouTube",
      title: "Watched Mock History Video",
      titleUrl: "https://www.youtube.com/watch?v=historyvid001",
      time: "2026-03-01T12:00:00.000Z",
      subtitles: [
        {
          name: "History Channel",
          url: "https://www.youtube.com/channel/UChistory",
        },
      ],
      products: ["YouTube"],
    },
  ];
}

/**
 * Notes: YouTube Data API has no full watch-history firehose.
 * Full historical watches require Google Takeout (YouTube → watch-history).
 */
export const YOUTUBE_WATCH_HISTORY_NOTES = `
YouTube watch history (Phase 5b):
- Data API: library only (playlists, likes/LL, subscriptions metadata).
- No official continuous watch-history stream — use Google Takeout JSON.
- Re-export Takeout periodically for ongoing watches, or accept library-only.
`.trim();
