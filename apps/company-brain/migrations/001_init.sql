-- Company Brain V0 schema for a *separate* Supabase project.
-- Do not apply this migration to the personal Cortex database.

create table if not exists public.cb_actors (
  id text primary key,
  kind text not null check (kind in ('founder', 'agent', 'ingest')),
  display_name text not null,
  founder_key text check (founder_key in ('jack', 'eric'))
);

insert into public.cb_actors (id, kind, display_name, founder_key)
values
  ('ingest', 'ingest', 'Company Brain ingest', null),
  ('agent', 'agent', 'Company Brain agent', null),
  ('jack', 'founder', 'Jack', 'jack'),
  ('eric', 'founder', 'Eric', 'eric')
on conflict (id) do update set
  kind = excluded.kind,
  display_name = excluded.display_name,
  founder_key = excluded.founder_key;

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

create unique index if not exists cb_source_events_one_latest
  on public.cb_source_events (entity_key)
  where latest_for_entity;

create table if not exists public.cb_observations (
  id uuid primary key default gen_random_uuid(),
  statement text not null,
  epistemic_class text not null
    check (epistemic_class in ('fact', 'observation', 'interpretation')),
  event_id uuid not null unique references public.cb_source_events (id),
  evidence_ids text[] not null default '{}',
  topic_keys text[] not null default '{}',
  actor_id text references public.cb_actors (id),
  created_at timestamptz not null default now()
);

create table if not exists public.cb_proposals (
  id uuid primary key default gen_random_uuid(),
  status text not null
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  state_key text not null,
  statement text not null,
  epistemic_class text not null
    check (epistemic_class in ('fact', 'observation', 'interpretation')),
  confidence real not null default 0.5 check (confidence between 0 and 1),
  proposer_id text not null references public.cb_actors (id),
  idempotency_key text not null,
  evidence_ids text[] not null check (cardinality(evidence_ids) > 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (proposer_id, idempotency_key)
);

create index if not exists cb_proposals_state_status
  on public.cb_proposals (state_key, status);

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
  epistemic_class text not null
    check (epistemic_class in ('fact', 'observation', 'interpretation')),
  confidence real not null default 0.5 check (confidence between 0 and 1),
  effective_at timestamptz not null,
  supersedes_id uuid references public.cb_state_revisions (id),
  evidence_ids text[] not null check (cardinality(evidence_ids) > 0),
  proposal_id uuid references public.cb_proposals (id),
  verdict_id uuid references public.cb_verdicts (id),
  created_at timestamptz not null default now()
);

create index if not exists cb_state_revisions_key_created
  on public.cb_state_revisions (state_key, created_at desc);

create table if not exists public.cb_current_state (
  state_key text primary key,
  revision_id uuid not null references public.cb_state_revisions (id)
);

-- Roles are intentionally separate from Cortex/Supabase's anon/authenticated
-- roles. If JWTs are introduced, use a trusted role/app_metadata claim.
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

grant company_brain_ingest, company_brain_agent, company_brain_founder
  to authenticator;
grant usage on schema public
  to company_brain_ingest, company_brain_agent, company_brain_founder;
revoke all on public.cb_actors,
  public.cb_source_events,
  public.cb_observations,
  public.cb_proposals,
  public.cb_verdicts,
  public.cb_state_revisions,
  public.cb_current_state
from anon, authenticated;

-- Data API roles are read-only. All mutation goes through the authenticated
-- server and transactional RPCs, preventing clients from forging evidence,
-- verdicts, or current-state pointers.
grant select on public.cb_actors,
  public.cb_source_events,
  public.cb_observations,
  public.cb_proposals,
  public.cb_verdicts,
  public.cb_state_revisions,
  public.cb_current_state
to company_brain_agent, company_brain_founder;

alter table public.cb_actors enable row level security;
alter table public.cb_source_events enable row level security;
alter table public.cb_observations enable row level security;
alter table public.cb_proposals enable row level security;
alter table public.cb_verdicts enable row level security;
alter table public.cb_state_revisions enable row level security;
alter table public.cb_current_state enable row level security;

create policy cb_actors_read on public.cb_actors for select
  to company_brain_agent, company_brain_founder
  using (true);

create policy cb_events_agent_read on public.cb_source_events for select
  to company_brain_agent, company_brain_founder using (true);

create policy cb_observations_read on public.cb_observations for select
  to company_brain_agent, company_brain_founder
  using (true);

create policy cb_proposals_read on public.cb_proposals for select
  to company_brain_agent, company_brain_founder
  using (true);

create policy cb_verdicts_read on public.cb_verdicts for select
  to company_brain_agent, company_brain_founder using (true);

create policy cb_revisions_read on public.cb_state_revisions for select
  to company_brain_agent, company_brain_founder using (true);

create policy cb_current_read on public.cb_current_state for select
  to company_brain_agent, company_brain_founder using (true);

