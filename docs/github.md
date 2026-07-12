# GitHub work-history (Phase 4)

Cortex ingests **repos, issues, pull requests, and commits** (metadata). It does **not** ingest notifications, Discussions, or Copilot.

Adapter: `packages/adapters/github` (`@cortex/adapter-github`).

## Setup

1. Create a **fine-grained personal access token** at  
   [GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/personal-access-tokens).

2. Token settings (recommended):
   - **Resource owner:** your user (or org if scanning org repos you can access)
   - **Repository access:** All repositories, or only the repos you want in Cortex
   - **Permissions** (Repository):

| Permission | Access | Why |
|------------|--------|-----|
| Metadata | Read-only | Required baseline for repo listing |
| Contents | Read-only | Commit history / metadata |
| Issues | Read-only | Issues (PRs are excluded from this API) |
| Pull requests | Read-only | PR list + metadata |

   Account permissions: none required for basic `/user` + `/user/repos`.

3. Classic PAT alternative (broader): `repo` (private) or `public_repo` (public only). Fine-grained is preferred.

4. Copy into repo `.env` (never commit real tokens):

```env
GITHUB_TOKEN=github_pat_...
# Optional webhook HMAC (API)
GITHUB_WEBHOOK_SECRET=
# Optional GHES
# GITHUB_API_BASE=https://github.example.com/api/v3
```

## Backfill

Dry-run without a token fails with a clear message:

```powershell
pnpm backfill -- --source=github --dry-run --limit=20
# → GITHUB_TOKEN is not set …
```

With token (limited smoke — caps repos when `--limit` is set):

```powershell
pnpm backfill -- --source=github --dry-run --limit=30 --max-repos=3 --no-commits
pnpm backfill -- --source=github --dry-run --since=2026-01-01T00:00:00Z --max-repos=5
```

Post to ingest (API running + `CORTEX_INGEST_TOKEN`):

```powershell
pnpm --filter @cortex/api dev
# other terminal:
pnpm backfill -- --source=github --limit=50 --max-repos=5
```

### Flags

| Flag | Meaning |
|------|---------|
| `--since=ISO` | Incremental lower bound (issues `since`, commits `since`, PR `updated_at` filter) |
| `--max-repos=N` | Cap repos scanned for issues/PRs/commits |
| `--no-commits` | Skip commit history (faster) |
| `--limit=N` | Max envelopes emitted |
| `--page-size=N` | GitHub `per_page` (default 50) |

`github` is **not** included in `--source=all` (needs an explicit token).

## Incremental checkpoints

`SyncCheckpoint` in `@cortex/core` carries an opaque `cursor`. The GitHub adapter stores a JSON `GithubSyncCheckpointCursor`:

- `phase`: `repos` → `issues` → `pulls` → `commits` → `done`
- `since` / per-resource `etags` for `If-None-Match` (304 = skip)
- `repoQueue` / `currentRepo` / `page`

Also exported: `IncrementalHttpCheckpoint` for shared `since` + `etag` + `page` fields.

## Webhooks (near-real-time stub)

API endpoint: `POST /v1/webhooks/github`

1. In the GitHub repo (or org) → Settings → Webhooks → Add webhook  
2. Payload URL: `https://<your-cortex-api>/v1/webhooks/github`  
3. Content type: `application/json`  
4. Secret: same value as `GITHUB_WEBHOOK_SECRET`  
5. Events: **Push**, **Issues**, **Pull requests**, **Repositories** (and Ping)

If `GITHUB_WEBHOOK_SECRET` is set, Cortex verifies `X-Hub-Signature-256`. If unset, verification is skipped (dev only — logged as a warning).

Accepted events map to envelopes (`github_repo` / `github_issue` / `github_pr` / `github_commit`) and run through the same redact → normalize stub path as `/v1/ingest`. Other events are ignored with `{ ignored: true }`.

## Canonical record types

| `recordType` | `source_record_id` |
|--------------|-------------------|
| `github_repo` | `repo:{full_name}` |
| `github_issue` | `issue:{full_name}#{number}` |
| `github_pr` | `pr:{full_name}#{number}` |
| `github_commit` | `commit:{full_name}@{sha}` |

## Out of scope (v1)

- Notifications
- Discussions
- Copilot chat / PR summaries from Copilot
- Full file blob contents (contents permission is for commit metadata only in this phase)
