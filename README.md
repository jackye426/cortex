# Cortex

Personal AI/session vault, canonical store, and remote MCP. **Collectors run natively on Windows**; ingest API + MCP deploy on **Railway** (primary). Data lands in an EU Supabase project.

## Status

**Live path:** vault + authenticated MCP retrieval → regenerable **LLM distillates** → **pgvector on distillates** → Personal Executive Twin scaffolding (entities / project briefs). No Obsidian middle tier.

| Area | State |
|------|--------|
| Collectors (Windows) | Claude/Codex/Cursor sessions, GitHub, Google Workspace, Calibre, bookmarks, Spotify, YouTube API |
| Ingest API + MCP | Railway; bearer auth; work-biased `list_recent_work`, payload `search_records`, hybrid `search_memory` |
| Distillates | OpenAI-compatible HTTP (`OPENAI_API_KEY`); embed on write; `pnpm embed-backfill` for existing rows |
| Twin (D1–D5) | Entities, project briefs, priority_vs_actual, decisions, self_model/portrait, allocator_context, ask_mirror — see [docs/twin.md](docs/twin.md) / [docs/memory-substrate.md](docs/memory-substrate.md) |
| Source adapters | Post-gate grain plan (email → GitHub → calendar…) — [docs/source-adapters.md](docs/source-adapters.md) |
| Parallel data | YouTube Takeout + ChatGPT export (sharded ZIP supported) — does not block MCP |

**Phases (history):** 0 scaffold → 1 AI adapters → 2b Calibre/browser → 3 ChatGPT → 4 GitHub → 5 Google → 5b Spotify/YouTube → 6 MCP → 7 hardening. Details in `docs/`.

## Requirements

