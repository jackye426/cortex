# Cortex data sources

Paths below were probed on Jack’s Windows machine (2026-07-11). Counts only — no bookmark titles, URLs, or search terms are recorded here.

## Noise rules (global)

| Source | Canonical | Raw vault | Explicitly excluded |
|--------|-----------|-----------|---------------------|
| Calibre | Book metadata + relative library paths + format list | Optional cover thumbnails; **not** full ebook binaries by default | Binary vault of epub/pdf/mobi unless a book is tiny and explicitly opted-in later |
| Browser | Bookmarks + `keyword_search_terms` only | Same payloads | Full visit history (`urls` / `visits` firehose) |
| Spotify | Library tracks/albums/playlists + recently played | API JSON pages | Scraping; auth tokens |
| YouTube | Library (playlists/likes/subscriptions) + Takeout watch rows | API/Takeout JSON | Scraping; full Google activity firehose beyond YouTube Takeout watch/search |

Idempotency for all sources: unique `(source, source_record_id)` on `records`.

## Distillate / embedding coverage (Unified Memory Substrate)

Canonical records are always searchable by keyword. Semantic cross-source comparison requires **embedded distillates** in `distillates.embedding`.

| Source | Distillate in v1? | Grain | Notes |
|--------|-------------------|-------|-------|
| AI sessions | Yes (`kind=summary`) | Per session | Stratified sampling; topics + evidenced behaviors |
| YouTube | Yes (`youtube_interest_digest`) | Weekly topic cluster | Watching ≠ identity; recurring > one-off |
| Email / Calendar / GitHub / Spotify / Drive / Browser | Keyword only until enabled | See adapter CLI | `pnpm source-adapter -- --list` |

Full design: [memory-substrate.md](memory-substrate.md).

---

## Calibre (Phase 2b — local)

