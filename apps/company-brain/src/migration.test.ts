import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));

async function migration(name: string): Promise<string> {
  return readFile(resolve(here, `../migrations/${name}`), "utf8");
}

async function bootstrapSupabaseRoles(db: PGlite): Promise<void> {
  await db.exec(`
    create role authenticator nologin;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role superuser nologin;
  `);
}

it("applies Company Brain schema with working RLS and atomic verdict RPC", async () => {
  const db = new PGlite();
  await bootstrapSupabaseRoles(db);
  await db.exec(await migration("001_init.sql"));
  await db.exec(await migration("002_integrity_hardening.sql"));

  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(`
    select relname, relrowsecurity
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname like 'cb_%' and relkind = 'r'
    order by relname
  `);
  assert.ok(rls.rows.length >= 7);
  assert.ok(rls.rows.every((row) => row.relrowsecurity));

  const policies = await db.query<{ count: number }>(
    `select count(*)::int as count from pg_policies where tablename like 'cb_%'`,
  );
  assert.ok((policies.rows[0]?.count ?? 0) >= 7);

  await db.exec("set role company_brain_agent");
  const actors = await db.query<{ id: string }>(
    "select id from public.cb_actors order by id",
  );
  assert.deepEqual(
    actors.rows.map((row) => row.id),
    ["agent", "eric", "ingest", "jack"],
  );
  await assert.rejects(
    db.exec(`
      insert into public.cb_proposals (
        status, state_key, statement, epistemic_class, confidence, proposer_id,
        idempotency_key, evidence_ids
      ) values (
        'pending', 'forged', 'Forged state', 'interpretation', 1,
        'agent', 'forged', array['event-1']
      )
    `),
  );

  await db.exec("reset role");
  await db.exec("set role service_role");
  const ingested = await db.query<{ result: Record<string, unknown> }>(
    `select public.cb_ingest_mapped_event(
      null, 'github', 'delivery-open', 'pr:forma/app#4', 'opened:v1',
      'ingest', '2026-08-20T10:00:00Z', now(),
      '{"kind":"github_pr","number":4}'::jsonb, 'accepted', null,
      '{"deliveryId":"delivery-open"}'::jsonb,
      'PR #4 opened', 'observation', 'engineering.work.forma.app.4', false,
      'github:delivery-open:state', 'PR #4 opened', 0.4,
      '{"kind":"github_working_on"}'::jsonb
    ) as result`,
  );
  assert.equal(
    (ingested.rows[0]?.result.proposal as { status?: string } | undefined)
      ?.status,
    "pending",
  );
  const replayed = await db.query<{ result: Record<string, unknown> }>(
    `select public.cb_ingest_mapped_event(
      null, 'github', 'delivery-open', 'pr:forma/app#4', 'opened:v1',
      'ingest', '2026-08-20T10:00:00Z', now(),
      '{"kind":"github_pr","number":4}'::jsonb, 'accepted', null,
      '{"deliveryId":"delivery-open"}'::jsonb,
      'PR #4 opened', 'observation', 'engineering.work.forma.app.4', false,
      'github:delivery-open:state', 'PR #4 opened', 0.4,
      '{"kind":"github_working_on"}'::jsonb
    ) as result`,
  );
  assert.equal(replayed.rows[0]?.result.duplicate, true);
  const derivedCounts = await db.query<{
    events: number;
    observations: number;
    proposals: number;
  }>(`
    select
      (select count(*)::int from public.cb_source_events) as events,
      (select count(*)::int from public.cb_observations) as observations,
      (select count(*)::int from public.cb_proposals where idempotency_key = 'github:delivery-open:state') as proposals
  `);
  assert.deepEqual(derivedCounts.rows[0], {
    events: 1,
    observations: 1,
    proposals: 1,
  });

  await db.exec(`
    insert into public.cb_proposals (
      status, state_key, statement, epistemic_class, confidence, proposer_id,
      idempotency_key, evidence_ids
    ) values (
      'pending', 'product.wedge', 'Physio is the filter', 'interpretation', 0.8,
      'agent', 'migration-test', array['event-1']
    )
  `);
  const proposal = await db.query<{ id: string }>(
    "select id from public.cb_proposals where idempotency_key = 'migration-test'",
  );
  const proposalId = proposal.rows[0]?.id;
  assert.ok(proposalId);
  const decided = await db.query<{ result: Record<string, unknown> }>(
    `select public.cb_decide_proposal(
      $1::uuid, 'jack', 'approve', null, null, now()
    ) as result`,
    [proposalId],
  );
  const result = decided.rows[0]?.result;
  assert.equal(
    (result?.proposal as { status?: string } | undefined)?.status,
    "approved",
  );
  assert.ok((result?.revision as { id?: string } | undefined)?.id);

  const current = await db.query<{ revision_id: string }>(
    "select revision_id from public.cb_current_state where state_key = 'product.wedge'",
  );
  assert.equal(current.rows.length, 1);
  await db.close();
});