-- Versioned source-event write. The entity advisory lock makes stale ordering,
-- the one-latest invariant, and delivery deduplication one transaction.
create or replace function public.cb_record_source_event(
  p_id uuid,
  p_source text,
  p_external_event_id text,
  p_entity_key text,
  p_version_key text,
  p_actor_id text,
  p_source_action_at timestamptz,
  p_captured_at timestamptz,
  p_payload jsonb,
  p_scope_decision text,
  p_reject_reason text,
  p_provenance jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.cb_source_events%rowtype;
  v_latest public.cb_source_events%rowtype;
  v_event public.cb_source_events%rowtype;
  v_stale boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext(p_entity_key));
  select * into v_existing
  from public.cb_source_events
  where source = p_source and external_event_id = p_external_event_id;
  if found then
    return jsonb_build_object(
      'event', to_jsonb(v_existing),
      'duplicate', true,
      'stale', false
    );
  end if;

  select * into v_latest
  from public.cb_source_events
  where entity_key = p_entity_key and latest_for_entity
  for update;
  if found and v_latest.source_action_at >= p_source_action_at then
    v_stale := true;
  end if;
  if not v_stale then
    update public.cb_source_events
    set latest_for_entity = false
    where entity_key = p_entity_key and latest_for_entity;
  end if;

  insert into public.cb_source_events (
    id, source, external_event_id, entity_key, version_key, actor_id,
    source_action_at, captured_at, payload, scope_decision, reject_reason,
    provenance, latest_for_entity
  ) values (
    coalesce(p_id, gen_random_uuid()), p_source, p_external_event_id,
    p_entity_key, p_version_key, p_actor_id, p_source_action_at, p_captured_at,
    p_payload, p_scope_decision, p_reject_reason, p_provenance, not v_stale
  ) returning * into v_event;

  return jsonb_build_object(
    'event', to_jsonb(v_event),
    'duplicate', false,
    'stale', v_stale
  );
end
$$;

