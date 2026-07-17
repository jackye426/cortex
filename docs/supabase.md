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

Also apply:

- `20260712200000_distillate_embeddings_search.sql` — embeddings + `cortex_search_memory`
- `20260713120000_memory_lenses_search.sql` — operational/reflective lenses
- `20260716160000_evidence_capabilities_and_calendar_view.sql` — evidence broker table + `cortex_calendar_structure` view

One-off apply without CLI link (needs DB password from Dashboard → Database):

```bash
DATABASE_URL='postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres' \
  node scripts/apply-migration.mjs supabase/migrations/20260716160000_evidence_capabilities_and_calendar_view.sql
```

Or paste that migration SQL into Dashboard → SQL Editor → Run.

### What “true Mirror Supabase role” means

Today privilege is mostly **application-layer**: Mirror MCP tools refuse raw vault APIs, but the MCP process often still holds `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS, can `SELECT` anything).

A **true Mirror role** is a separate Postgres role + API key that is *physically unable* to read raw vault tables even if Mirror code is buggy or compromised:

| Allowed | Denied |
|---------|--------|
| `distillates` SELECT, `cortex_search_memory`, sanitised calendar view, entities (read), broker capability RPCs, portrait reads as policy allows | `records` / `messages` / `turns` / `raw_artifacts` SELECT, Storage `raw`/`exports`, unrestricted record search |

Ops / collectors / distillate compilers keep the service-role (vault) key. Mirror handlers should use `SUPABASE_MIRROR_KEY` only. Creating the role is a Dashboard/SQL ops step; the app documents the key until grants are applied.

The MCP server (`apps/mcp-server`, [docs/mcp.md](mcp.md)) uses Supabase when `SUPABASE_URL` + a key are set; otherwise it runs in **fixture** mode so tools work without a linked project.