it("upgrades the pre-persistence preview schema without dropping data", async () => {
  const db = new PGlite();
  await bootstrapSupabaseRoles(db);
  await db.exec(`
    create role company_brain_ingest nologin;
    create role company_brain_agent nologin;
    create role company_brain_founder nologin;
    grant company_brain_ingest, company_brain_agent, company_brain_founder
      to authenticator;

    create table public.cb_actors (
      id text primary key,
      kind text not null,
      display_name text not null,
      founder_key text
    );
    insert into public.cb_actors values
      ('agent', 'agent', 'Agent', null);
    create table public.cb_source_events (
      id uuid primary key default gen_random_uuid(),
      source text not null,
      external_event_id text not null,
      entity_key text not null,
      version_key text not null,
      actor_id text references public.cb_actors(id),
      source_action_at timestamptz not null,
      captured_at timestamptz not null default now(),
      payload jsonb not null,
      scope_decision text not null,
      reject_reason text,
      provenance jsonb not null default '{}',
      latest_for_entity boolean not null default false,
      unique(source, external_event_id)
    );
    create table public.cb_observations (
      id uuid primary key default gen_random_uuid(),
      statement text not null,
      epistemic_class text not null,
      event_id uuid not null references public.cb_source_events(id),
      topic_keys text[] not null default '{}',
      actor_id text references public.cb_actors(id),
      created_at timestamptz not null default now()
    );
    create table public.cb_proposals (
      id uuid primary key default gen_random_uuid(),
      status text not null,
      state_key text not null,
      statement text not null,
      epistemic_class text not null,
      confidence real not null default 0.5,
      proposer_id text not null references public.cb_actors(id),
      evidence_ids text[] not null default '{}',
      payload jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    create table public.cb_verdicts (
      id uuid primary key default gen_random_uuid(),
      proposal_id uuid not null references public.cb_proposals(id),
      action text not null,
      approver_id text not null references public.cb_actors(id),
      note text,
      refinement_statement text,
      created_at timestamptz not null default now()
    );
    create table public.cb_state_revisions (
      id uuid primary key default gen_random_uuid(),
      state_key text not null,
      statement text not null,
      epistemic_class text not null,
      confidence real not null default 0.5,
      effective_at timestamptz not null,
      supersedes_id uuid references public.cb_state_revisions(id),
      evidence_ids text[] not null default '{}',
      proposal_id uuid references public.cb_proposals(id),
      verdict_id uuid references public.cb_verdicts(id),
      created_at timestamptz not null default now()
    );
    create table public.cb_current_state (
      state_key text primary key,
      revision_id uuid not null references public.cb_state_revisions(id)
    );
    insert into public.cb_source_events (
      source, external_event_id, entity_key, version_key, source_action_at,
      payload, scope_decision, provenance, latest_for_entity
    ) values (
      'github', 'partial-delivery', 'pr:forma/app#99', 'opened:v1', now(),
      '{"kind":"github_pr","number":99}'::jsonb, 'accepted',
      '{"deliveryId":"partial-delivery"}'::jsonb, true
    );
    with inserted as (
      insert into public.cb_source_events (
        source, external_event_id, entity_key, version_key, source_action_at,
        payload, scope_decision, provenance, latest_for_entity
      ) values (
        'github', 'partial-after-observation', 'pr:forma/app#100', 'opened:v1',
        now(), '{"kind":"github_pr","number":100,"merged":false}'::jsonb,
        'accepted', '{"deliveryId":"partial-after-observation"}'::jsonb, true
      ) returning id
    )
    insert into public.cb_observations (
      statement, epistemic_class, event_id, topic_keys, created_at
    )
    select 'PR #100 opened', 'observation', id,
      array['engineering.work.forma.app.100'], now()
    from inserted;
    insert into public.cb_proposals (
      status, state_key, statement, epistemic_class, proposer_id, evidence_ids
    ) values (
      'pending', 'legacy.state', 'Legacy cited proposal', 'interpretation',
      'agent', array['legacy-evidence']
    );
  `);

  await db.exec(await migration("002_integrity_hardening.sql"));
  const upgraded = await db.query<{
    idempotency_key: string;
    evidence_ids: string[];
  }>(`
    select idempotency_key, evidence_ids
    from public.cb_proposals where state_key = 'legacy.state'
  `);
  assert.match(upgraded.rows[0]?.idempotency_key ?? "", /^legacy:/);
  assert.deepEqual(upgraded.rows[0]?.evidence_ids, ["legacy-evidence"]);
  const seededActors = await db.query<{ id: string }>(
    "select id from public.cb_actors order by id",
  );
  assert.deepEqual(
    seededActors.rows.map((row) => row.id),
    ["agent", "eric", "ingest", "jack"],
  );
  const replayQueue = await db.query<{ count: number }>(`
    select count(*)::int as count
    from company_brain_private.cb_upgrade_replay_events
    where external_event_id = 'partial-delivery'
  `);
  assert.equal(replayQueue.rows[0]?.count, 1);
  const secondReplay = await db.query<{ count: number }>(`
    select count(*)::int as count
    from company_brain_private.cb_upgrade_replay_events
    where external_event_id = 'partial-after-observation'
  `);
  assert.equal(secondReplay.rows[0]?.count, 1);
  const remainingPartial = await db.query<{ count: number }>(`
    select count(*)::int as count from public.cb_source_events
    where external_event_id = 'partial-delivery'
  `);
  assert.equal(remainingPartial.rows[0]?.count, 0);
  const remainingSecondPartial = await db.query<{ count: number }>(`
    select count(*)::int as count from public.cb_source_events
    where external_event_id = 'partial-after-observation'
  `);
  assert.equal(remainingSecondPartial.rows[0]?.count, 0);
  const functions = await db.query<{ count: number }>(`
    select count(*)::int as count from pg_proc
    where proname in (
      'cb_record_source_event', 'cb_ingest_mapped_event',
      'cb_apply_hard_fact', 'cb_decide_proposal'
    )
  `);
  assert.equal(functions.rows[0]?.count, 4);
  await db.close();
});
