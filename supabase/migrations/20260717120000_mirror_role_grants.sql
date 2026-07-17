-- Cortex Mirror DB role + Mirror-safe search_memory.
-- Apply in Dashboard → SQL Editor (or `npx supabase db push`).
-- Then mint a JWT with role claim `cortex_mirror` — see docs/supabase.md.

-- ---------------------------------------------------------------------------
-- 1. Role
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
    create role cortex_mirror nologin noinherit;
  end if;
end
$$;

grant cortex_mirror to authenticator;
grant usage on schema public to cortex_mirror;

-- Allowed reads (derived / sanitised memory)
grant select on public.distillates to cortex_mirror;
grant select on public.entities to cortex_mirror;
grant select on public.entity_links to cortex_mirror;
grant select on public.deletions to cortex_mirror;
grant select on public.cortex_calendar_structure to cortex_mirror;
grant select on public.evidence_capabilities to cortex_mirror;

-- Allowed writes for Mirror twin tools (derived memory only)
grant insert, update on public.distillates to cortex_mirror;
grant insert, update on public.entities to cortex_mirror;
grant insert, update, delete on public.entity_links to cortex_mirror;
grant insert, update on public.evidence_capabilities to cortex_mirror;
grant insert on public.audit_log to cortex_mirror;

-- Explicit denies on raw vault
revoke all on table public.records from cortex_mirror;
revoke all on table public.messages from cortex_mirror;
revoke all on table public.turns from cortex_mirror;
revoke all on table public.sessions from cortex_mirror;
revoke all on table public.tool_calls from cortex_mirror;
revoke all on table public.raw_artifacts from cortex_mirror;
revoke all on table public.source_accounts from cortex_mirror;
revoke all on table public.sync_checkpoints from cortex_mirror;
revoke all on table public.api_tokens from cortex_mirror;

-- ---------------------------------------------------------------------------
-- 2. RPCs: grant search_memory; revoke search_records; Mirror skips records
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as proc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cortex_search_memory'
  loop
    execute format('grant execute on function %s to cortex_mirror', r.proc);
  end loop;

  for r in
    select p.oid::regprocedure as proc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cortex_search_records'
  loop
    execute format('revoke all on function %s from cortex_mirror', r.proc);
  end loop;
end
$$;

-- SECURITY DEFINER so the function can exist, but skip raw records when the
-- JWT role is cortex_mirror (auth.role() from PostgREST / Supabase).
create or replace function public.cortex_search_memory(
  p_owner_id uuid default null,
  p_query text default '',
  p_limit int default 15,
  p_kinds text[] default null,
  p_query_embedding vector(1536) default null,
  p_domains text[] default null,
  p_topics text[] default null,
  p_source_types text[] default null,
  p_min_confidence float8 default null
)
returns table (
  kind text,
  id uuid,
  score float8,
  title text,
  snippet text,
  source_id text,
  session_id uuid,
  record_id uuid,
  record_type text,
  distillate_kind text,
  subject_type text,
  subject_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := trim(coalesce(p_query, ''));
  pattern text;
  lim int := greatest(1, least(coalesce(p_limit, 15), 50));
  mirror_only boolean := coalesce(auth.role(), '') = 'cortex_mirror';
begin
  if q = '' then
    pattern := null;
  else
    pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  (
    select
      'distillate'::text as kind,
      d.id,
      case
        when p_query_embedding is not null and d.embedding is not null
          then (1 - (d.embedding <=> p_query_embedding))::float8
        when pattern is not null and d.content ilike pattern escape '\'
          then 0.72::float8
        else 0.55::float8
      end as score,
      (d.kind || ':' || d.subject_type || '/' || d.subject_id::text) as title,
      left(coalesce(d.content, ''), 280) as snippet,
      null::text as source_id,
      case when d.subject_type = 'session' then d.subject_id else null end as session_id,
      null::uuid as record_id,
      null::text as record_type,
      d.kind as distillate_kind,
      d.subject_type,
      d.subject_id
    from public.distillates d
    where (p_owner_id is null or d.owner_id = p_owner_id)
      and (p_kinds is null or d.kind = any (p_kinds))
      and (
        p_domains is null
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(d.metadata->'domains', '[]'::jsonb)) dom
          where dom = any (p_domains)
        )
        or coalesce(d.metadata->>'domain', '') = any (p_domains)
      )
      and (
        p_topics is null
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(d.metadata->'topics', '[]'::jsonb)) top
          where top ilike any (
            select '%' || t || '%' from unnest(p_topics) as t
          )
        )
      )
      and (
        p_source_types is null
        or coalesce(d.metadata->>'sourceType', d.metadata->>'sourceId', '') = any (p_source_types)
      )
      and (
        p_min_confidence is null
        or coalesce((d.metadata->>'confidence')::float8, 1.0) >= p_min_confidence
      )
      and (
        pattern is null
        or d.content ilike pattern escape '\'
        or d.metadata::text ilike pattern escape '\'
        or (p_query_embedding is not null and d.embedding is not null)
      )
    order by score desc
    limit lim
  )
  union all
  (
    select
      'record'::text as kind,
      r.id,
      0.48::float8 as score,
      coalesce(
        r.payload->>'title',
        r.payload->>'subject',
        r.payload->>'name',
        r.record_type || ':' || r.source_record_id
      ) as title,
      left(r.payload::text, 280) as snippet,
      r.source_id,
      null::uuid as session_id,
      r.id as record_id,
      r.record_type,
      null::text as distillate_kind,
      null::text as subject_type,
      null::uuid as subject_id
    from public.records r
    where not mirror_only
      and (p_owner_id is null or r.owner_id = p_owner_id)
      and r.record_type is distinct from 'calendar_event'
      and pattern is not null
      and (
        r.payload::text ilike pattern escape '\'
        or r.record_type ilike pattern escape '\'
        or r.source_record_id ilike pattern escape '\'
      )
    order by r.occurred_at desc nulls last
    limit lim
  )
  order by score desc
  limit lim;
end;
$$;

comment on function public.cortex_search_memory is
  'Cortex search_memory: distillates + (non-Mirror) records keyword; Mirror JWT skips raw records.';

comment on role cortex_mirror is
  'Cortex Mirror API role — distillates/sanitised views only; no raw vault table SELECT.';
