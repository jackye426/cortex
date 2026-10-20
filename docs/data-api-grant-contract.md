# Data API grant contract

Run `pnpm test:grants` (Node 25+, pnpm 10.33.0). CI runs this and the existing
RLS migration tests on every PR and main push. It needs no Supabase credentials,
network connection, Docker, or hosted data after dependencies are installed.

The disposable PGlite PostgreSQL database executes the complete checked-in SQL
migration chain unchanged, including pgcrypto and pgvector, with automatic
public table and sequence grants disabled. Minimal synthetic auth/storage
scaffolding substitutes for Supabase-managed objects. The test verifies effective
service-role DML privileges, RLS, denial of anon/authenticated DML, and selected
Mirror boundary checks. Negative probes prove missing grants, excess public
access, broad service grants and missing RLS fail.

## Adding a table

1. Record its creation migration and reviewed service-role DML operations in
   `scripts/data-api-grants.contract.json`. An empty array is valid for a table
   intentionally inaccessible through the service-role Data API.
2. In the same migration, enable RLS and explicitly grant only needed operations,
   for example `GRANT SELECT ON public.example TO service_role;`. RLS does not
   replace grants. Do not restore blanket anon/authenticated defaults.
3. Add any required policy and caller-specific tests. New tables cannot grant
   service-role TRUNCATE, REFERENCES, TRIGGER or MAINTAIN under this DML-only contract.
4. Run both test suites. Explicitly test sequences, views and RPC permissions if
   introducing those objects; this contract currently covers base tables only.

Historical table names are frozen in the test: their creation migrations relied
on the existing September explicit grant pass. We deliberately preserve that
working history and existing Mirror grants rather than rewriting migrations or
adding a new production grant sweep. All later tables must meet the contract at
creation, not rely on a later migration or Supabase defaults. The manifest records
existing backend CRUD access; it does not broaden production permissions.

## Scope and deployment

This change deploys no SQL and changes no production grants. It covers repository
main, not unmerged Company Brain work (PR #19) or production-only objects. PR #22
separately records already-applied default hardening and is not duplicated here.
This is a PostgreSQL replay, not a complete hosted Supabase reset: it does not
certify PostgREST configuration, real JWT behavior, managed storage/auth, RPCs,
views, owned sequences, or deployed schema drift. Before a production release,
replay the actual combined migration chain in a disposable Supabase project and
verify the application’s intended API operations there. Never run test mutations
against production. No migration or production approval is needed for this test
PR; any subsequent permission-changing deployment must be reviewed separately.
