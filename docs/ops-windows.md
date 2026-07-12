# Cortex Windows ops (always-on)

**Production layout:** ingest API + MCP run on **Railway** (HTTPS). This Windows host only needs the **collector** (Gmail/Calendar/Drive incremental) plus agent **hooks** posting to the public ingest URL.

## Prerequisites

1. Repo-root `.env` with at least:
   - `CORTEX_INGEST_URL` — Railway API origin (e.g. `https://…up.railway.app`)
   - `CORTEX_INGEST_TOKEN` — must match the Railway API service
   - `CORTEX_MCP_TOKEN` — for Cursor/Claude MCP clients (Railway MCP service)
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (local backfill / distillate CLIs)
   - Google / GitHub tokens as needed for sync sources
2. Build collector (and packages) once after pull:

```powershell
cd "C:\Users\yulon\Desktop\Current Projects\Cortex"
pnpm install
pnpm --filter @cortex/collector... build
```

3. [pm2](https://pm2.keymetrics.io/) installed globally: `npm i -g pm2`

## Start collector (Railway-backed)

```powershell
cd "C:\Users\yulon\Desktop\Current Projects\Cortex"
pm2 start ecosystem.config.cjs --only cortex-collector
pm2 save
pm2 status
pm2 logs cortex-collector --lines 50
```

Twin pipeline (requires MCP build + Supabase + OpenRouter in `.env`):

```powershell
pnpm --filter @cortex/mcp-server... build
pm2 start ecosystem.config.cjs --only cortex-twin-nightly,cortex-twin-weekly
# one-off historical backfill:
pnpm twin-pipeline -- --mode=backfill --max-batches=20
```

Optional local API/MCP (dev only — not required when Railway is up):

```powershell
pm2 start ecosystem.config.cjs --only cortex-api,cortex-mcp
```

| Name | Role |
|------|------|
| `cortex-collector` | Polls Gmail history + Calendar/Drive → `CORTEX_INGEST_URL` |
| `cortex-twin-nightly` | Cron 03:00 — distill + embed + seed-entities (`twin-pipeline --mode=nightly`) |
| `cortex-twin-weekly` | Cron Sun 04:00 — weekly twin rollup + self-model |
| `cortex-api` / `cortex-mcp` | Local ports 8787 / 8790 — skip if using Railway |

Survive logon:

```powershell
pm2 save
pm2 startup
# run the command pm2 prints, then:
pm2 save
```

Stop / restart:

```powershell
pm2 restart cortex-collector
pm2 stop cortex-collector
pm2 delete cortex-collector
```

## Smoke checks

```powershell
Invoke-RestMethod "$env:CORTEX_INGEST_URL/health"   # or paste Railway API URL
Invoke-RestMethod "https://<mcp-host>/health"       # expect store: supabase
```

Remote MCP tools list (bearer = `CORTEX_MCP_TOKEN`):

```powershell
$token = (Get-Content .env | Where-Object { $_ -match '^CORTEX_MCP_TOKEN=' }) -replace '^[^=]+=',''
curl -Method POST "https://<mcp-host>/mcp" `
  -Headers @{
    Authorization = "Bearer $token"
    "Content-Type" = "application/json"
    Accept = "application/json, text/event-stream"
  } `
  -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Collector sync knobs

| Env | Default | Meaning |
|-----|---------|---------|
| `CORTEX_COLLECTOR_INTERVAL_MS` | `300000` (5m) | Tick interval |
| `CORTEX_SYNC_GMAIL` | `1` | Poll Gmail `history.list` |
| `CORTEX_SYNC_CALENDAR` | `1` | Calendar `syncToken` |
| `CORTEX_SYNC_DRIVE` | `1` | Drive `changes.list` |
| `GOOGLE_MOCK` | unset/`0` | Must be live for real sync |

Sync cursors are stored separately from backfill message-id checkpoints under `.cortex/checkpoints/` as `gmail__sync.json`, `calendar__sync.json`, `drive__sync.json`.

## Hooks

See [hooks/README.md](../hooks/README.md). Point agent configs at the scripts under `hooks/` and set user env `CORTEX_INGEST_URL` + `CORTEX_INGEST_TOKEN` (or rely on the `.cmd` loaders that read repo `.env`).

## Deploy

API + MCP HTTPS, env vars, and post-deploy smoke: [deploy.md](deploy.md). Hardening checklist: [hardening.md](hardening.md). Keep the collector on this trusted Windows host only (Google OAuth tokens / local SQLite never leave the machine via that path except through ingest).