**Install (found):** `C:\Program Files\Calibre2\` (calibre 9.4.0)  
**Config:** `%APPDATA%\calibre\global.py.json` → `library_path`  
**Library (found):** `C:\Users\yulon\Calibre Library`  
**DB:** `C:\Users\yulon\Calibre Library\metadata.db` (~545 KB; **27** books)

### Capture model

| Mode | Mechanism |
|------|-----------|
| Historical | Full scan of `books` (+ authors/tags/identifiers/formats via link tables). `data` gives format names + sizes; reconstruct on-disk path as `{library}/{books.path}/{data.name}.{format}` — store **path strings**, not file bytes. |
| Ongoing | Poll `metadata.db` by `books.last_modified` / `books.id` checkpoint (copy DB then open read-only; Calibre may lock the live file). |

### Idempotency IDs

| Record type | `source_record_id` |
|-------------|-------------------|
| `ebook` | Calibre book `uuid` (preferred) or `book:{id}` |

Adapter package: `packages/adapters/calibre` (`@cortex/adapter-calibre`).

---

## Browser — Chrome / Edge (Phase 2b — local)

**Noise rule:** bookmarks + search queries **only**. Do not ingest full visit history.

### Paths (Chromium layout)

| Browser | User Data root | Per-profile files |
|---------|----------------|-------------------|
| Chrome | `%LOCALAPPDATA%\Google\Chrome\User Data\` | `{Profile}/Bookmarks` (JSON), `{Profile}/History` (SQLite) |
| Edge | `%LOCALAPPDATA%\Microsoft\Edge\User Data\` | same |

Profiles found (file sizes only):

| Browser | Profile | Bookmarks bytes | History bytes | Bookmark URL count | `keyword_search_terms` count |
|---------|---------|-----------------|---------------|--------------------|------------------------------|
| Chrome | Default | 3,697 | 5,570,560 | 2 | 129 |
| Chrome | Profile 1 | 2,706 | 13,533,184 | 1 | 145 |
| Chrome | Profile 2 | 8,200 | 24,543,232 | 8 | 890 |
| Chrome | Profile 3 | 2,123 | 2,424,832 | 0 | 34 |
| Chrome | Profile 4 | 55,259 | 9,879,552 | 63 | 565 |
| Edge | Default | 3,206 | 1,474,560 | 4 | 2 |

`urls` row counts exist on History DBs but are **out of scope** for ingest (firehose).

### Tables / files used

- **Bookmarks:** Chromium JSON (`roots.bookmark_bar` / `other` / `synced`); walk `type=url` nodes only.
- **Search queries:** `History.keyword_search_terms` (`keyword_id`, `url_id`, `term`, `normalized_term`). Join `urls` only to attach the search-results URL metadata for the query row — still do **not** promote arbitrary visits.

### Capture model

| Mode | Mechanism |
|------|-----------|
| Historical | One-shot copy of each profile’s `Bookmarks` + `History` (Chrome/Edge lock live DBs). Emit all bookmarks + all `keyword_search_terms`. |
| Ongoing | Periodic copy + diff: bookmarks by GUID; searches by `(profile, url_id, normalized_term)` or max `urls.last_visit_time` among search rows as checkpoint. |

### Idempotency IDs

| Record type | `source_record_id` |
|-------------|-------------------|
| `bookmark` | `{browser}:{profile}:bm:{guid}` (Chromium bookmark GUID) |
| `search_query` | `{browser}:{profile}:q:{url_id}:{hash(normalized_term)}` |

`account_key` for checkpoints: `{browser}:{profile}` (e.g. `chrome:Profile 2`).

Adapter package: `packages/adapters/browser` (`@cortex/adapter-browser`).

---

## Spotify (Phase 5b — cloud API)

**Primary path:** [Spotify Web API](https://developer.spotify.com/documentation/web-api) with Authorization Code (+ refresh). No scraping.

### Scopes (locked)

| Scope | Why |
|-------|-----|
| `user-library-read` | Saved tracks/albums, **followed shows**, **saved episodes** |
| `playlist-read-private` | User playlists |
| `playlist-read-collaborative` | Shared playlists |
| `user-read-recently-played` | Recent plays (ongoing; episode items mapped when API returns them) |
| `user-top-read` | Top artists/tracks context (optional distillate) |
| `user-read-playback-state` | Optional now-playing snapshot |

`user-library-read` covers `GET /me/shows` and `GET /me/episodes`. Show episode feeds (`GET /shows/{id}/episodes`) need a valid user token but no extra scope. If a live call returns **403**, re-run OAuth (`pnpm --filter @cortex/adapter-spotify oauth`) so Jack re-consents with the current scope set.

### Historical vs incremental

| Mode | Mechanism | Limit |
|------|-----------|-------|
| Historical (API) | **Followed shows** + recent episodes per show (≤15–20) + saved episodes; then library tracks + playlists | Podcasts first; no full show catalog firehose |
| Historical (deep listening) | Official **Spotify privacy / account data download** (`StreamingHistory*.json`) parsed once | API recently-played is only ~50 items — export is the deep history path |
| Ongoing | Poll `GET /me/player/recently-played?after={unix_ms}`; library checkpoint via snapshot or `added_at` | Respect rate limits |

### Idempotency IDs

| Record type | `source_record_id` |
|-------------|-------------------|
| `spotify_track` | Spotify track URI (`spotify:track:…`) |
| `spotify_play` | `{played_at_iso}:{track_uri}` (recently played) or export row hash |
| `spotify_show` | Spotify show URI (`spotify:show:…`) |
| `spotify_episode` | Episode URI (`spotify:episode:…`); recently-played uses `{played_at_iso}:{episode_uri}` |

Adapter package: `packages/adapters/spotify` (`@cortex/adapter-spotify`).

Setup + CLI: [docs/spotify-youtube.md](spotify-youtube.md).

---

## YouTube (Phase 5b — cloud API + Takeout)

**Primary path:** [YouTube Data API v3](https://developers.google.com/youtube/v3) with OAuth. **No scraping.** Watch history is **not** fully available via Data API — use Google Takeout for historical watches.

### Scopes (locked)

| Scope | Why |
|-------|-----|
| `https://www.googleapis.com/auth/youtube.readonly` | Playlists, likes (LL), subscriptions, channel library |

