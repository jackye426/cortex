# Cortex Windows ops (always-on)

**GBrain-first layout:** Windows collector writes L1 pages into `CORTEX_GBRAIN_DIR`. Default agent MCP is `gbrain serve`. Twin-pipeline cron is off — run compilers after dream (`pnpm coding-ops` / `weekly-mirror` / `llm-ops`). See [gbrain-schema-pack.md](gbrain-schema-pack.md).

## Prerequisites

1. Repo-root `.env` with at least:
   - `CORTEX_GBRAIN_DIR` — brain git repo root (session-v1 / mail / digest pages)
   - Google tokens as needed for Gmail/Calendar/Drive writers
   - Legacy HTTP ingest (`CORTEX_INGEST_URL` / `CORTEX_INGEST_TOKEN`) is unused for Claude/Cursor/Codex daily use
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

Compilers (after `gbrain dream`, not a pm2 cron):

```powershell
pnpm --filter @cortex/mcp-server... build
pnpm coding-ops -- --pages=$env:CORTEX_GBRAIN_DIR --dry-run
pnpm weekly-mirror -- --pages=$env:CORTEX_GBRAIN_DIR --dry-run
pnpm llm-ops -- --pages=$env:CORTEX_GBRAIN_DIR --dry-run
```

Optional local API/MCP (dev only — not required when Railway is up):

```powershell
pm2 start ecosystem.config.cjs --only cortex-api,cortex-mcp
```

| Name | Role |
|------|------|
| `cortex-collector` | Polls Gmail/Calendar/Drive → `CORTEX_GBRAIN_DIR` (HTTP ingest leftover-only) |
| `gbrain serve` | Default agent MCP (not cortex-mcp) |
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
