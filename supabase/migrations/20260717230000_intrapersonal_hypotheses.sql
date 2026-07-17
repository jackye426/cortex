-- Hypothesis ledger + versioned self-model (I3 / Slice S3)

create table public.hypotheses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  claim text not null,
  why_it_matters text not null default '',
  state text not null default 'emerging'
    check (state in ('emerging', 'supported', 'disputed', 'retired')),
  confidence real not null default 0.4
    check (confidence >= 0 and confidence <= 1),
  source_diversity int not null default 0,
  falsifiers jsonb not null default '[]'::jsonb,
  alternative_explanations jsonb not null default '[]'::jsonb,
  domains text[] not null default '{}',
  last_tested_at timestamptz,
  origin text not null default 'ask_mirror',
  assistant_weight real not null default 0.5,
  prior_hypothesis_id uuid references public.hypotheses (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hypotheses_owner_state_idx
  on public.hypotheses (owner_id, state, confidence desc);
create index hypotheses_owner_updated_idx
  on public.hypotheses (owner_id, updated_at desc);

create table public.intrapersonal_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  record_kind text not null,
  title text not null,
  statement text not null,
  epistemic_type text not null default 'interpretation',
  confidence real not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  status text not null default 'active'
    check (status in ('active', 'disputed', 'retired')),
  context jsonb not null default '{}'::jsonb,
  behaviour jsonb not null default '{}'::jsonb,
  outcome jsonb not null default '{}'::jsonb,
  origin text not null default 'inference'
    check (origin in ('self_report', 'inference')),
  hypothesis_id uuid references public.hypotheses (id) on delete set null,
  interest_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index intrapersonal_records_owner_kind_idx
  on public.intrapersonal_records (owner_id, record_kind, status);

create table public.self_model_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  version int not null,
  summary text not null default '',
  compiled_from jsonb not null default '{}'::jsonb,
  strengths jsonb not null default '[]'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  motives jsonb not null default '[]'::jsonb,
  tensions jsonb not null default '[]'::jsonb,
  identity_development jsonb not null default '[]'::jsonb,
  open_question_ids uuid[] not null default '{}',
  supersedes_id uuid references public.self_model_versions (id) on delete set null,
  user_corrections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, version)
);

create index self_model_versions_owner_version_idx
  on public.self_model_versions (owner_id, version desc);

create table public.insight_verdicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  insight_id uuid not null,
  insight_kind text not null
    check (insight_kind in ('hypothesis', 'mirror_item', 'interest', 'self_model_item')),
  verdict text not null
    check (verdict in ('confirm', 'reject', 'refine')),
  note text,
  non_obvious boolean,
  useful boolean,
  created_at timestamptz not null default now()
);

create index insight_verdicts_owner_created_idx
  on public.insight_verdicts (owner_id, created_at desc);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
    grant select, insert, update on public.hypotheses to cortex_mirror;
    grant select, insert, update on public.intrapersonal_records to cortex_mirror;
    grant select, insert on public.self_model_versions to cortex_mirror;
    grant select, insert on public.insight_verdicts to cortex_mirror;
  end if;
end
$$;
