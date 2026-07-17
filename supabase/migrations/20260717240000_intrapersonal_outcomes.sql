-- Decisions, experiments, calibration (I4 / Slice S4)

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null,
  statement text not null default '',
  decided_at timestamptz not null default now(),
  expected_outcome text,
  related_hypothesis_ids uuid[] not null default '{}',
  related_entity_keys text[] not null default '{}',
  source text not null default 'user'
    check (source in ('user', 'mined', 'migrated_distillate')),
  distillate_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index decisions_owner_decided_idx
  on public.decisions (owner_id, decided_at desc);

create table public.decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  decision_id uuid not null references public.decisions (id) on delete cascade,
  recorded_at timestamptz not null default now(),
  actual_outcome text not null,
  aligned_with_expected boolean,
  evidence jsonb not null default '[]'::jsonb,
  learning text,
  metadata jsonb not null default '{}'::jsonb
);

create index decision_outcomes_decision_idx
  on public.decision_outcomes (decision_id, recorded_at desc);

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  hypothesis_id uuid not null references public.hypotheses (id) on delete cascade,
  title text not null,
  protocol text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'active', 'completed', 'abandoned')),
  proposed_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  result_summary text,
  result_polarity text
    check (result_polarity is null or result_polarity in ('supports', 'contradicts', 'inconclusive')),
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index experiments_owner_status_idx
  on public.experiments (owner_id, status, due_at);

create table public.prediction_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  claim_id uuid not null,
  claim_kind text not null default 'hypothesis',
  domain text,
  predicted text not null,
  actual text,
  correct boolean,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index prediction_events_owner_idx
  on public.prediction_events (owner_id, created_at desc);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
    grant select, insert, update on public.decisions to cortex_mirror;
    grant select, insert, update on public.decision_outcomes to cortex_mirror;
    grant select, insert, update on public.experiments to cortex_mirror;
    grant select, insert, update on public.prediction_events to cortex_mirror;
  end if;
end
$$;
