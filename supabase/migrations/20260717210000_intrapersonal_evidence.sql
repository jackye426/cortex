-- Intrapersonal evidence integrity (I1 / Slice S1)
-- Durable observations + claim_evidence join for later hypothesis ledger.

-- ---------------------------------------------------------------------------
-- observations: factual atoms (observation | self_report only)
-- ---------------------------------------------------------------------------

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  epistemic_type text not null
    check (epistemic_type in ('observation', 'self_report')),
  statement text not null,
  source_family text not null,
  independence_group text not null,
  occurred_at timestamptz,
  captured_at timestamptz not null default now(),
  record_id uuid,
  distillate_id uuid,
  session_id uuid,
  support_kind text not null default 'direct_observation',
  confidence real not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null,
  unique (owner_id, content_hash)
);

create index observations_owner_occurred_idx
  on public.observations (owner_id, occurred_at desc nulls last);
create index observations_owner_family_idx
  on public.observations (owner_id, source_family);
create index observations_owner_distillate_idx
  on public.observations (owner_id, distillate_id);

comment on table public.observations is
  'Durable factual intrapersonal atoms. Interpretations/hypotheses live elsewhere.';

-- ---------------------------------------------------------------------------
-- claim_evidence: supports/contradicts links for hypotheses & insights
-- ---------------------------------------------------------------------------

create table public.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  claim_id uuid not null,
  claim_kind text not null
    check (claim_kind in ('hypothesis', 'insight', 'interest', 'self_model_item')),
  observation_id uuid references public.observations (id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  polarity text not null
    check (polarity in ('supports', 'contradicts')),
  created_at timestamptz not null default now()
);

create index claim_evidence_owner_claim_idx
  on public.claim_evidence (owner_id, claim_kind, claim_id);
create index claim_evidence_observation_idx
  on public.claim_evidence (observation_id);

comment on table public.claim_evidence is
  'Evidence links for durable intrapersonal claims (I1 join; ledger lands in I3).';

-- ---------------------------------------------------------------------------
-- Mirror role grants (reflective_sensitive derived memory)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
    grant select, insert, update on public.observations to cortex_mirror;
    grant select, insert, update, delete on public.claim_evidence to cortex_mirror;
  end if;
end
$$;
