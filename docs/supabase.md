# Supabase (EU) setup

Cortex targets a **European** Supabase project for the vault and canonical store.

## Create project

1. In [Supabase Dashboard](https://supabase.com/dashboard), create a project in an **EU** region (e.g. `eu-west-1` or `eu-central-1`).
2. Copy Project URL, `anon` key, and `service_role` key into `.env` (from `.env.example`). Never commit keys.

## CLI

```bash
# From repo root (Node 25 / pnpm)
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push
```

Local stack (optional):

```bash
npx supabase start
npx supabase status   # copy URL + keys into .env
npx supabase db reset # applies migrations/
```

## Migrations

- `supabase/migrations/20260711100000_phase0_schema.sql` — sources, checkpoints, raw_artifacts, records, AI grain tables, entities, deletions, distillates, api_tokens, Storage buckets `raw` + `exports`.
- `supabase/migrations/20260711200000_sources_calibre_browser_spotify_youtube.sql` — seeds `calibre` / `browser` / `spotify` / `youtube`; extends `sources.kind` for library/browser/music/video. See `docs/sources.md`.
- `supabase/migrations/20260711300000_phase7_audit_log.sql` — `audit_log` for successful authenticated ingest/MCP requests (`source`, `token_id_hash`, `route`). See `docs/hardening.md`.

Phase 0 does **not** require a linked remote project to develop the API stub; link before real vault writes. Apply all migrations before production deploy ([deploy.md](deploy.md)).

The MCP server (`apps/mcp-server`, [docs/mcp.md](mcp.md)) uses Supabase when `SUPABASE_URL` + a key are set; otherwise it runs in **fixture** mode so tools work without a linked project.