Reuse Workspace Google OAuth client from Phase 5 where possible; add YouTube readonly scope (may require Google Cloud project YouTube Data API enabled).

### Historical vs incremental

| Mode | Mechanism |
|------|-----------|
| Historical library | `playlists.list` / `playlistItems.list` (including Liked), `subscriptions.list` |
| Historical watches / searches | Google Takeout → YouTube → watch-history / search-history JSON (one-shot parser) |
| Ongoing library | Playlist item page tokens + `activities.list` where useful; poll liked playlist |
| Ongoing watches | No reliable official watch-history stream — periodic Takeout re-export **or** accept library-only ongoing until Google exposes a supported feed |

### Idempotency IDs

| Record type | `source_record_id` |
|-------------|-------------------|
| `youtube_video` | YouTube video id |
| `youtube_watch` | `{video_id}:{watched_at_iso}` (Takeout) or `{playlist_id}:{playlist_item_id}` for library rows |

Adapter package: `packages/adapters/youtube` (`@cortex/adapter-youtube`).

Setup + CLI: [docs/spotify-youtube.md](spotify-youtube.md).

---

## ChatGPT (Phase 3)

| Mode | Mechanism |
|------|-----------|
| Historical | Official OpenAI data export ZIP → `conversations.json` (DAG via `current_node`) |
| Ongoing | MV3 extension on `chatgpt.com` posts completed turns to ingest (no cookie scraping) |

| Record path | `source` | `source_record_id` |
|-------------|----------|-------------------|
| Export conversation | `chatgpt-export` | Conversation id |
| Extension turn | `chatgpt` | `{conversationId}:{turnId}` |

Install + usage: [docs/chatgpt.md](chatgpt.md). Adapter: `packages/adapters/chatgpt-export`. Extension: `apps/chatgpt-extension`.

---

## GitHub (Phase 4 — work history)

**Scope:** repos, issues, PRs, commits (+ metadata). **Not** notifications, Discussions, or Copilot.

| Mode | Mechanism |
|------|-----------|
| Historical | Fine-grained PAT → `/user/repos` then per-repo issues / pulls / commits (paginated) |
| Incremental | `SyncCheckpoint` cursor (`GithubSyncCheckpointCursor`): `since` + ETag `If-None-Match` |
| Ongoing | Webhook `POST /v1/webhooks/github` (signature when `GITHUB_WEBHOOK_SECRET` set) |

| Record type | `source_record_id` |
|-------------|-------------------|
| `github_repo` | `repo:{full_name}` |
| `github_issue` | `issue:{full_name}#{number}` |
| `github_pr` | `pr:{full_name}#{number}` |
| `github_commit` | `commit:{full_name}@{sha}` |

Setup + PAT permissions: [docs/github.md](github.md). Adapter: `packages/adapters/github`.

---

## Google Workspace (Phase 5)

Workspace-only OAuth (personal Google out of scope). Enable order: Calendar → Drive → Gmail.

| Mode | Mechanism |
|------|-----------|
| Calendar historical / incremental | `events.list` → `nextSyncToken`; poll with `syncToken` (410 → full resync) |
| Drive historical / incremental | `files.list` + `files.export` (Docs/Sheets/Slides); then `changes.list` |
| Gmail historical / incremental | `messages.list`/`get` (readonly); `history.list`; Pub/Sub `users.watch` prepared |

| Record type | `source_record_id` |
|-------------|-------------------|
| `calendar_event` | `{calendarId}:{eventId}` |
| `drive_file` | Drive file id |
| `email_message` | Gmail message id |

Setup + scopes + verification: [docs/google.md](google.md). Shared auth: `@cortex/google-auth`.

---

## Schema notes

Migration `supabase/migrations/20260711200000_sources_calibre_browser_spotify_youtube.sql` seeds sources and extends `sources.kind`. Record/entity type strings:

`ebook`, `bookmark`, `search_query`, `spotify_track`, `spotify_play`, `spotify_show`, `spotify_episode`, `youtube_video`, `youtube_watch`, `github_repo`, `github_issue`, `github_pr`, `github_commit`, `calendar_event`, `drive_file`, `email_message`.