- Node.js 25+
- [pnpm](https://pnpm.io) 10+
- Optional: [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase`), [pm2](https://pm2.keymetrics.io/) for the collector

## Layout

```text
apps/api                 Ingest API (POST /v1/ingest)
apps/mcp-server          Remote MCP (streamable HTTP + bearer auth)
apps/collector           Windows collector + backfill CLI
apps/chatgpt-extension   MV3 extension → ingest (chatgpt.com)
packages/core            SourceAdapter, RawEnvelope, checkpoints
packages/redaction       Secret patterns before upload
packages/adapters/*      Source adapters (claude-code, codex, chatgpt-export, …)
packages/normalize       Raw → canonical mappers
hooks/                   Claude / Codex reference hook scripts
supabase/                config + migrations (EU project)
docs/                    Setup notes (mcp, deploy, twin, chatgpt, …)
```

## Quick start

```powershell
# From repo root
Copy-Item .env.example .env
# Edit .env — set CORTEX_INGEST_TOKEN at minimum

pnpm install
pnpm --filter @cortex/core build
pnpm --filter @cortex/redaction build
pnpm --filter @cortex/normalize build
pnpm --filter @cortex/adapter-claude-code build
pnpm --filter @cortex/adapter-codex build
pnpm --filter @cortex/adapter-chatgpt-export build
pnpm --filter @cortex/api dev
```

### Phase 1 backfill (Claude + Codex)

Dry-run against local `~\.claude\projects` and `~\.codex\sessions` (no upload):

```powershell
pnpm backfill:dry
# or limit for a quick sample
pnpm backfill -- --dry-run --limit=3
pnpm backfill -- --source=claude --dry-run --limit=5
pnpm backfill -- --source=codex --dry-run --limit=2
pnpm backfill -- --source=calibre --dry-run
pnpm backfill -- --source=browser --dry-run --limit=20
pnpm backfill -- --source=github --dry-run --limit=20
```

Post to local ingest API (API must be running; uses `CORTEX_INGEST_URL` + `CORTEX_INGEST_TOKEN`):

```powershell
pnpm backfill -- --limit=3
pnpm backfill -- --source=all
pnpm backfill -- --source=calibre
pnpm backfill -- --source=browser --limit=50
```

### Phase 2b Calibre + Browser

Paths and noise rules: [docs/sources.md](docs/sources.md). Calibre is metadata + paths only (no ebook binaries). Browser is bookmarks + `keyword_search_terms` only (no visit firehose).

### ChatGPT export + extension

Official export ZIP (Settings → Data controls → Export) plus optional MV3 extension for ongoing capture:

```powershell
pnpm backfill -- --source=chatgpt-export --path=D:\Downloads\chatgpt.zip --dry-run
pnpm backfill -- --source=chatgpt-export --path=D:\Downloads\chatgpt.zip
```

Install steps: [docs/chatgpt.md](docs/chatgpt.md). Supports single `conversations.json` or sharded `conversations-NNN.json`.

### Phase 4 GitHub

```powershell
# Fails clearly if GITHUB_TOKEN missing
pnpm backfill -- --source=github --dry-run --limit=20

# With token in .env — limited smoke
pnpm backfill -- --source=github --dry-run --limit=30 --max-repos=3 --no-commits
```

PAT permissions + webhooks: [docs/github.md](docs/github.md).

### Spotify + YouTube (+ Takeout when ready)

```powershell
# Mock dry-run (no credentials)
pnpm backfill -- --source=spotify --dry-run
pnpm backfill -- --source=youtube --dry-run

# Privacy export / Takeout (path required unless dry-run mock)
pnpm backfill -- --source=spotify-export --path=D:\Downloads\spotify.zip --dry-run
pnpm backfill -- --source=youtube-takeout --path=D:\Downloads\takeout.zip --dry-run
```

1. Google Takeout → YouTube (watch history / playlists) → download ZIP.
2. Dry-run then ingest with `--source=youtube-takeout --path=…`.
3. Prefer API sync (`--source=youtube`) for ongoing; Takeout fills history gaps for later distillates.

OAuth + Takeout notes: [docs/spotify-youtube.md](docs/spotify-youtube.md). Missing ZIP is fine — document path and continue.

### MCP (Railway-primary)

Production MCP is on Railway. Local:

```powershell
pnpm dev:mcp
# MCP: http://localhost:8790/mcp  (Bearer CORTEX_MCP_TOKEN or CORTEX_INGEST_TOKEN)
pnpm distillate -- --dry-run --limit=5
```

Client snippets + retrieval playbook: [docs/mcp.md](docs/mcp.md). Twin path: [docs/twin.md](docs/twin.md).

**Railway env (MCP service):** `CORTEX_MCP_TOKEN` (or ingest token), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORTEX_OWNER_ID` (optional), `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, `CORTEX_DISTILLATE_MODEL`, `CORTEX_EMBEDDING_MODEL`, optional `CORTEX_SOURCE_ADAPTERS` (default `email-thread`; see [docs/source-adapters.md](docs/source-adapters.md)).

### Ingest smoke test

```powershell
curl -Method POST http://localhost:8787/v1/ingest `
  -Headers @{ Authorization = "Bearer local-dev-token"; "Content-Type" = "application/json" } `
  -Body '{"source":"manual","sourceRecordId":"test-1","body":{"hello":"world","key":"sk-abcdefghijklmnopqrstuvwxyz012345"},"provenance":{"collector":"curl"}}'
```

Expect `ok: true`, a `contentHash`, and redaction hits for the fake API key.

### Hooks

See [hooks/README.md](hooks/README.md) for Claude `Stop` / `PostToolUse`, Codex `Stop`, and Cursor hooks.

### Always-on (pm2)

Prefer the **root** ecosystem (API + MCP + collector). Full runbook: [docs/ops-windows.md](docs/ops-windows.md).

```powershell
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
```

Collector-only: `apps/collector/ecosystem.config.cjs`.

### Supabase

See [docs/supabase.md](docs/supabase.md). Migrations ship in-repo (including `20260712200000_distillate_embeddings_search.sql` for pgvector + search RPCs). Linking an EU project is required before real vault writes. Apply with `npx supabase db push` when linked.

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install workspace |
| `pnpm build` | Build all packages/apps |
| `pnpm dev:api` | Run ingest API (tsx watch) |
| `pnpm dev:mcp` | Run remote MCP server (tsx watch) |
| `pnpm distillate` | Session distillates (LLM or stub); `--project-brief`, `--seed-entities`, `--priority-vs-actual`, `--self-model` |
| `pnpm embed-backfill` | Embed existing distillates without re-LLM |
| `pnpm youtube-digest` | Weekly YouTube interest digest |
| `pnpm quality-gate` | Run baseline Mirror evaluation questions |
| `pnpm source-adapter` | Post-gate source distillate adapters (`--list`) |
| `pnpm twin-pipeline` | Nightly/weekly/backfill orchestration |
| `pnpm dev:collector` | Run collector daemon (Google incremental sync) |
| `pnpm pm2:start` | Start API + MCP + collector via pm2 |
| `pnpm backfill` | Backfill → ingest |
| `pnpm backfill:dry` | Parse/summarize only (no POST) |
| `pnpm backfill -- --source=chatgpt-export --path=…` | ChatGPT export ZIP/folder → ingest |
| `pnpm backfill -- --source=github` | GitHub work-history → ingest (needs `GITHUB_TOKEN`) |
| `pnpm backfill -- --source=spotify` | Spotify library + recently played (mock without creds) |
| `pnpm backfill -- --source=youtube` | YouTube likes/playlists (mock without Google creds) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Typecheck all packages |

## Auth note

Phase 0 uses a single shared `CORTEX_INGEST_TOKEN` env var. Later phases hash rotatable tokens in `api_tokens`.
