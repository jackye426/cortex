# Cortex Windows ops (always-on)

Keep the ingest API, MCP server, and collector daemon running on this machine so hooks and incremental Google sync land in the EU vault without manual backfill.

## Prerequisites

1. Repo-root `.env` with at least:
   - `CORTEX_INGEST_TOKEN`
   - `CORTEX_MCP_TOKEN` (or reuse ingest token locally)
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   - Google / GitHub tokens as needed for sync sources
2. Build once after pull:

```powershell
cd "C:\Users\yulon\Desktop\Current Projects\Cortex"
pnpm install
pnpm build
```

3. [pm2](https://pm2.keymetrics.io/) installed globally: `npm i -g pm2`

## Start all services

```powershell
cd "C:\Users\yulon\Desktop\Current Projects\Cortex"
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs cortex-api --lines 50
```

Processes:

| Name | Port / role |
|------|-------------|
| `cortex-api` | `:8787` — `POST /v1/ingest`, webhooks |
| `cortex-mcp` | `:8790` — streamable HTTP MCP |
| `cortex-collector` | polls Gmail history + Calendar/Drive incremental |

Survive logon:

```powershell
pm2 save
pm2 startup
# run the command pm2 prints, then:
pm2 save
```

Stop / restart:

```powershell
pm2 restart all
pm2 stop all
pm2 delete all
```

## Smoke checks

```powershell
Invoke-RestMethod http://localhost:8787/health
Invoke-RestMethod http://localhost:8790/health
```

MCP tools list (bearer = `CORTEX_MCP_TOKEN` or ingest token):

```powershell
$token = (Get-Content .env | Where-Object { $_ -match '^CORTEX_MCP_TOKEN=' }) -replace '^[^=]+=',''
# fallback: CORTEX_INGEST_TOKEN
curl -s -X POST http://localhost:8790/mcp `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
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

## Deploy later

When ready for HTTPS + GitHub webhooks, follow [deploy.md](deploy.md) and [hardening.md](hardening.md). Until then, keep collectors on this trusted Windows host only.
