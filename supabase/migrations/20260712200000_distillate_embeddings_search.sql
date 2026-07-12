-- Track A search RPCs + Track C pgvector on distillates (not full records).
-- Apply: npx supabase db push (when linked) or run in SQL editor.

create extension if not exists vector;

-- Embedding column for distillates only (text-embedding-3-small = 1536 dims).
alter table public.distillates
  add column if not exists embedding vector(1536);

create index if not exists distillates_embedding_hnsw_idx
  on public.distillates
  using hnsw (embedding vector_cosine_ops);

-- Keyword search over payload::text (+ id/type filters). Prefer this over
-- PostgREST-only ILIKE on record_type/source ids.
create or replace function public.cortex_search_records(
  p_owner_id uuid default null,
  p_query text default '',
  p_limit int default 20,
  p_record_types text[] default null,
  p_sources text[] default null,
  p_exclude_types text[] default null,
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns setof public.records
language plpgsql
stable
as $$
declare
  q text := trim(coalesce(p_query, ''));
  pattern text;
  lim int := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  if q = '' then
    pattern := null;
  else
    pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select r.*
  from public.records r
  where (p_owner_id is null or r.owner_id = p_owner_id)
    and (p_record_types is null or r.record_type = any (p_record_types))
    and (p_sources is null or r.source_id = any (p_sources))
    and (p_exclude_types is null or not (r.record_type = any (p_exclude_types)))
    and (p_since is null or r.occurred_at >= p_since)
    and (p_until is null or r.occurred_at <= p_until)
    and (
      pattern is null
      or r.record_type ilike pattern escape '\'
      or r.source_id ilike pattern escape '\'
      or r.source_record_id ilike pattern escape '\'
      or r.payload::text ilike pattern escape '\'
    )
  order by r.occurred_at desc nulls last
  limit lim;
end;
$$;

-- Hybrid memory: distillate keyword (+ optional vector distance if query
-- embedding is passed as p_query_embedding). Without embedding, keyword only.
create or replace function public.cortex_search_memory(
  p_owner_id uuid default null,
  p_query text default '',
  p_limit int default 15,
  p_kinds text[] default null,
  p_query_embedding vector(1536) default null
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
as $$
declare
  q text := trim(coalesce(p_query, ''));
  pattern text;
  lim int := greatest(1, least(coalesce(p_limit, 15), 50));
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
    where (p_owner_id is null or r.owner_id = p_owner_id)
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

comment on function public.cortex_search_records is
  'Cortex MCP search_records: ILIKE over payload::text + ids/types with filters.';
comment on function public.cortex_search_memory is
  'Cortex MCP search_memory: distillates (keyword/vector) + records keyword; no raw blob embeddings.';
