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
| `distillates` SELECT/upsert, `cortex_search_memory` (distillates only), `cortex_calendar_structure`, entities + links, `evidence_capabilities`, `audit_log` insert | `records` / `messages` / `turns` / `sessions` / `raw_artifacts` SELECT, Storage `raw`/`exports`, `cortex_search_records` |

Ops / collectors / distillate compilers keep the service-role (vault) key. Mirror handlers should use `SUPABASE_MIRROR_KEY` only.

### Set up `SUPABASE_MIRROR_KEY` (walkthrough)

**Status:** role + JWT are real DB isolation. MCP still uses service role until dual-client wiring; set the key now so wiring is a flip, not a scramble.

1. **Apply the Mirror role migration** in Supabase → **SQL Editor** → paste/run:
   - File: `supabase/migrations/20260717120000_mirror_role_grants.sql`
   - Or: https://github.com/jackye426/cortex/blob/main/supabase/migrations/20260717120000_mirror_role_grants.sql  
     (on `main` after this PR merges; until then use the path above on branch `cursor/mirror-role-setup-703c`)
2. **Confirm the role exists** (SQL Editor):

```sql
select rolname from pg_roles where rolname = 'cortex_mirror';
```

3. **Copy the JWT secret**  
   Dashboard → **Project Settings** → **API** → **JWT Secret** (not the anon/service keys).
4. **Mint the Mirror key** (local machine, never commit):

```bash
SUPABASE_JWT_SECRET='paste-jwt-secret-here' node scripts/mint-mirror-jwt.mjs
```

5. **Store the printed token** as `SUPABASE_MIRROR_KEY`:
   - Local `.env`
   - Railway → `@cortex/mcp-server` → Variables  
   Do **not** put it on the ingest API or collectors.
6. **Smoke-test isolation** (optional, with the minted JWT):

```bash
# Should succeed (distillates)
curl "$SUPABASE_URL/rest/v1/distillates?select=id&limit=1" \
  -H "apikey: $SUPABASE_MIRROR_KEY" \
  -H "Authorization: Bearer $SUPABASE_MIRROR_KEY"

# Should fail 401/403/permission (raw vault)
curl "$SUPABASE_URL/rest/v1/records?select=id&limit=1" \
  -H "apikey: $SUPABASE_MIRROR_KEY" \
  -H "Authorization: Bearer $SUPABASE_MIRROR_KEY"
```

7. **Next (code):** wire `/mcp` to `SUPABASE_MIRROR_KEY` and keep `/mcp/ops` + `/v1/*` compilers on `SUPABASE_SERVICE_ROLE_KEY`. Until that lands, setting the env var is prep only — Mirror tools still use service role server-side.

The MCP server (`apps/mcp-server`, [docs/mcp.md](mcp.md)) uses Supabase when `SUPABASE_URL` + a key are set; otherwise it runs in **fixture** mode so tools work without a linked project.
