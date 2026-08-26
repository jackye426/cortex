-- Company Brain V0 schema for a *separate* Supabase project.
-- Do not apply these migrations to the personal Cortex database.

create table if not exists public.cb_actors (
  id text primary key,
  kind text not null check (kind in ('founder', 'agent', 'ingest')),
  display_name text not null,
  founder_key text check (founder_key in ('jack', 'eric'))
);

create table if not exists public.cb_source_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_event_id text not null,
  entity_key text not null,
  version_key text not null,
  actor_id text references public.cb_actors (id),
  source_action_at timestamptz not null,
  captured_at timestamptz not null default now(),
  payload jsonb not null,
  scope_decision text not null check (scope_decision in ('accepted', 'rejected')),
  reject_reason text,
  provenance jsonb not null default '{}'::jsonb,
  latest_for_entity boolean not null default false,
  unique (source, external_event_id)
);

create index if not exists cb_source_events_entity_time
  on public.cb_source_events (entity_key, source_action_at desc);

create table if not exists public.cb_observations (
  id uuid primary key default gen_random_uuid(),
  statement text not null,
  epistemic_class text not null check (epistemic_class in ('fact', 'observation', 'interpretation')),
  event_id uuid not null references public.cb_source_events (id),
  topic_keys text[] not null default '{}',
  actor_id text references public.cb_actors (id),
  created_at timestamptz not null default now()
);

create table if not exists public.cb_proposals (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('pending', 'approved', 'rejected', 'superseded')),
  state_key text not null,
  statement text not null,
  epistemic_class text not null check (epistemic_class in ('fact', 'observation', 'interpretation')),
  confidence real not null default 0.5,
  proposer_id text not null references public.cb_actors (id),
  evidence_ids text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cb_verdicts (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.cb_proposals (id),
  action text not null check (action in ('approve', 'reject', 'refine')),
  approver_id text not null references public.cb_actors (id),
  note text,
  refinement_statement text,
  created_at timestamptz not null default now()
);

create table if not exists public.cb_state_revisions (
  id uuid primary key default gen_random_uuid(),
  state_key text not null,
  statement text not null,
  epistemic_class text not null check (epistemic_class in ('fact', 'observation', 'interpretation')),
  confidence real not null default 0.5,
  effective_at timestamptz not null,
  supersedes_id uuid references public.cb_state_revisions (id),
  evidence_ids text[] not null default '{}',
  proposal_id uuid references public.cb_proposals (id),
  verdict_id uuid references public.cb_verdicts (id),
  created_at timestamptz not null default now()
);

create table if not exists public.cb_current_state (
  state_key text primary key,
  revision_id uuid not null references public.cb_state_revisions (id)
);

alter table public.cb_source_events enable row level security;
alter table public.cb_observations enable row level security;
alter table public.cb_proposals enable row level security;
alter table public.cb_verdicts enable row level security;
alter table public.cb_state_revisions enable row level security;
alter table public.cb_current_state enable row level security;

-- Roles: ingest writes events; agents propose; founders approve.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'company_brain_ingest') then
    create role company_brain_ingest nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'company_brain_agent') then
    create role company_brain_agent nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'company_brain_founder') then
    create role company_brain_founder nologin;
  end if;
end
$$;

grant select, insert on public.cb_source_events, public.cb_observations to company_brain_ingest;
grant select on public.cb_source_events, public.cb_observations, public.cb_proposals, public.cb_state_revisions, public.cb_current_state to company_brain_agent;
grant insert on public.cb_proposals, public.cb_observations to company_brain_agent;
grant select, insert, update on public.cb_proposals, public.cb_verdicts, public.cb_state_revisions, public.cb_current_state to company_brain_founder;
grant select on public.cb_source_events, public.cb_observations to company_brain_founder;
