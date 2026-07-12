/**
 * YouTube video / watch → raw envelope body + summary.
 */

export interface YoutubeVideoSummary {
  videoId: string;
  title?: string;
  channelId?: string;
  channelTitle?: string;
  playlistId?: string;
  playlistItemId?: string;
  publishedAt?: string;
  occurredAt?: string;
}

export interface YoutubeWatchSummary {
  videoId: string;
  title?: string;
  channelTitle?: string;
  watchedAt?: string;
  occurredAt?: string;
  playlistId?: string;
  playlistItemId?: string;
  sourceKind: "playlist_item" | "takeout";
}

export interface YoutubeVideoEnvelopeBody {
  kind: "youtube_video";
  videoId: string;
  title?: string;
  descriptionPreview?: string;
  channelId?: string;
  channelTitle?: string;
  playlistId?: string;
  playlistItemId?: string;
  publishedAt?: string;
  position?: number;
  thumbnails?: Record<string, { url?: string }>;
  capture: "liked" | "playlist" | "subscription_related";
}

export interface YoutubeWatchEnvelopeBody {
  kind: "youtube_watch";
  videoId: string;
  title?: string;
  channelTitle?: string;
  channelUrl?: string;
  watchedAt?: string;
  titleUrl?: string;
  playlistId?: string;
  playlistItemId?: string;
  capture: "takeout" | "library";
  /** Raw Takeout activity fields kept for vault. */
  takeout?: {
    header?: string;
    products?: string[];
  };
}

export function videoSourceRecordId(videoId: string): string {
  return videoId;
}

export function playlistItemWatchId(
  playlistId: string,
  playlistItemId: string,
): string {
  return `${playlistId}:${playlistItemId}`;
}

export function takeoutWatchId(videoId: string, watchedAtIso: string): string {
  return `${videoId}:${watchedAtIso}`;
}

export function extractVideoIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id || undefined;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(shorts|embed|live)\/([^/?]+)/);
    if (m?.[2]) return m[2];
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Map a playlist/liked item to a youtube_video entity + youtube_watch library row.
 * Docs: video id for youtube_video; `{playlist_id}:{playlist_item_id}` for library watches.
 */
export function mapYoutubePlaylistItem(input: {
  videoId: string;
  title?: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  playlistId: string;
  playlistItemId: string;
  publishedAt?: string;
  position?: number;
  capture: "liked" | "playlist";
}): {
  video: { body: YoutubeVideoEnvelopeBody; summary: YoutubeVideoSummary };
  watch: {
    body: YoutubeWatchEnvelopeBody;
    summary: YoutubeWatchSummary;
    sourceRecordId: string;
  };
} {
  const videoBody: YoutubeVideoEnvelopeBody = {
    kind: "youtube_video",
    videoId: input.videoId,
    title: input.title,
    descriptionPreview: input.description?.slice(0, 240),
    channelId: input.channelId,
    channelTitle: input.channelTitle,
    playlistId: input.playlistId,
    playlistItemId: input.playlistItemId,
    publishedAt: input.publishedAt,
    position: input.position,
    capture: input.capture,
  };

  const videoSummary: YoutubeVideoSummary = {
    videoId: input.videoId,
    title: input.title,
    channelId: input.channelId,
    channelTitle: input.channelTitle,
    playlistId: input.playlistId,
    playlistItemId: input.playlistItemId,
    publishedAt: input.publishedAt,
    occurredAt: input.publishedAt,
  };

  const sourceRecordId = playlistItemWatchId(
    input.playlistId,
    input.playlistItemId,
  );

  return {
    video: { body: videoBody, summary: videoSummary },
    watch: {
      body: {
        kind: "youtube_watch",
        videoId: input.videoId,
        title: input.title,
        channelTitle: input.channelTitle,
        watchedAt: input.publishedAt,
        playlistId: input.playlistId,
        playlistItemId: input.playlistItemId,
        capture: "library",
      },
      summary: {
        videoId: input.videoId,
        title: input.title,
        channelTitle: input.channelTitle,
        watchedAt: input.publishedAt,
        occurredAt: input.publishedAt,
        playlistId: input.playlistId,
        playlistItemId: input.playlistItemId,
        sourceKind: "playlist_item",
      },
      sourceRecordId,
    },
  };
}

export function mapTakeoutWatch(input: {
  videoId: string;
  title?: string;
  channelTitle?: string;
  channelUrl?: string;
  watchedAt?: string;
  titleUrl?: string;
  header?: string;
  products?: string[];
}): {
  body: YoutubeWatchEnvelopeBody;
  summary: YoutubeWatchSummary;
  sourceRecordId: string;
} {
  let occurredAt: string | undefined;
  if (input.watchedAt) {
    const parsed = Date.parse(input.watchedAt);
    occurredAt = Number.isNaN(parsed)
      ? input.watchedAt
      : new Date(parsed).toISOString();
  }

  const body: YoutubeWatchEnvelopeBody = {
    kind: "youtube_watch",
    videoId: input.videoId,
    title: input.title,
    channelTitle: input.channelTitle,
    channelUrl: input.channelUrl,
    watchedAt: occurredAt,
    titleUrl: input.titleUrl,
    capture: "takeout",
    takeout: {
      header: input.header,
      products: input.products,
    },
  };

  const summary: YoutubeWatchSummary = {
    videoId: input.videoId,
    title: input.title,
    channelTitle: input.channelTitle,
    watchedAt: occurredAt,
    occurredAt,
    sourceKind: "takeout",
  };

  const sourceRecordId = occurredAt
    ? takeoutWatchId(input.videoId, occurredAt)
    : takeoutWatchId(input.videoId, "unknown");

  return { body, summary, sourceRecordId };
}
