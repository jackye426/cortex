-- Cortex Data API lockdown (Supabase Advisors 0013 + 0023, Sep 2026).
--
-- Access model (single-user personal vault, no browser Supabase Auth):
--   * service_role (ingest API, Ops MCP, compilers) — BYPASSRLS; keep table grants.
--   * cortex_mirror (Mirror MCP JWT) — RLS applies; policies below match existing grants.
--   * anon / authenticated — no table grants, no policies (deny-by-default).
--
-- Phase 0 enabled RLS with USING (true) stub policies; later intrapersonal tables
-- shipped with RLS off. Advisors flagged rls_disabled_in_public (all public tables
-- without RLS) and sensitive_columns_exposed (e.g. observations.session_id).
--
-- This migration does not invent credentials or touch dashboard secrets.
-- Apply: `npx supabase db push` (linked) or paste into SQL Editor. See SECURITY.md.

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on every public table (covers in-repo + any dashboard extras).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    begin
      execute format(
        'alter table %I.%I enable row level security',
        r.schema_name,
        r.table_name
      );
    exception
      when insufficient_privilege then
        raise notice 'skip RLS enable on %.% (privilege)', r.schema_name, r.table_name;
    end;
  end loop;
end
$$;

-- Known tables (idempotent if already enabled).
alter table if exists public.sources enable row level security;
alter table if exists public.source_accounts enable row level security;
alter table if exists public.sync_checkpoints enable row level security;
alter table if exists public.raw_artifacts enable row level security;
alter table if exists public.records enable row level security;
alter table if exists public.sessions enable row level security;
alter table if exists public.turns enable row level security;
alter table if exists public.messages enable row level security;
alter table if exists public.tool_calls enable row level security;
alter table if exists public.entities enable row level security;
alter table if exists public.entity_links enable row level security;
alter table if exists public.deletions enable row level security;
alter table if exists public.distillates enable row level security;
alter table if exists public.api_tokens enable row level security;
alter table if exists public.audit_log enable row level security;
alter table if exists public.evidence_capabilities enable row level security;
alter table if exists public.observations enable row level security;
alter table if exists public.claim_evidence enable row level security;
alter table if exists public.interests enable row level security;
alter table if exists public.affect_signals enable row level security;
alter table if exists public.hypotheses enable row level security;
alter table if exists public.intrapersonal_records enable row level security;
alter table if exists public.self_model_versions enable row level security;
alter table if exists public.insight_verdicts enable row level security;
alter table if exists public.decisions enable row level security;
alter table if exists public.decision_outcomes enable row level security;
alter table if exists public.experiments enable row level security;
alter table if exists public.prediction_events enable row level security;
alter table if exists public.self_model_diffs enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Drop Phase 0 / Phase 7 always-true policies (anon-readable via Data API).
-- ---------------------------------------------------------------------------
drop policy if exists source_accounts_owner on public.source_accounts;
drop policy if exists sync_checkpoints_all on public.sync_checkpoints;
drop policy if exists raw_artifacts_all on public.raw_artifacts;
drop policy if exists records_all on public.records;
drop policy if exists sessions_all on public.sessions;
drop policy if exists turns_all on public.turns;
drop policy if exists messages_all on public.messages;
drop policy if exists tool_calls_all on public.tool_calls;
drop policy if exists entities_all on public.entities;
drop policy if exists entity_links_all on public.entity_links;
drop policy if exists deletions_all on public.deletions;
drop policy if exists distillates_all on public.distillates;
drop policy if exists api_tokens_all on public.api_tokens;
drop policy if exists audit_log_all on public.audit_log;
drop policy if exists evidence_capabilities_all on public.evidence_capabilities;

-- Any remaining tautology policies that apply to PUBLIC / anon / authenticated.
do $$
declare
  r record;
