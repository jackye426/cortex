# Spotify + YouTube (Phase 5b)

Official APIs / exports only — **no scraping**. Spec details: [sources.md](sources.md).

## Packages

| Package | Role |
|---------|------|
| `@cortex/adapter-spotify` | Web API followed shows + episodes + library + recently played; privacy-export parser |
| `@cortex/adapter-youtube` | Data API likes/playlists; Takeout watch-history parser |
| `@cortex/google-auth` | Shared Google OAuth (`youtube.readonly` bundle) |

## Spotify

### Scopes

`user-library-read` (saved tracks/albums, **followed shows**, **saved episodes**), `playlist-read-private`, `playlist-read-collaborative`, `user-read-recently-played`, `user-top-read`, `user-read-playback-state`.

No extra podcast-only scope is required. If `/me/shows` or `/me/episodes` returns **403**, the refresh token predates these uses of `user-library-read` — re-run OAuth and have Jack re-consent:

```powershell
pnpm --filter @cortex/adapter-spotify oauth
pnpm --filter @cortex/adapter-spotify oauth -- --code=PASTE_CODE
```

Then update `SPOTIFY_REFRESH_TOKEN` in `.env`.

### Env

```bash
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REFRESH_TOKEN=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8766/callback
# SPOTIFY_MOCK=1
```

Without client id/secret/refresh token (or with `SPOTIFY_MOCK=1`), the adapter uses **mock fixtures** — safe for dry-run.

### OAuth (manual)

**Redirect URI (must match character-for-character):**

```
http://127.0.0.1:8766/callback
```

Spotify’s Dashboard often suggests `localhost`. Cortex sends `127.0.0.1`. Mixing them causes `redirect_uri: Not matching configuration`.

1. Create an app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. App → Settings → Redirect URIs → paste the URI above exactly → **Save**.
3. Put client id/secret in `.env` (`SPOTIFY_REDIRECT_URI` defaults to the same URI).
4. Run:

```powershell
pnpm --filter @cortex/adapter-spotify oauth
# open printed URL, then:
pnpm --filter @cortex/adapter-spotify oauth -- --code=PASTE_CODE
```

5. Add `SPOTIFY_REFRESH_TOKEN=…` to `.env`. Never commit it.

### Backfill

```powershell
# Mock / dry-run (no credentials)
pnpm backfill -- --source=spotify --dry-run

# Live API (credentials in .env) — shows/episodes first, then tracks/playlists/recent
pnpm backfill -- --source=spotify --dry-run --limit=20

# Deep listening history — official privacy / account data download
pnpm backfill -- --source=spotify-export --path=D:\Downloads\my_spotify_data.zip --dry-run
```

Backfill order (API): followed shows → recent episodes per show (≤15, max 20) → saved episodes → saved tracks → playlists → recently played (episode items included when present).

Privacy export looks for `StreamingHistory*.json` or `endsong_*.json` (ZIP or folder).

## YouTube

### Scope

`https://www.googleapis.com/auth/youtube.readonly`

Enable **YouTube Data API v3** in GCP. Prefer a **separate External** OAuth client for personal Gmail (see **Personal YouTube vs Workspace** in [google.md](./google.md)) — an Internal / org-only consent screen blocks `@gmail.com` with “can only be used within its organization”.

```powershell
# After GOOGLE_YOUTUBE_CLIENT_ID/SECRET are set:
pnpm --filter @cortex/google-auth oauth -- --bundle=youtube --login_hint=you@gmail.com
# or include Workspace scopes on that consent (still store as YouTube token if personal):
pnpm --filter @cortex/google-auth oauth -- --bundle=allWithYoutube --login_hint=you@gmail.com
```

YouTube OAuth / token refresh prefers `GOOGLE_YOUTUBE_CLIENT_ID` / `GOOGLE_YOUTUBE_CLIENT_SECRET` / `GOOGLE_YOUTUBE_REFRESH_TOKEN`, falling back to `GOOGLE_CLIENT_*` / `GOOGLE_REFRESH_TOKEN` when unset. Use the YouTube-specific vars when the Workspace app is Internal or when YouTube is a different Google account — otherwise re-consent can overwrite Workspace credentials. Without credentials (or with `GOOGLE_MOCK=1`), mock fixtures run.

### Backfill

```powershell
# Library (likes + playlists) — mock when GOOGLE_* unset
pnpm backfill -- --source=youtube --dry-run

# Full watch history — Google Takeout → YouTube → watch-history.json
# When the ZIP email arrives (personal Gmail Takeout):
pnpm backfill -- --source=youtube-takeout --path=D:\Downloads\takeout.zip --dry-run --limit=20
pnpm backfill -- --source=youtube-takeout --path=D:\Downloads\takeout.zip
# Then MCP: recent_watches / search_records
```

The Data API has **no** full watch-history firehose. Ongoing watches = periodic Takeout re-export, or library-only until Google exposes a supported feed. Library (`--source=youtube`) is already supported via Data API.

## Record types

| Record type | `source_record_id` |
|-------------|-------------------|
| `spotify_track` | Spotify track URI |
| `spotify_play` | `{played_at_iso}:{track_uri}` or export row hash |
| `spotify_show` | Spotify show URI |
| `spotify_episode` | Episode URI (or `{played_at_iso}:{episode_uri}` for recently played) |
| `youtube_video` | YouTube video id |
| `youtube_watch` | `{video_id}:{watched_at_iso}` (Takeout) or `{playlist_id}:{playlist_item_id}` (library) |

Envelope `source` is always `spotify` / `youtube` (CLI flags `spotify-export` / `youtube-takeout` select the parser).
