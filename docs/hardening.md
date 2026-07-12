# Cortex hardening checklist (Phase 7)

Use this before relying on production ingest/MCP.

## Collector / backfill

- [ ] `CORTEX_INGEST_URL` + `CORTEX_INGEST_TOKEN` set; dry-run before live backfill
- [ ] Failed POSTs retry with exponential backoff (429 / 5xx / network) via `apps/collector/src/retry.ts`
- [ ] Local resume files under `.cortex/checkpoints/` (gitignored); delete to force full re-ingest of a source
- [ ] Never ingest `auth.json`, Claude `.credentials.json`, Cursor `secret://`, or OAuth refresh tokens

## Vault & deletions (tombstones)

- [x] EU Supabase linked; migrations applied through Phase 7 (`audit_log`)
- [x] Soft-delete only: `POST /v1/deletions` → `public.deletions` (`apps/api/src/deletions.ts`)
- [x] MCP/search paths filter tombstoned `target_type` + `target_id` (`apps/mcp-server/src/store/supabase-store.ts`)
- [x] Do **not** purge Storage objects for vault rows — vault forever

## Auth & audit

- [ ] Separate `CORTEX_MCP_TOKEN` from ingest token when exposing MCP publicly
- [ ] HTTPS only on public API/MCP hosts ([deploy.md](deploy.md))
- [ ] Successful authenticated requests logged: `source`, `token_id_hash` (SHA-256), `route` → `audit_log` / console
- [ ] Confirm audit rows after smoke ingest + MCP `tools/list`
- [ ] Plan rotation into `api_tokens` (hashed at rest); revoke via `revoked_at`

## Redaction

- [ ] Client + server both call `@cortex/redaction` before vault write
- [ ] Patterns cover AI-transcript risks: AWS AKIA/ASIA + secrets, PEM private keys, Google `AIza`, HF/`npm_` tokens, OpenAI/Anthropic/GitHub/Stripe/Slack
- [ ] `pnpm --filter @cortex/redaction test` passes after pattern changes
- [ ] Spot-check a real session sample for new secret shapes; add patterns before broad backfill

## Deploy / backup

- [ ] Railway or Vercel sketch followed for API + MCP ([deploy.md](deploy.md)) — local pm2 first ([ops-windows.md](ops-windows.md)); HTTPS deploy when ready
- [x] EU region confirmed on Supabase project
- [ ] DB dump + Storage sync schedule documented; restore drill once
- [x] Collector remains on trusted Windows host (pm2); not exposed publicly

## Explicit non-goals (still)

- GDPR/DSR automation, multi-tenant RLS polish, Docker/WSL requirement
