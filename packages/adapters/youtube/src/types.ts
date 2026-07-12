/** Shared YouTube adapter input types. */

export interface YoutubePlaylistItemInput {
  playlistId: string;
  playlistItemId: string;
  videoId: string;
  title?: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  publishedAt?: string;
  position?: number;
  capture: "liked" | "playlist";
}
