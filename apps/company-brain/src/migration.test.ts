import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

it("applies Company Brain schema with working RLS and atomic verdict RPC", async () => {
  const db = new PGlite();
  await db.exec(`
    create role authenticator nologin;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role superuser nologin;
  `);
  const here = dirname(fileURLToPath(import.meta.url));
  const migration = await readFile(
    resolve(here, "../migrations/001_init.sql"),
    "utf8",
  );
  await db.exec(migration);

  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(`
    select relname, relrowsecurity
    from pg_class
    where relname like 'cb_%' and relkind = 'r'
    order by relname
  `);
  assert.ok(rls.rows.length >= 7);
  assert.ok(rls.rows.every((row) => row.relrowsecurity));

  const policies = await db.query<{ count: number }>(
    `select count(*)::int as count from pg_policies where tablename like 'cb_%'`,
  );
  assert.ok((policies.rows[0]?.count ?? 0) >= 15);

  await db.exec("set role company_brain_agent");
  const actors = await db.query<{ id: string }>(
    "select id from public.cb_actors order by id",
  );
  assert.deepEqual(
    actors.rows.map((row) => row.id),
    ["agent", "eric", "ingest", "jack"],
  );
  await db.exec(`
    insert into public.cb_proposals (
      status, state_key, statement, epistemic_class, confidence, proposer_id,
      idempotency_key, evidence_ids
    ) values (
      'pending', 'product.wedge', 'Physio is the filter', 'interpretation', 0.8,
      'agent', 'migration-test', array['event-1']
    )
  `);
  await assert.rejects(
    db.exec("update public.cb_proposals set status = 'approved'"),
  );

  await db.exec("reset role");
  await db.exec("set role service_role");
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
