# Cortex live access-control verification

Observed 2026-10-16 at approximately 12:20 UTC against project
`lxcrdadydyboklgnyjba`. This is a point-in-time database verification, not a
blanket security certification.

## Deployment status

- [PR #21](https://github.com/jackye426/cortex/pull/21) merged into main on
  2026-10-11 at 20:00:10 UTC, merge commit
  `73c3ee02d6e540e6bf10425e6e5ecd7fa588b416`.
- [PR #20](https://github.com/jackye426/cortex/pull/20) is closed and unmerged.
- Production migration history already contained
  `20260916120000_rls_deny_by_default` before this investigation.
  Its recorded statements are null, so the exact SQL and original apply time
  cannot be recovered from that row. The live controls below were independently
  verified and match the intended lockdown.
- This investigation applied `20261016122002_harden_postgres_object_defaults`.
  It removes residual MAINTAIN grants on future postgres-created public tables,
  and removes the global PUBLIC EXECUTE default on future postgres-created
  functions. Existing grants, policies, functions, and application data are unchanged.
  Existing service_role defaults in public/job_search are retained.
  Supabase-managed supabase_admin defaults are unchanged.

## Live proof

- All 36 public base tables have RLS enabled. All job_search tables also have RLS.
- anon/authenticated have no effective table privileges in public/job_search,
  including MAINTAIN, and no residual column grants were found.
- Both application search RPCs deny EXECUTE to anon/authenticated.
  cortex_search_records also denies EXECUTE to cortex_mirror.
- Role impersonation in a transaction passed before and after the correction:
  public-role SELECT and DML planning denied, service_role reads/DML planning
  and both search RPCs allowed, Mirror derived reads/DML planning and memory
  search allowed, Mirror raw record access denied.
- Mirror memory search returned no raw-record kind in the tested query.
- Public publishable-key HTTP probes for records, observations, api_tokens, and
  cortex_search_memory returned HTTP 401 with PostgreSQL 42501 permission errors.
- No storage buckets are public, and no storage policies expose private objects.
- `node --test scripts/rls-migrations.test.mjs`: 5/5 pass.
- Reusable SQL: [scripts/verify-live-access.sql](../scripts/verify-live-access.sql).

The write probes use EXPLAIN and do not persist rows. Hosted application
credentials and end-to-end ingest were not inspected or exercised. These checks
establish database permissions, not all application behavior.

## Current Advisors

No ERROR findings, including no rls_disabled_in_public or
sensitive_columns_exposed.

Remaining:
- 17 INFO rls_enabled_no_policy findings on private tables, consistent with
  deny-by-default access. Do not create public allow-all policies to clear them.
- [vector extension in public (WARN)](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).
  Moving it requires dependency/operator testing and is not part of this ACL fix.
- [Leaked password protection disabled (WARN)](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
  No browser Supabase Auth is used according to PR #21. The current connection
  does not expose an Auth-configuration update tool.

## Separate affected DocMap project

The advisory names `okpbevwdqgzmnrowifcn` (synaptic-docmap).
The connected Supabase project named DocMap is `oewczjseteyvyvikxxaz`,
which is a different project and was not substituted.

Both get_project and get_advisors reject access to the affected ID.
Its current findings, schema, grants, policies, and application access model
remain unverified. No changes were applied there.

[LOOP-35](https://app.notion.com/p/3dc196f56373810098d3f75281e532a3)
must remain open until access to that exact project is restored and its live
controls are verified.

## References

- [Supabase Data API grants and RLS](https://supabase.com/docs/guides/api/securing-your-api)
- [PostgreSQL default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html):
  per-schema defaults are additive, so global PUBLIC EXECUTE must be revoked
  without IN SCHEMA.
