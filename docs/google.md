# Google Workspace (Phase 5)

Personal (consumer) Google accounts are **out of scope**. Cortex uses a **Google Workspace** user only.

Order of enablement: **Calendar → Drive → Gmail**.

## Packages

| Package | Role |
|---------|------|
| `@cortex/google-auth` | Shared OAuth2 helpers + Workspace scopes |
| `@cortex/adapter-calendar` | Events backfill + `syncToken` incremental |
| `@cortex/adapter-drive` | `files.list` / `files.export` + `changes.list` |
| `@cortex/adapter-gmail` | Readonly messages + `history.list` (+ watch notes) |

## Scopes (locked)

| Scope | Adapter | Notes |
|-------|---------|-------|
| `https://www.googleapis.com/auth/calendar.readonly` | Calendar | Events |
| `https://www.googleapis.com/auth/drive.readonly` | Drive | Metadata + export |
| `https://www.googleapis.com/auth/gmail.readonly` | Gmail | **Restricted** scope |
| `https://www.googleapis.com/auth/userinfo.email` | All | Account labeling |
| `https://www.googleapis.com/auth/youtube.readonly` | YouTube (5b) | Playlists / likes; watch history via Takeout |

Consent Workspace scopes via `@cortex/google-auth` bundle `all`. Add YouTube with `--bundle=youtube` or `--bundle=allWithYoutube`.

## Verification note (`gmail.readonly`)

`gmail.readonly` is a **restricted** Google OAuth scope. For a single-user Workspace app:

1. Keep the Cloud project OAuth consent screen on **External + Testing**.
2. Add only your Workspace user as a **test user**.
3. Do **not** start Google’s full verification until you need users beyond the test list.
4. Testing mode is enough for Jack’s personal Cortex instance.

## Env vars

Copy from [`.env.example`](../.env.example):

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
# Personal YouTube (External client) — see section below
# GOOGLE_YOUTUBE_CLIENT_ID=
# GOOGLE_YOUTUBE_CLIENT_SECRET=
# GOOGLE_YOUTUBE_REFRESH_TOKEN=
GOOGLE_REDIRECT_URI=http://127.0.0.1:8765/oauth2callback
GOOGLE_ACCOUNT_EMAIL=you@your-workspace.com
# GOOGLE_MOCK=1   # force fixtures even if credentials exist
```

Without `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN`, Workspace adapters run in **mock mode**. YouTube prefers `GOOGLE_YOUTUBE_CLIENT_ID` / `GOOGLE_YOUTUBE_CLIENT_SECRET` / `GOOGLE_YOUTUBE_REFRESH_TOKEN`, falling back to `GOOGLE_*` when unset, so a personal Gmail YouTube grant does not overwrite Workspace credentials.

## Personal YouTube vs Workspace

**Root cause of “Access blocked: … can only be used within its organization”:** the OAuth consent screen for “Doctors Sales Agent” (or the Workspace Cloud project) is **Internal**, so only accounts in that Google Workspace org can consent. Personal `@gmail.com` users (e.g. `yulongye426@gmail.com`) are blocked before scopes are granted.

**Recommended fix:** keep Workspace OAuth as-is for Calendar/Drive/Gmail, and create a **second** OAuth client for personal YouTube (same project or a new one) with consent screen **External + Testing**.

### Console checklist (personal YouTube client)

1. [Google Cloud Console](https://console.cloud.google.com/) → create a new project **or** open the existing one.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (not Internal).
   - Publishing status: **Testing**.
   - Add test user: `yulongye426@gmail.com` (and any other personal Gmail that will consent).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app** (or **Web application**).
   - If Web: Authorized redirect URI = `http://127.0.0.1:8765/oauth2callback`.
5. Copy the new client ID and client secret into `.env` as `GOOGLE_YOUTUBE_CLIENT_ID` / `GOOGLE_YOUTUBE_CLIENT_SECRET` (leave Workspace `GOOGLE_CLIENT_*` unchanged).
6. Obtain a YouTube refresh token (uses the YouTube client when `GOOGLE_YOUTUBE_CLIENT_*` is set):

```powershell
pnpm --filter @cortex/google-auth oauth -- --bundle=youtube --login_hint=yulongye426@gmail.com
# open the printed URL while signed into that Gmail, then:
pnpm --filter @cortex/google-auth oauth -- --code=PASTE_CODE --bundle=youtube --login_hint=yulongye426@gmail.com
```

7. Store the printed value as `GOOGLE_YOUTUBE_REFRESH_TOKEN`. Do **not** replace `GOOGLE_REFRESH_TOKEN`.

