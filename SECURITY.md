# Cortex Supabase security

Personal vault. The Data API (`anon` / `authenticated`) is **deny-by-default**. Collectors, ingest, Ops MCP, and distillate compilers use `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). Mirror MCP uses `SUPABASE_MIRROR_KEY` (`cortex_mirror` JWT) with table grants + RLS policies on derived memory only.

This repo is **Cortex** (EU project, historically `lxcrdadydyboklgnyjba`). **synaptic-docmap** is a separate Supabase project and is **not** migrated here.

## What changed (2026-09)

Migration: [`supabase/migrations/20260916120000_rls_deny_by_default.sql`](supabase/migrations/20260916120000_rls_deny_by_default.sql)

| Layer | Behavior |
|-------|----------|
| All `public` tables | `ENABLE ROW LEVEL SECURITY` |
| Phase 0 `USING (true)` policies | Dropped |
| `anon` / `authenticated` / `PUBLIC` | `REVOKE` on tables, sequences, functions; default privileges stopped |
| `service_role` | Grants kept (ingest / Ops / compilers) |
| `cortex_mirror` | Policies + grants on distillates, entities, intrapersonal, sanitised calendar view, audit insert — **not** raw vault (`records`, `messages`, `sessions`, `raw_artifacts`, `api_tokens`, …) |
| RPCs | `cortex_search_memory` executable by service_role + cortex_mirror; `cortex_search_records` service_role only |
| `cortex_calendar_structure` | Stays owner-definer so Mirror can read structure without `SELECT` on `records`; anon cannot `SELECT` the view |

No table is left as an intentional public Data API. `public.sources` is a catalog, still RLS-locked.

## Apply (do not put secrets in git)

Linked CLI (preferred):

```bash
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push
```

Or paste the migration SQL into Dashboard → SQL Editor → Run.

One-off via DB URL (password from Dashboard → Database; never commit it):

```bash
DATABASE_URL='postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres' \
  node scripts/apply-migration.mjs supabase/migrations/20260916120000_rls_deny_by_default.sql
```

Production hosts must set `SUPABASE_SERVICE_ROLE_KEY`. The publishable/anon key cannot read or write vault rows after this migration.

## Verify in Advisors

Dashboard → **Advisors** → **Security** (or `npx supabase db advisors --linked` on CLI v2.81.3+).

Expect **ERROR** checks `rls_disabled_in_public` (0013) and `sensitive_columns_exposed` (0023) to be **clear** for Cortex public tables.

SQL smoke (SQL Editor):

```sql
-- Should return 0 rows (0013 / 0023 shape): public tables, RLS off, anon or authenticated can SELECT
select n.nspname, c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
  and (
    has_table_privilege('anon', c.oid, 'SELECT')
    or has_table_privilege('authenticated', c.oid, 'SELECT')
  );

-- Anon should not SELECT vault / PII-ish columns
select has_table_privilege('anon', 'public.observations', 'SELECT') as anon_observations,
       has_table_privilege('anon', 'public.api_tokens', 'SELECT') as anon_api_tokens,
       has_table_privilege('anon', 'public.records', 'SELECT') as anon_records,
       has_table_privilege('anon', 'public.messages', 'SELECT') as anon_messages;
```

Optional HTTP check (anon key is public-by-design; this must 401/403 or empty/error, never row data):

```bash
curl "$SUPABASE_URL/rest/v1/records?select=id&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

INFO finding `rls_enabled_no_policy` (0008) on vault tables is **expected**: no policies for anon means the Data API cannot see rows. Do not add `USING (true)` to “clear” it.

## Residual risks

- **Not applied until you `db push`.** This PR is schema-as-code; Advisors on the live project stay red until the SQL runs.
- **`SUPABASE_SERVICE_ROLE_KEY` on Railway** still bypasses RLS. Treat host compromise as full vault access. Mirror isolation still needs `SUPABASE_MIRROR_KEY` wired ([docs/supabase.md](docs/supabase.md)).
- **`cortex_calendar_structure`** is a definer view (needed so Mirror does not get `records` SELECT). Anon/authenticated grants are revoked; do not re-grant.
- **`cortex_search_memory`** is `SECURITY DEFINER`. Execute is revoked from anon/authenticated; do not grant it back.
- **Storage** buckets `raw` / `exports` are private and live in `storage`, which Advisors 0013 exclude. Keep buckets non-public; do not add open `storage.objects` policies.
- **synaptic-docmap** (and any other Supabase project) is out of this repo. Re-run Advisors there separately.
- **Supabase Auth is not wired.** Policies are role-based (`service_role` / `cortex_mirror`), not `auth.uid()`. Multi-tenant owner RLS remains a non-goal ([docs/hardening.md](docs/hardening.md)).
- **Local fallback:** API/MCP still *accept* `SUPABASE_ANON_KEY` if service role is unset; after this migration those writes fail closed. Set the service role key.

## Related

- [docs/supabase.md](docs/supabase.md) — project link, Mirror JWT
- [docs/mirror-privilege-plan.md](docs/mirror-privilege-plan.md) — vault vs Mirror credentials
- [docs/hardening.md](docs/hardening.md) — Phase 7 checklist
