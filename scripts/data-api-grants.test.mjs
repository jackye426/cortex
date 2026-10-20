/**
 * Disposable Postgres/WASM grant regression suite. No network, credentials or
 * hosted data. See docs/data-api-grant-contract.md for coverage and limitations.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql")).sort()
  .map((name) => ({ name, sql: readFileSync(join(root, "supabase/migrations", name), "utf8") }));
const contract = JSON.parse(readFileSync(join(root, "scripts/data-api-grants.contract.json"), "utf8"));
// Historical table-creation files depend on the final, explicit September grant
// pass. Freeze their original table identities, NOT a filename/timestamp cutoff:
// adding a table to an old file must still satisfy the same-migration contract.
const legacyTables = new Set([
  "sources", "source_accounts", "sync_checkpoints", "raw_artifacts", "records",
  "sessions", "turns", "messages", "tool_calls", "entities", "entity_links",
  "deletions", "distillates", "api_tokens", "audit_log", "evidence_capabilities",
  "observations", "claim_evidence", "interests", "affect_signals", "hypotheses",
  "intrapersonal_records", "self_model_versions", "insight_verdicts", "decisions",
  "decision_outcomes", "experiments", "prediction_events", "self_model_diffs",
]);
const operations = ["SELECT", "INSERT", "UPDATE", "DELETE"];

async function database() {
  const db = new PGlite({ extensions: { pgcrypto, vector } });
  // Supabase-managed scaffolding only. Application SQL is executed unchanged.
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE authenticator NOLOGIN;
    CREATE ROLE supabase_admin NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY, name text, public boolean, file_size_limit bigint
    );
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
  `);
  return db;
}
async function tables(db) {
  return (await db.query(`SELECT c.oid, c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`)).rows;
}
async function assertTable(db, table, expected, strict = false) {
  assert.ok(expected, `public.${table}: missing reviewed grant contract`);
  assert.ok(Array.isArray(expected.serviceRole), `${table}: serviceRole must be an array`);
  for (const privilege of expected.serviceRole) {
    assert.ok(operations.includes(privilege), `${table}: unsupported privilege ${privilege}`);
  }
  const relation = `public.${table}`;
  const { rows: [rls] } = await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass`, [relation]);
  assert.equal(rls.relrowsecurity, true, `${relation}: RLS must be enabled`);
  for (const privilege of operations) {
    const { rows: [access] } = await db.query(`SELECT
      has_table_privilege('service_role', $1, $2) AS service,
      has_table_privilege('anon', $1, $2) AS anon,
      has_table_privilege('authenticated', $1, $2) AS authenticated`, [relation, privilege]);
    assert.equal(access.service, expected.serviceRole.includes(privilege), `${relation}: service_role ${privilege}`);
    assert.equal(access.anon, false, `${relation}: anon ${privilege} must be denied`);
    assert.equal(access.authenticated, false, `${relation}: authenticated ${privilege} must be denied`);
  }
  for (const privilege of ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
    for (const role of ["anon", "authenticated"]) {
      const { rows: [access] } = await db.query(`SELECT has_table_privilege($1, $2, $3) AS allowed`, [role, relation, privilege]);
      assert.equal(access.allowed, false, `${relation}: ${role} ${privilege} must be denied`);
    }
    if (strict) {
      const { rows: [access] } = await db.query(`SELECT has_table_privilege('service_role', $1, $2) AS allowed`, [relation, privilege]);
      assert.equal(access.allowed, false, `${relation}: service_role ${privilege} is not part of the DML contract`);
    }
  }
}
async function replay(db, source = migrations, expected = contract) {
  const seen = new Map();
  const replacements = new Set();
  for (const migration of source) {
    await db.exec(migration.sql);
    for (const table of await tables(db)) {
      if (seen.get(table.relname) === table.oid) continue;
      const replacement = seen.has(table.relname);
      if (replacement) replacements.add(table.relname);
      seen.set(table.relname, table.oid);
      const spec = expected[table.relname];
      assert.ok(spec, `${migration.name}: public.${table.relname} needs a reviewed contract`);
      if (!replacement) assert.equal(spec.createdBy, migration.name, `${table.relname}: creation migration changed`);
      if (replacement || !legacyTables.has(table.relname)) await assertTable(db, table.relname, spec, true);
    }
  }
  assert.deepEqual([...seen.keys()].sort(), Object.keys(expected).sort(), "contract and replayed tables must match");
  for (const name of seen.keys()) await assertTable(db, name, expected[name], replacements.has(name) || !legacyTables.has(name));
}

// Shared disposable baseline: each test rolls its own mutations back. No test
// touches a remote project, and the DB is discarded when the suite finishes.
test("Data API grants with default table grants disabled", async (t) => {
  const db = await database();
  try {
    await t.test("full main migration chain preserves backend access and public denial", async () => {
      await replay(db);
      const { rows: [access] } = await db.query(`SELECT
        has_table_privilege('cortex_mirror','public.records','SELECT') AS raw,
        has_table_privilege('cortex_mirror','public.distillates','SELECT') AS derived,
        has_table_privilege('cortex_mirror','public.audit_log','INSERT') AS audit_insert,
        has_table_privilege('cortex_mirror','public.audit_log','SELECT') AS audit_read`);
      assert.deepEqual(access, { raw: false, derived: true, audit_insert: true, audit_read: false });
    });
    await t.test("unregistered future tables fail the migration contract", async () => {
      const isolated = await database();
      try {
        await assert.rejects(() => replay(isolated, [...migrations, {
          name: "20990101000000_probe.sql", sql: "CREATE TABLE public.unregistered_probe(id uuid);",
        }]), /unregistered_probe needs a reviewed contract/);
      } finally { await isolated.close(); }
    });
    await t.test("a later grant cannot repair a future creation without its own grants", async () => {
      const isolated = await database();
      try {
        await assert.rejects(() => replay(isolated, [...migrations, {
          name: "20990101000000_probe.sql",
          sql: "CREATE TABLE public.future_probe(id uuid); ALTER TABLE public.future_probe ENABLE ROW LEVEL SECURITY;",
        }, {
          name: "20990102000000_late_grant.sql", sql: "GRANT SELECT ON public.future_probe TO service_role;",
        }], { ...contract, future_probe: { createdBy: "20990101000000_probe.sql", serviceRole: ["SELECT"] } }), /future_probe: service_role SELECT/);
      } finally { await isolated.close(); }
    });
    await t.test("recreated historical tables need grants in their replacement migration", async () => {
      const isolated = await database();
      try {
        await assert.rejects(() => replay(isolated, [...migrations, {
          name: "20990101000000_recreate.sql",
          sql: "DROP TABLE public.prediction_events; CREATE TABLE public.prediction_events(id uuid); ALTER TABLE public.prediction_events ENABLE ROW LEVEL SECURITY;",
        }, {
          name: "20990102000000_late_grant.sql",
          sql: "GRANT SELECT, INSERT, UPDATE, DELETE ON public.prediction_events TO service_role;",
        }]), /prediction_events: service_role SELECT/);
      } finally { await isolated.close(); }
    });
    const probe = async (sql, expected, error) => {
      await db.exec("BEGIN");
      try {
        await db.exec(sql);
        const check = () => assertTable(db, "grant_probe", { serviceRole: expected }, true);
        if (error) await assert.rejects(check, error); else await check();
      } finally { await db.exec("ROLLBACK"); }
    };
    const create = "CREATE TABLE public.grant_probe(id uuid PRIMARY KEY); ALTER TABLE public.grant_probe ENABLE ROW LEVEL SECURITY;";
    await t.test("new tables fail without explicit grants", () => probe(create, ["SELECT"], /service_role SELECT/));
    await t.test("read-only service access does not require write grants", () => probe(`${create} GRANT SELECT ON public.grant_probe TO service_role;`, ["SELECT"]));
    await t.test("public-role grants fail closed", () => probe(`${create} GRANT SELECT ON public.grant_probe TO service_role, anon;`, ["SELECT"], /anon SELECT/));
    await t.test("broad ALL is not a least-privilege DML grant", () => probe(`${create} GRANT ALL ON public.grant_probe TO service_role;`, operations, /service_role TRUNCATE/));
    await t.test("RLS cannot substitute for grants and grants cannot substitute for RLS", () => probe("CREATE TABLE public.grant_probe(id uuid); GRANT SELECT ON public.grant_probe TO service_role;", ["SELECT"], /RLS must be enabled/));
  } finally { await db.close(); }
});