**Alternative (same client):** switch the existing project’s consent screen from Internal → External + Testing and add the personal Gmail as a test user. That works, but mixes personal YouTube with a Workspace-branded app and may be undesirable for org policy.

### Troubleshooting: `Error 403: org_internal`

Google’s **“can only be used within its organization”** / `org_internal` means the **OAuth consent screen User type is Internal** on the GCP project that owns the client ID in the auth URL — not that the OAuth *client* type is wrong. Creating a new OAuth client does **not** change User type; only **APIs & Services → OAuth consent screen → User type** does. The app name on the error (e.g. “Cortex”) is the consent screen app name.

**Verify the right project:** the numeric prefix before the first hyphen in `GOOGLE_YOUTUBE_CLIENT_ID` (e.g. `702381241628-…`) is the GCP project number. In Cloud Console, select **that** project (not a different one where you may have already set External).

**Checklist:**

1. Console → project matching the client prefix → **APIs & Services → OAuth consent screen**.
2. Must show **External** (not Internal). Publishing **Testing** + test user `yulongye426@gmail.com`.
3. If Internal and you cannot switch (org policy): create a **new** GCP project under personal Gmail (not Workspace), set External + Testing, add the test user, create a new OAuth client, enable **YouTube Data API v3**, redirect `http://127.0.0.1:8765/oauth2callback`, then replace `GOOGLE_YOUTUBE_CLIENT_ID` / `GOOGLE_YOUTUBE_CLIENT_SECRET` (and re-run oauth for a new refresh token).
4. If you already created External on another project but `.env` still has the Internal client: swap the YouTube env vars to the External project’s client. Confirm by matching the auth URL’s `client_id` prefix to `.env`.

## GCP setup (Workspace testing mode)

1. Google Cloud Console → create/select a project.
2. Enable APIs: **Google Calendar API**, **Google Drive API**, **Gmail API**.
3. APIs & Services → **OAuth consent screen** → External → **Testing** (or Internal if only Workspace users — then personal Gmail cannot consent; use the YouTube section above).
4. Add your Workspace email as a test user.
5. Create **OAuth client ID** (Desktop or Web) with redirect `http://127.0.0.1:8765/oauth2callback`.
6. Put client id/secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
7. Obtain a Workspace refresh token:

```powershell
pnpm --filter @cortex/google-auth oauth
# open the printed URL while signed into Workspace, then:
pnpm --filter @cortex/google-auth oauth -- --code=PASTE_CODE
```

8. Add `GOOGLE_REFRESH_TOKEN` to `.env`. Never commit secrets.

## Capture model

| Source | Historical | Incremental |
|--------|------------|-------------|
| Calendar | `events.list` (windowed) until `nextSyncToken` | `events.list?syncToken=` (410 → full resync) |
| Drive | `files.list` + `files.export` for Docs/Sheets/Slides | `changes.getStartPageToken` → `changes.list` |
| Gmail | `messages.list` + `messages.get` (readonly) | `history.list` from profile `historyId`; Pub/Sub `users.watch` prepared but not auto-started |

### Drive export

| Native type | Text export | Companion |
|-------------|-------------|-----------|
| Docs | `text/markdown` | PDF flag in metadata |
| Sheets | `text/csv` | PDF flag |
| Slides | `text/plain` | PDF flag |
| Other files | Metadata only | — |

### Gmail watch (prepared)

See `GMAIL_WATCH_NOTES` in `@cortex/adapter-gmail`. Push requires a Pub/Sub topic + IAM for `gmail-api-push@system.gserviceaccount.com`. Until then, poll `history.list`.

## Idempotency

| Record type | `source_record_id` |
|-------------|-------------------|
| `calendar_event` | `{calendarId}:{eventId}` |
| `drive_file` | Drive file id |
| `email_message` | Gmail message id |

`account_key`: `workspace:{email}` when `GOOGLE_ACCOUNT_EMAIL` is set, else `workspace`.

## Dry-run (no live OAuth)

```powershell
pnpm backfill -- --source=calendar --dry-run
pnpm backfill -- --source=drive --dry-run
pnpm backfill -- --source=gmail --dry-run --limit=5
```

These use mocks unless `GOOGLE_*` is fully set (or set `GOOGLE_MOCK=1` to force mocks).

Google sources are **not** included in `--source=all` — pass them explicitly.

## Live ingest (only after `.env` credentials)

```powershell
# API running with CORTEX_INGEST_TOKEN
pnpm backfill -- --source=calendar --limit=20
pnpm backfill -- --source=drive --limit=10
pnpm backfill -- --source=gmail --limit=10
```
