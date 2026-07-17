# Post-gate source distillate adapters

Session + YouTube digests ship in v1. Other sources stay **keyword-only in retrieval** until quality-gate passes and each adapter is **enabled** for scheduled distill.

## Enablement order + acceptance

| Order | Adapter | Compiler | Grain | Acceptance check |
|-------|---------|----------|-------|------------------|
| 0 | `youtube-interest` (peer) | youtube weekly LLM | ISO week of watches/videos | Reflective Mirror cites `youtube_interest_digest` |
| 1 | `email-thread` | `email-thread-v2` | Multi-message Gmail threads → commitments + open loops | `ask_mirror` cites `email_thread_digest` for commitments |
| 2 | `github-outcome` | `github-outcome-v2` | PR/issue outcomes (not README/files) | Mirror cites shipped/stalled digests |
| 3 | `calendar-event` | `calendar-event-v2` | Kept meetings (allowlist or ≥2 attendees) | No gym/focus digests in sample of 20 |
| 4 | `drive-file` | `drive-file-v2` | High-signal docs after sensitivity gate | Operational search returns digests; dry-run reports `skippedSensitive` |
| 5 | `browser-interest` | `browser-interest-v2` | One digest per ISO week (bookmarks + searches) | Week-scoped (not all-time newest) |
| 6 | `spotify-interest` | `spotify-interest-v2` | One digest per ISO week of plays/episodes | No `[object Object]` artists; week-scoped |
| 7 | `reading-interest` | `reading-interest-v1` | One digest per ISO week of Calibre ebooks touched/added | Reflective Mirror cites `reading_interest_digest`; feeds Interest Map |

Enable in twin-pipeline via env (comma list). **Default (post-acceptance)** runs all gated adapters:

`email-thread,github-outcome,calendar-event,drive-file,browser-interest,spotify-interest,reading-interest`

```bash
# Optional override on Railway MCP / Windows pm2 .env:
CORTEX_SOURCE_ADAPTERS=email-thread,github-outcome,calendar-event
CORTEX_SOURCE_ADAPTERS=none   # disable scheduled source adapters
```

## Ingest vs distill cadence

Distillates do **not** run on ingest. New vault rows become memory on the next scheduled distill (or a manual CLI run).

| Leg | Who | What |
|-----|-----|------|
| **Ingest** | Windows collector `sync-loop` (gmail/calendar/drive); manual/periodic backfill (github, browser, spotify, youtube-takeout, chatgpt) | Rows → Supabase `records` |
| **Distill nightly** | `POST /v1/twin-pipeline` mode=nightly | Sessions + YouTube current week + enabled operational adapters (`email-thread`, `github-outcome`, `calendar-event`, `drive-file`) |
| **Distill weekly** | twin-pipeline mode=weekly | Portrait / priority / briefs + interest-map + enabled reflective adapters (`browser-interest`, `spotify-interest`, `reading-interest`) |

### Incremental skip / recompile

Per subject: skip if a digest exists at the current `compilerVersion` **and** `metadata.sourceFingerprint` is unchanged; else write/refresh. Cap `--limit` per adapter in pipeline (default 15) so one night cannot LLM-blast the whole vault.

**Fingerprint:** hash of sorted `source_record_id`s + latest `occurred_at` (or file `modifiedTime` / Spotify `playedAt`) in the grain unit.

### Lag model

- **Sync sources** (Gmail / Calendar / Drive): vault lag ≈ collector interval; memory lag ≈ next nightly (hours).
- **Backfill-only** (browser / Spotify / YouTube Takeout / ChatGPT export): memory updates only after (1) you ingest a new export/backfill **and** (2) the next scheduled distill. Not realtime.
- **Escape hatch:** `pnpm source-adapter -- --adapter=… --limit=N` after a backfill.

Not in scope for this rollout: inventing new ingest schedulers for browser/Spotify/Takeout. Follow-on: pm2 cron for `backfill --source=…` if continuous interest digests become important.

## Per-adapter specs

### email-thread-v2

- **Do:** threads with ≥2 messages; human conversational mail
- **Skip:** spam, promotions, social, noreply, newsletter shells, most CATEGORY_UPDATES
- **LLM JSON:** `{ summary, commitments[], openLoops[], topics[] }`
- **Idempotency:** `compilerVersion: email-thread-v2` + fingerprint

### github-outcome-v2

- **Do:** `github_pr` / `github_issue` with human `userLogin`
- **Skip:** bots/dependabot/renovate; never distill `github_repo` / README blobs here
- **LLM JSON:** `{ summary, outcome: shipped\|closed\|stalled\|open, nextLink?, topics[] }`
- **Stall heuristic:** open and idle >14d → stalled
- **Idempotency:** `github-outcome-v2`; subjectId = record id

### calendar-event-v2

