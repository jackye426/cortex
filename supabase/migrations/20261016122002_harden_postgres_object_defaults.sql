-- Cortex: complete fail-closed defaults for future postgres-owned objects.
-- Existing table/RPC grants and RLS policies are intentionally unchanged.
-- Postgres 17 includes MAINTAIN, omitted by the original explicit revoke list.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;

-- A per-schema revoke cannot remove PostgreSQL's global PUBLIC EXECUTE default.
-- Remove it globally for the application migration owner only. Existing schema
-- grants to service_role in public/job_search and all existing functions remain.
-- Future client-callable functions must receive explicit EXECUTE grants.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

-- Rollback (reinstates the previous unsafe defaults; existing ACLs unaffected):
-- alter default privileges for role postgres in schema public
--   grant maintain on tables to anon, authenticated;
-- alter default privileges for role postgres grant execute on functions to public;
