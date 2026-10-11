-- Cortex Phase 7 — MCP / ingest audit log
-- Append-only trail of successful authenticated requests (no raw tokens).

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  -- Ingest source id, "mcp", "webhook:github", etc.
  source text not null,
  -- SHA-256 of bearer secret, or api_tokens.token_hash when resolved.
  token_id_hash text not null,
  -- Request path, e.g. /v1/ingest or /mcp.
  route text not null,
  method text not null default 'POST',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);

create index if not exists audit_log_token_id_hash_idx
  on public.audit_log (token_id_hash);

create index if not exists audit_log_route_idx
  on public.audit_log (route);

alter table public.audit_log enable row level security;

-- No policies here: deny-by-default for anon/authenticated. Mirror INSERT
-- and PUBLIC/anon REVOKE land in 20260916120000_rls_deny_by_default.sql.

comment on table public.audit_log is
  'Successful authenticated ingest/MCP requests; token_id_hash only, never raw secrets.';
