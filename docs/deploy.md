# Deploy Cortex (API + MCP)

Personal vault stack: **ingest API** + **remote MCP** + **EU Supabase**. Collectors stay on your Windows machine.

## Prerequisites

- Linked **EU** Supabase project (see [supabase.md](supabase.md)) — run `npx supabase db push` so Phase 0–7 migrations (including `audit_log`) apply.
- Long-lived bearer tokens in env (`CORTEX_INGEST_TOKEN`, preferably separate `CORTEX_MCP_TOKEN`). Rotate via `api_tokens` later; never commit secrets.
- HTTPS only in production.

## Suggested layout

| Service | App | Default port | Notes |
|---------|-----|--------------|-------|
| Ingest API | `apps/api` | 8787 | `POST /v1/ingest`, webhooks, deletions stub |
| MCP | `apps/mcp-server` | 8790 | Streamable HTTP `/mcp` — see [mcp.md](mcp.md) |
| Collector | `apps/collector` | local | Backfill + pm2 on Windows; not deployed to cloud |

Point collectors / the ChatGPT extension at the public API URL. Point Cursor / Claude / Codex MCP connectors at the public MCP URL.

## Railway (live)

Project services: `@cortex/api` + `@cortex/mcp-server` (repo root as root directory for both).

| Service | Public URL (example) | Build | Start |
|---------|----------------------|-------|-------|
| API | `https://cortexapi-production-9b74.up.railway.app` | `pnpm --filter @cortex/api build` | `pnpm --filter @cortex/api start` |
| MCP | `https://cortexmcp-server-production-1c59.up.railway.app` | `pnpm --filter @cortex/mcp-server build` | `pnpm --filter @cortex/mcp-server start` |

**Env (both):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`  
**API also:** `CORTEX_INGEST_TOKEN`, optional `GITHUB_WEBHOOK_SECRET`, `CORTEX_OWNER_ID`  
**MCP also:** `CORTEX_MCP_TOKEN` (do not omit Supabase or health reports `store: "fixture"`)

Local Windows after deploy:

1. Set `CORTEX_INGEST_URL` to the API origin (no trailing slash).
2. Align `CORTEX_INGEST_TOKEN` / `CORTEX_MCP_TOKEN` with Railway.
3. Write project `.cursor/mcp.json` (gitignored) from `.cursor/mcp.json.example`.
4. `pm2 start ecosystem.config.cjs --only cortex-collector` then `pm2 save` — see [ops-windows.md](ops-windows.md).

Build note: API/MCP `build` scripts compile workspace deps (`pnpm --filter …^...`) before `tsc`.

## Vercel sketch

Vercel fits serverless HTTP well; long-lived MCP sessions are trickier.

1. Two Vercel projects (or one monorepo with two apps) pointing at `apps/api` and `apps/mcp-server`.
2. Prefer **Fluid Compute** / Node server entry (`@hono/node-server`) or wrap Hono with the Vercel adapter if you standardize on serverless handlers.
3. Set the same env vars as Railway; use Vercel encrypted env for tokens.
4. For MCP clients that expect sticky streamable HTTP, Railway (or a small always-on VM) is usually simpler than pure serverless — validate with your client before committing.

## EU Supabase reminder

- Create the project in an **EU** region (`eu-west-1` / `eu-central-1`).
- `npx supabase link --project-ref <ref>` then `npx supabase db push`.
- Storage buckets `raw` + `exports` are private; service role only on the API/MCP hosts.

## Backup / restore

**Database**

```bash
# Logical backup (linked project or connection string)
npx supabase db dump -f cortex-db-$(Get-Date -Format yyyyMMdd).sql

# Restore into a fresh EU project (review before applying)
psql "$DATABASE_URL" -f cortex-db-YYYYMMDD.sql
# or: npx supabase db reset  # local only — destructive
```

**Storage**

- Periodically sync `raw` / `exports` buckets (Supabase Dashboard → Storage, or `supabase storage` / S3-compatible tools).
- Vault policy is **forever** — restore should re-apply tombstones from `deletions`, not purge objects.

**Tokens & collector**

- Keep a sealed copy of rotatable token hashes / provisioning notes (not raw tokens in git).
- Local backfill checkpoints live under `.cortex/checkpoints/` (gitignored); they are resume hints only — not a substitute for DB backup.

## Smoke after deploy

```powershell
curl -Method POST https://<api-host>/v1/ingest `
  -Headers @{ Authorization = "Bearer <token>"; "Content-Type" = "application/json" } `
  -Body '{"source":"manual","sourceRecordId":"deploy-smoke","body":{"ok":true},"provenance":{"collector":"curl"}}'

curl https://<mcp-host>/health
```

See [hardening.md](hardening.md) for the ops checklist.