- **Do:** title matches `1:1|sync|review|interview|standup|retro|demo|pilot` **or** ≥2 attendees and not noise; recent ~60d window
- **Skip:** gym/workout/focus/block/lunch/commute/personal; most `recurringEventId` unless allowlist
- **LLM JSON:** `{ summary, meetingType, relatedProjects[], openLoops[], topics[] }` — no fake commitments from title alone
- **Idempotency:** `calendar-event-v2`

### drive-file-v2

- **Do:** recently modified doc-like files with `textPreview` / export text
- **Skip (noise):** `.tmp`, `Copy of`, sheets dumps, images-only, trashed, empty preview
- **Skip (sensitive) — fail closed:** never send preview to LLM if flagged
  1. Folder/name denylist (`CORTEX_DRIVE_SENSITIVE_PATHS`, defaults: password, credentials, secrets, private, tax, passport, bank, ssn, identity, 2fa, recovery codes)
  2. Filename heuristics (password/credential/passport/medical/…)
  3. Content scan via `@cortex/redaction` `SECRET_PATTERNS` + lightweight PII cues — any hit → skip (do not redact-and-summarize)
  4. Optional allowlist `CORTEX_DRIVE_DISTILL_ALLOW` — if set, only matching paths distill; denylist still wins
- **Telemetry:** `skippedSensitive` + reason codes (`path`, `filename`, `secret_pattern`, `pii_heuristic`, `allowlist`) — never log secret text
- **LLM JSON:** `{ summary, docRole: spec\|brief\|notes\|other, topics[], decisions[] }`
- **Lenses:** `drive_file_digest` in `OPERATIONAL_KINDS`
- **ask_mirror:** boost on `\b(drive|doc|spec|brief|gdoc)\b`

### browser-interest-v2

- **Grain:** one digest per ISO week of `bookmark` + `search_query` in week range
- **Skip:** visit firehose (not in vault); login/facebook/gmail/youtube/maps; single-char / navigational queries
- **LLM JSON:** `{ summary, themes[], recurring[], oneOff[], topics[] }`
- **ask_mirror:** boost on `\b(browser|search|bookmark|research theme)\b`

### spotify-interest-v2

- **Grain:** one digest per ISO week of plays/episodes (`playedAt` / `occurred_at`)
- **Do:** recurring artists/shows (count > 1); artist names from `artist.name` (not `String(object)`)
- **LLM JSON:** `{ summary, recurring[], themes[], topics[] }` — reflective only
- **ask_mirror:** boost on `\b(spotify|listening|podcast|music)\b`

### youtube-interest (wave-0 peer)

Already LLM-compiled in `youtube-digest.ts`. Prefer **Takeout watch history** for real week rows:

```powershell
pnpm backfill -- --source=youtube-takeout --path=D:\Downloads\takeout.zip --dry-run --limit=20
pnpm backfill -- --source=youtube-takeout --path=D:\Downloads\takeout.zip
pnpm youtube-digest -- --dry-run
# or
pnpm source-adapter -- --adapter=youtube-interest --dry-run
```

Store listing uses `listRecordsByTypeInRange` so week filters are not blinded by a global top-100 cap. Soft ask_mirror boost when the query mentions YouTube/watching.

## Grain / noise (summary)

| Source | Do | Skip |
|--------|----|------|
| Gmail | Threads (≥2 msgs), commitments, open loops | newsletters, noreply, promotions, social, spam |
| Calendar | Allowlist meetings or ≥2 attendees | gym, focus blocks, lunch, most recurring |
| GitHub | PR/issue outcomes | bots, dependabot, README/file blobs |
| Drive | High-signal docs after sensitivity gate | dumps, sensitive path/name/content |
| Browser | Weekly bookmark/search themes | visit history, navigational queries |
| Spotify | Weekly artist/show clusters | every play as identity |
| YouTube | Weekly watch themes (Takeout preferred) | sparse library-only dates when Takeout available |

## Shared infra

- `listRecordsByType` cap raised (500) for operational grouping
- `listRecordsByTypeInRange(type, since, until)` for true week / recent windows
- `sourceFingerprint` + `compilerVersion` on every digest metadata
- Slim CLI output (no embedding vectors in terminal dumps)

## Rollout checklist (per adapter)

```powershell
pnpm source-adapter -- --list
pnpm source-adapter -- --adapter=<id> --dry-run --limit=5
# inspect commitments/outcomes/themes — reject if noise
pnpm source-adapter -- --adapter=<id> --limit=5
# ask_mirror spot-check with that adapter's eval question
pnpm quality-gate -- --limit=11
```

Do **not** add the next adapter to `CORTEX_SOURCE_ADAPTERS` until: dry-run content is citation-worthy, live write ≤5–10, Mirror cites the new kind, quality-gate does not regress.
