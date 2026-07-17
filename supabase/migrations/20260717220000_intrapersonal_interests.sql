-- Intrapersonal interest + affect model (I2 / Slice S2)

-- ---------------------------------------------------------------------------
-- interests
-- ---------------------------------------------------------------------------

create table public.interests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  canonical_key text not null,
  display_name text not null,
  class text not null
    check (class in (
      'terminal', 'instrumental', 'aspirational', 'situational', 'dormant'
    )),
  status text not null default 'active'
    check (status in ('active', 'dormant', 'retired')),
  confidence real not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  summary text not null default '',
  first_seen_at timestamptz,
  last_active_at timestamptz,
  recurrence_score real not null default 0,
  specificity_score real not null default 0,
  voluntary_return_score real not null default 0,
  persistence_after_utility real not null default 0,
  energy_delta real,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, canonical_key)
);

create index interests_owner_class_idx
  on public.interests (owner_id, class, status);
create index interests_owner_active_idx
  on public.interests (owner_id, last_active_at desc nulls last);

comment on table public.interests is
  'First-class interest entities with terminal/instrumental/… classification (I2).';

-- ---------------------------------------------------------------------------
-- affect_signals
-- ---------------------------------------------------------------------------

create table public.affect_signals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  signal_type text not null
    check (signal_type in ('energy', 'valence', 'friction', 'flow')),
  value real not null,
  source_family text not null,
  observation_id uuid references public.observations (id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  capture_mode text not null default 'inferred'
    check (capture_mode in ('inferred', 'self_report')),
  created_at timestamptz not null default now()
);

create index affect_signals_owner_occurred_idx
  on public.affect_signals (owner_id, occurred_at desc nulls last);
create index affect_signals_owner_type_idx
  on public.affect_signals (owner_id, signal_type);

comment on table public.affect_signals is
  'Lightweight energy/valence/friction signals (inferred or self-reported).';

-- ---------------------------------------------------------------------------
-- Mirror grants
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
    grant select, insert, update on public.interests to cortex_mirror;
    grant select, insert, update on public.affect_signals to cortex_mirror;
  end if;
end
$$;