begin
  for r in
    select
      nsp.nspname as schema_name,
      pc.relname as table_name,
      pol.polname as policy_name
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class pc on pol.polrelid = pc.oid
    join pg_catalog.pg_namespace nsp on pc.relnamespace = nsp.oid
    where nsp.nspname = 'public'
      and pol.polpermissive
      and (
        pol.polroles = array[0::oid]
        or exists (
          select 1
          from unnest(pol.polroles) as role_oid
          where role_oid::regrole::text in ('anon', 'authenticated')
        )
      )
      and (
        pg_get_expr(pol.polqual, pol.polrelid) in ('true', '(true)', '1 = 1', '(1 = 1)')
        or pg_get_expr(pol.polwithcheck, pol.polrelid) in ('true', '(true)', '1 = 1', '(1 = 1)')
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      r.policy_name,
      r.schema_name,
      r.table_name
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Revoke Data API grants from anon / authenticated / PUBLIC.
--    Grants are a separate layer from RLS; default Supabase privileges
--    otherwise leave SELECT on public tables for the anon key.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel, c.relkind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
  loop
    begin
      if r.relkind = 'S' then
        execute format('revoke all on sequence %s from public, anon, authenticated', r.rel);
      else
        execute format('revoke all on table %s from public, anon, authenticated', r.rel);
      end if;
    exception
      when insufficient_privilege then
        raise notice 'skip revoke on % (privilege)', r.rel;
      when undefined_table then
        raise notice 'skip revoke on % (undefined)', r.rel;
      when undefined_object then
        raise notice 'skip revoke on % (undefined object)', r.rel;
    end;
    begin
      if r.relkind = 'S' then
        execute format('grant all on sequence %s to service_role', r.rel);
      else
        execute format('grant all on table %s to service_role', r.rel);
      end if;
    exception
      when insufficient_privilege then
        raise notice 'skip service_role grant on %', r.rel;
    end;
  end loop;

  for r in
    select p.oid::regprocedure as proc
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', r.proc);
    exception
      when insufficient_privilege then
        raise notice 'skip function revoke %', r.proc;
      when undefined_function then
        raise notice 'skip function revoke % (undefined)', r.proc;
    end;
    begin
      execute format('grant execute on function %s to service_role', r.proc);
    exception
      when insufficient_privilege then
        raise notice 'skip service_role execute on %', r.proc;
    end;
  end loop;
end
$$;

do $$
declare
  creator text;
begin
  foreach creator in array array['postgres', 'supabase_admin']
  loop
    if exists (select 1 from pg_roles where rolname = creator) then
      begin
        execute format(
          'alter default privileges for role %I in schema public revoke select, insert, update, delete, truncate, references, trigger on tables from anon, authenticated',
          creator
        );
        execute format(
          'alter default privileges for role %I in schema public revoke usage, select, update on sequences from anon, authenticated',
          creator
        );
        execute format(
          'alter default privileges for role %I in schema public revoke execute on functions from anon, authenticated, public',
          creator
        );
      exception
        when insufficient_privilege then
          raise notice 'skip default privileges for role %', creator;
      end;
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. RPCs: pin search_path and hide from anon, one overload at a time.
--    Never COMMENT/GRANT/ALTER public.cortex_search_memory without a signature:
--    6-arg (20260712200000) and 9-arg (20260713120000) overloads can coexist
--    and unqualified names fail with SQLSTATE 42725.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as proc, p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('cortex_search_memory', 'cortex_search_records')
  loop
    execute format('alter function %s set search_path = public', r.proc);
    execute format('revoke all on function %s from public, anon, authenticated', r.proc);
    execute format('grant execute on function %s to service_role', r.proc);
    if r.proname = 'cortex_search_memory'
       and exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
      execute format('grant execute on function %s to cortex_mirror', r.proc);
    end if;
    if r.proname = 'cortex_search_records'
       and exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
      execute format('revoke all on function %s from cortex_mirror', r.proc);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Sanitised calendar view: remain owner-definer so Mirror can read structure
--    without SELECT on public.records. Not a public table — revoke API roles.
--    Do not set security_invoker=true: that would require records SELECT for Mirror.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.cortex_calendar_structure') is not null then
    execute 'revoke all on table public.cortex_calendar_structure from public, anon, authenticated';
    execute 'grant select on table public.cortex_calendar_structure to service_role';
    if exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
      execute 'grant select on table public.cortex_calendar_structure to cortex_mirror';
    end if;
    execute $c$
      comment on view public.cortex_calendar_structure is
        'Mirror-safe calendar fields. SECURITY DEFINER on purpose (no records GRANT to cortex_mirror). Not exposed to anon/authenticated.';
    $c$;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. cortex_mirror RLS policies (role does not BYPASSRLS).
--    Predicates use auth.role() so Advisors 0024 (literal USING true on
--    anon/authenticated) does not apply. Mirror JWT has no auth.uid().
-- ---------------------------------------------------------------------------
do $$
declare
  spec record;
  polname text;
  cmd text;
  using_sql text := 'auth.role() = ''cortex_mirror''';
  check_sql text := 'auth.role() = ''cortex_mirror''';
begin
  if not exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
    raise notice 'cortex_mirror role missing; vault remains deny-by-default for anon/authenticated';
    return;
  end if;

  for spec in
    select * from (
      values
        ('distillates', array['select', 'insert', 'update']::text[]),
        ('entities', array['select', 'insert', 'update']::text[]),
        ('entity_links', array['select', 'insert', 'update', 'delete']::text[]),
        ('deletions', array['select']::text[]),
        ('evidence_capabilities', array['select', 'insert', 'update']::text[]),
        ('audit_log', array['insert']::text[]),
        ('observations', array['select', 'insert', 'update']::text[]),
        ('claim_evidence', array['select', 'insert', 'update', 'delete']::text[]),
        ('interests', array['select', 'insert', 'update']::text[]),
        ('affect_signals', array['select', 'insert', 'update']::text[]),
        ('hypotheses', array['select', 'insert', 'update']::text[]),
        ('intrapersonal_records', array['select', 'insert', 'update']::text[]),
        ('self_model_versions', array['select', 'insert']::text[]),
        ('insight_verdicts', array['select', 'insert']::text[]),
        ('decisions', array['select', 'insert', 'update']::text[]),
        ('decision_outcomes', array['select', 'insert', 'update']::text[]),
        ('experiments', array['select', 'insert', 'update']::text[]),
        ('prediction_events', array['select', 'insert', 'update']::text[]),
        ('self_model_diffs', array['select', 'insert']::text[])
    ) as t(table_name, commands)
  loop
    if to_regclass(format('public.%I', spec.table_name)) is null then
      continue;
    end if;

    foreach cmd in array spec.commands
    loop
      polname := spec.table_name || '_mirror_' || cmd;
      execute format('drop policy if exists %I on public.%I', polname, spec.table_name);
      if cmd = 'select' or cmd = 'delete' then
        execute format(
          'create policy %I on public.%I for %s to cortex_mirror using (%s)',
          polname,
          spec.table_name,
          cmd,
          using_sql
        );
      elsif cmd = 'insert' then
        execute format(
          'create policy %I on public.%I for insert to cortex_mirror with check (%s)',
          polname,
          spec.table_name,
          check_sql
        );
      else
        execute format(
          'create policy %I on public.%I for %s to cortex_mirror using (%s) with check (%s)',
          polname,
          spec.table_name,
          cmd,
          using_sql,
          check_sql
        );
      end if;
    end loop;
  end loop;
end
$$;

-- Re-assert Mirror table grants (idempotent; RLS still applies).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
    grant usage on schema public to cortex_mirror;
    grant select, insert, update on public.distillates to cortex_mirror;
    grant select, insert, update on public.entities to cortex_mirror;
    grant select, insert, update, delete on public.entity_links to cortex_mirror;
    grant select on public.deletions to cortex_mirror;
    grant select, insert, update on public.evidence_capabilities to cortex_mirror;
    grant insert on public.audit_log to cortex_mirror;
    if to_regclass('public.observations') is not null then
      grant select, insert, update on public.observations to cortex_mirror;
      grant select, insert, update, delete on public.claim_evidence to cortex_mirror;
    end if;
    if to_regclass('public.interests') is not null then
      grant select, insert, update on public.interests to cortex_mirror;
      grant select, insert, update on public.affect_signals to cortex_mirror;
    end if;
    if to_regclass('public.hypotheses') is not null then
      grant select, insert, update on public.hypotheses to cortex_mirror;
      grant select, insert, update on public.intrapersonal_records to cortex_mirror;
      grant select, insert on public.self_model_versions to cortex_mirror;
      grant select, insert on public.insight_verdicts to cortex_mirror;
    end if;
    if to_regclass('public.decisions') is not null then
      grant select, insert, update on public.decisions to cortex_mirror;
      grant select, insert, update on public.decision_outcomes to cortex_mirror;
      grant select, insert, update on public.experiments to cortex_mirror;
      grant select, insert, update on public.prediction_events to cortex_mirror;
    end if;
    if to_regclass('public.self_model_diffs') is not null then
      grant select, insert on public.self_model_diffs to cortex_mirror;
    end if;

    revoke all on table public.records from cortex_mirror;
    revoke all on table public.messages from cortex_mirror;
    revoke all on table public.turns from cortex_mirror;
    revoke all on table public.sessions from cortex_mirror;
    revoke all on table public.tool_calls from cortex_mirror;
    revoke all on table public.raw_artifacts from cortex_mirror;
    revoke all on table public.source_accounts from cortex_mirror;
    revoke all on table public.sync_checkpoints from cortex_mirror;
    revoke all on table public.api_tokens from cortex_mirror;
  end if;
end
$$;

comment on table public.sources is
  'Ingest source catalog. RLS enabled; no anon/authenticated policies. Not a public API.';
comment on table public.api_tokens is
  'Hashed ingest/MCP tokens. RLS enabled; service_role only (no Data API policies).';
comment on table public.observations is
  'Intrapersonal atoms including session_id. RLS on; not exposed to anon/authenticated.';
comment on table public.audit_log is
  'Authenticated request trail (token_id_hash only). RLS on; Mirror insert; no anon SELECT.';