-- Complete mapped-event ingestion in one transaction. A committed delivery
-- always has its observation and either its proposal or hard-fact revision.
create or replace function public.cb_ingest_mapped_event(
  p_id uuid,
  p_source text,
  p_external_event_id text,
  p_entity_key text,
  p_version_key text,
  p_actor_id text,
  p_source_action_at timestamptz,
  p_captured_at timestamptz,
  p_payload jsonb,
  p_scope_decision text,
  p_reject_reason text,
  p_provenance jsonb,
  p_statement text,
  p_epistemic_class text,
  p_state_key text,
  p_auto_apply boolean,
  p_proposal_idempotency_key text,
  p_proposal_statement text,
  p_proposal_confidence real,
  p_proposal_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recorded jsonb;
  v_event public.cb_source_events%rowtype;
  v_observation public.cb_observations%rowtype;
  v_proposal public.cb_proposals%rowtype;
  v_revision jsonb;
begin
  -- State lock is always first across ingestion, hard facts, and approval.
  perform pg_advisory_xact_lock(hashtext(p_state_key));
  v_recorded := public.cb_record_source_event(
    p_id, p_source, p_external_event_id, p_entity_key, p_version_key,
    p_actor_id, p_source_action_at, p_captured_at, p_payload,
    p_scope_decision, p_reject_reason, p_provenance
  );
  v_event := jsonb_populate_record(null::public.cb_source_events, v_recorded->'event');
  if (v_recorded->>'duplicate')::boolean or (v_recorded->>'stale')::boolean then
    return v_recorded;
  end if;

  insert into public.cb_observations (
    statement, epistemic_class, event_id, evidence_ids, topic_keys,
    actor_id, created_at
  ) values (
    p_statement, p_epistemic_class, v_event.id, array[v_event.id::text],
    array[p_state_key], p_actor_id, p_captured_at
  )
  on conflict (event_id) do update set event_id = excluded.event_id
  returning * into v_observation;

  if p_auto_apply and p_epistemic_class = 'fact' then
    v_revision := public.cb_apply_hard_fact(
      p_state_key, p_statement,
      array[v_event.id::text, v_observation.id::text],
      p_source_action_at, p_captured_at
    );
    return v_recorded || jsonb_build_object(
      'observation', to_jsonb(v_observation),
      'applied_revision', v_revision
    );
  end if;

  if p_proposal_idempotency_key is not null then
    insert into public.cb_proposals (
      status, state_key, statement, epistemic_class, confidence, proposer_id,
      idempotency_key, evidence_ids, payload, created_at
    ) values (
      'pending', p_state_key, p_proposal_statement, 'interpretation',
      p_proposal_confidence, 'ingest', p_proposal_idempotency_key,
      array[v_event.id::text, v_observation.id::text],
      coalesce(p_proposal_payload, '{}'::jsonb), p_captured_at
    )
    on conflict (proposer_id, idempotency_key)
      do update set idempotency_key = excluded.idempotency_key
    returning * into v_proposal;
  end if;

  return v_recorded || jsonb_build_object(
    'observation', to_jsonb(v_observation),
    'proposal', case when v_proposal.id is null then null else to_jsonb(v_proposal) end
  );
end
$$;

-- Atomic founder verdict. Called only by the server's service role; all input
-- is checked again inside the transaction.
create or replace function public.cb_decide_proposal(
  p_proposal_id uuid,
  p_approver_id text,
  p_action text,
  p_note text,
  p_refinement_statement text,
  p_decided_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_proposal public.cb_proposals%rowtype;
  v_verdict public.cb_verdicts%rowtype;
  v_revision public.cb_state_revisions%rowtype;
  v_previous uuid;
  v_statement text;
  v_state_key text;
begin
  if p_action not in ('approve', 'reject', 'refine') then
    raise exception 'invalid_action';
  end if;
  if not exists (
    select 1 from public.cb_actors
    where id = p_approver_id and kind = 'founder'
  ) then
    raise exception 'approver_not_found';
  end if;

  select state_key into v_state_key
  from public.cb_proposals
  where id = p_proposal_id;
  if not found then raise exception 'proposal_not_found'; end if;
  perform pg_advisory_xact_lock(hashtext(v_state_key));

  select * into v_proposal
  from public.cb_proposals
  where id = p_proposal_id
  for update;
  if v_proposal.status <> 'pending' then
    raise exception 'stale_proposal:%', v_proposal.status;
  end if;
  if p_action <> 'reject' and cardinality(v_proposal.evidence_ids) = 0 then
    raise exception 'evidence_required';
  end if;
  if p_action = 'refine' and nullif(btrim(p_refinement_statement), '') is null then
    raise exception 'refinement_required';
  end if;

  insert into public.cb_verdicts (
    proposal_id, action, approver_id, note, refinement_statement, created_at
  ) values (
    v_proposal.id, p_action, p_approver_id, p_note,
    nullif(btrim(p_refinement_statement), ''), p_decided_at
  ) returning * into v_verdict;

  if p_action = 'reject' then
    update public.cb_proposals set status = 'rejected'
    where id = v_proposal.id returning * into v_proposal;
    return jsonb_build_object('proposal', to_jsonb(v_proposal), 'revision', null);
  end if;

  select revision_id into v_previous
  from public.cb_current_state where state_key = v_proposal.state_key;
  v_statement := case
    when p_action = 'refine' then btrim(p_refinement_statement)
    else v_proposal.statement
  end;

  update public.cb_proposals set status = 'superseded'
  where state_key = v_proposal.state_key
    and status = 'pending'
    and id <> v_proposal.id;

  insert into public.cb_state_revisions (
    state_key, statement, epistemic_class, confidence, effective_at,
    supersedes_id, evidence_ids, proposal_id, verdict_id, created_at
  ) values (
    v_proposal.state_key, v_statement, 'interpretation',
    v_proposal.confidence, p_decided_at, v_previous,
    v_proposal.evidence_ids, v_proposal.id, v_verdict.id, p_decided_at
  ) returning * into v_revision;

  insert into public.cb_current_state (state_key, revision_id)
  values (v_proposal.state_key, v_revision.id)
  on conflict (state_key) do update set revision_id = excluded.revision_id;

  update public.cb_proposals set status = 'approved'
  where id = v_proposal.id returning * into v_proposal;
  return jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'revision', to_jsonb(v_revision)
  );
end
$$;

create or replace function public.cb_apply_hard_fact(
  p_state_key text,
  p_statement text,
  p_evidence_ids text[],
  p_effective_at timestamptz,
  p_created_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous uuid;
  v_revision public.cb_state_revisions%rowtype;
begin
  if cardinality(p_evidence_ids) = 0 then raise exception 'evidence_required'; end if;
  perform pg_advisory_xact_lock(hashtext(p_state_key));
  select revision_id into v_previous
  from public.cb_current_state where state_key = p_state_key;

  update public.cb_proposals set status = 'superseded'
  where state_key = p_state_key and status = 'pending';

  insert into public.cb_state_revisions (
    state_key, statement, epistemic_class, confidence, effective_at,
    supersedes_id, evidence_ids, created_at
  ) values (
    p_state_key, p_statement, 'fact', 1, p_effective_at,
    v_previous, p_evidence_ids, p_created_at
  ) returning * into v_revision;

  insert into public.cb_current_state (state_key, revision_id)
  values (p_state_key, v_revision.id)
  on conflict (state_key) do update set revision_id = excluded.revision_id;
  return to_jsonb(v_revision);
end
$$;

revoke execute on function public.cb_decide_proposal(
  uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke execute on function public.cb_apply_hard_fact(
  text, text, text[], timestamptz, timestamptz
) from public, anon, authenticated;
revoke execute on function public.cb_record_source_event(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  jsonb, text, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.cb_ingest_mapped_event(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  jsonb, text, text, jsonb, text, text, text, boolean,
  text, text, real, jsonb
) from public, anon, authenticated;
grant execute on function public.cb_decide_proposal(
  uuid, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.cb_apply_hard_fact(
  text, text, text[], timestamptz, timestamptz
) to service_role;
grant execute on function public.cb_record_source_event(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  jsonb, text, text, jsonb
) to service_role;
grant execute on function public.cb_ingest_mapped_event(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  jsonb, text, text, jsonb, text, text, text, boolean,
  text, text, real, jsonb
) to service_role;
