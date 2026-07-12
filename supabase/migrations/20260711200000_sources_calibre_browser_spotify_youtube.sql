-- Cortex sources: Calibre, Browser, Spotify, YouTube
-- Extends Phase 0 kinds + seeds; documents canonical record/entity types.
-- Safe to apply after 20260711100000_phase0_schema.sql (Phase 0 scaffold may still be in flight).

-- Allow library / browser / media kinds on sources
alter table public.sources
  drop constraint if exists sources_kind_check;

alter table public.sources
  add constraint sources_kind_check
  check (kind in (
    'ai',
    'email',
    'calendar',
    'drive',
    'code',
    'manual',
    'library',
    'browser',
    'music',
    'video'
  ));

insert into public.sources (id, display_name, kind) values
  ('calibre', 'Calibre', 'library'),
  ('browser', 'Browser (bookmarks + search)', 'browser'),
  ('spotify', 'Spotify', 'music'),
  ('youtube', 'YouTube', 'video')
on conflict (id) do nothing;

-- Canonical record_type / entity_type conventions (free-text columns; documented here):
--   records.record_type:
--     ebook, bookmark, search_query,
--     spotify_track, spotify_play,
--     youtube_video, youtube_watch
--   entities.entity_type:
--     ebook, bookmark, search_query,
--     spotify_track, spotify_play,
--     youtube_video, youtube_watch
--
-- Idempotency remains unique (source_id, source_record_id) on records.
-- See docs/sources.md for source_record_id formats per adapter.
