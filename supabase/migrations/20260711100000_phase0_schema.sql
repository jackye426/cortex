-- Cortex Phase 0 schema
-- EU Supabase project; single-user owner_id on all tables; vault forever (tombstones, no purge).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Sources & sync
-- ---------------------------------------------------------------------------

create table public.sources (
  id text primary key,
  display_name text not null,
  kind text not null check (kind in ('ai', 'email', 'calendar', 'drive', 'code', 'manual')),
  created_at timestamptz not null default now()
);

create table public.source_accounts (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.sources (id) on delete restrict,
  account_key text not null,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, account_key)
);

create table public.sync_checkpoints (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.sources (id) on delete restrict,
  account_key text not null default 'default',
  cursor text not null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (source_id, account_key)
);

-- ---------------------------------------------------------------------------
-- Raw vault metadata (blobs live in Storage bucket `raw`)
-- ---------------------------------------------------------------------------

create table public.raw_artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  source_id text not null references public.sources (id) on delete restrict,
  source_record_id text not null,
  storage_path text not null,
  sha256 text not null,
  mime_type text not null default 'application/json',
  byte_size bigint,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (sha256),
  unique (source_id, source_record_id, sha256)
);

create index raw_artifacts_owner_idx on public.raw_artifacts (owner_id);
create index raw_artifacts_source_record_idx on public.raw_artifacts (source_id, source_record_id);

-- ---------------------------------------------------------------------------
-- Canonical polymorphic records
-- ---------------------------------------------------------------------------

create table public.records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  source_id text not null references public.sources (id) on delete restrict,
  source_record_id text not null,
  record_type text not null,
  payload jsonb not null default '{}'::jsonb,
  content_hash text not null,
  raw_artifact_id uuid references public.raw_artifacts (id) on delete set null,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, source_record_id)
);

create index records_owner_type_idx on public.records (owner_id, record_type);
create index records_occurred_at_idx on public.records (occurred_at desc);

-- ---------------------------------------------------------------------------
-- AI grain: sessions / turns / messages / tool_calls
-- ---------------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  source_id text not null references public.sources (id) on delete restrict,
  source_session_id text not null,
  title text,
  workspace text,
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, source_session_id)
);

create table public.turns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  session_id uuid not null references public.sessions (id) on delete cascade,
  source_turn_id text,
  turn_index int not null,
  role text,
  occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, turn_index)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  turn_id uuid not null references public.turns (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index messages_session_idx on public.messages (session_id);

create table public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  turn_id uuid references public.turns (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  tool_name text not null,
  args_summary text,
  -- Full tool outputs stay in raw vault only (noise rule).
  status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index tool_calls_session_idx on public.tool_calls (session_id);

-- ---------------------------------------------------------------------------
-- Entities
-- ---------------------------------------------------------------------------

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  entity_type text not null,
  canonical_key text not null,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, entity_type, canonical_key)
);

create table public.entity_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  entity_id uuid not null references public.entities (id) on delete cascade,
  linked_type text not null,
  linked_id uuid not null,
  relation text not null default 'related',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (entity_id, linked_type, linked_id, relation)
);

create index entity_links_linked_idx on public.entity_links (linked_type, linked_id);

-- ---------------------------------------------------------------------------
-- Tombstones (vault forever — soft delete only)
-- ---------------------------------------------------------------------------

create table public.deletions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  reason text,
  deleted_at timestamptz not null default now(),
  unique (target_type, target_id)
);

-- ---------------------------------------------------------------------------
-- Distillates (regenerable)
-- ---------------------------------------------------------------------------

create table public.distillates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  subject_type text not null,
  subject_id uuid not null,
  kind text not null default 'summary',
  content text,
  embedding_ref text,
  model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id, kind)
);

-- ---------------------------------------------------------------------------
-- API tokens for ingest + MCP (hashed at rest)
-- ---------------------------------------------------------------------------

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  token_hash text not null unique,
  scopes text[] not null default array['ingest']::text[],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Seed known sources
-- ---------------------------------------------------------------------------

insert into public.sources (id, display_name, kind) values
  ('cursor', 'Cursor', 'ai'),
  ('claude-code', 'Claude Code', 'ai'),
  ('codex', 'Codex', 'ai'),
  ('chatgpt', 'ChatGPT', 'ai'),
  ('chatgpt-export', 'ChatGPT Export', 'ai'),
  ('gmail', 'Gmail', 'email'),
  ('calendar', 'Google Calendar', 'calendar'),
  ('drive', 'Google Drive', 'drive'),
  ('github', 'GitHub', 'code'),
  ('manual', 'Manual', 'manual');

-- ---------------------------------------------------------------------------
-- Storage buckets (private)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('raw', 'raw', false, 524288000),
  ('exports', 'exports', false, 1073741824)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS (single-user owner_id). Policies use auth.uid(); service role bypasses.
-- ---------------------------------------------------------------------------

alter table public.source_accounts enable row level security;
alter table public.sync_checkpoints enable row level security;
alter table public.raw_artifacts enable row level security;
alter table public.records enable row level security;
alter table public.sessions enable row level security;
alter table public.turns enable row level security;
alter table public.messages enable row level security;
alter table public.tool_calls enable row level security;
alter table public.entities enable row level security;
alter table public.entity_links enable row level security;
alter table public.deletions enable row level security;
alter table public.distillates enable row level security;
alter table public.api_tokens enable row level security;

-- Helper predicate: row owned by current auth user
-- (sources table is reference data — no RLS)

create policy source_accounts_owner on public.source_accounts
  for all using (true) with check (true);

-- Note: Phase 0 enables RLS with permissive policies for local/dev.
-- Tighten to owner_id = auth.uid() once Auth is wired (Phase 6/7).
-- Service-role ingest path will bypass RLS regardless.

create policy sync_checkpoints_all on public.sync_checkpoints for all using (true) with check (true);
create policy raw_artifacts_all on public.raw_artifacts for all using (true) with check (true);
create policy records_all on public.records for all using (true) with check (true);
create policy sessions_all on public.sessions for all using (true) with check (true);
create policy turns_all on public.turns for all using (true) with check (true);
create policy messages_all on public.messages for all using (true) with check (true);
create policy tool_calls_all on public.tool_calls for all using (true) with check (true);
create policy entities_all on public.entities for all using (true) with check (true);
create policy entity_links_all on public.entity_links for all using (true) with check (true);
create policy deletions_all on public.deletions for all using (true) with check (true);
create policy distillates_all on public.distillates for all using (true) with check (true);
create policy api_tokens_all on public.api_tokens for all using (true) with check (true);
