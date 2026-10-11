/**
 * Static checks so public tables cannot ship without RLS, and so USING (true)
 * Data API policies cannot return (Advisors 0013 / 0023).
 *
 * Run: pnpm test:rls
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase/migrations");

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function loadMigrations() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const raw = readFileSync(join(migrationsDir, name), "utf8");
      return { name, raw, sql: stripSqlComments(raw) };
    });
}

describe("Cortex public table RLS", () => {
  const migrations = loadMigrations();
  const combined = migrations.map((m) => m.sql).join("\n");

  it("includes the deny-by-default lockdown migration", () => {
    assert.ok(
      migrations.some((m) => m.name === "20260916120000_rls_deny_by_default.sql"),
      "expected supabase/migrations/20260916120000_rls_deny_by_default.sql",
    );
  });

  it("enables RLS on every created public table", () => {
    const created = new Set();
    const enabled = new Set();
    const createRe =
      /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-zA-Z_][a-zA-Z0-9_]*)/gi;
    const enableRe =
      /\balter\s+table\s+(?:if\s+exists\s+)?public\.([a-zA-Z_][a-zA-Z0-9_]*)\s+enable\s+row\s+level\s+security/gi;

    let match;
    while ((match = createRe.exec(combined))) {
      created.add(match[1]);
    }
    while ((match = enableRe.exec(combined))) {
      enabled.add(match[1]);
    }

    assert.ok(created.size >= 20, `expected many public tables, got ${created.size}`);
    const missing = [...created].filter((name) => !enabled.has(name)).sort();
    assert.deepEqual(
      missing,
      [],
      `public tables missing ENABLE ROW LEVEL SECURITY: ${missing.join(", ")}`,
    );
  });

  it("does not create tautology USING (true) policies", () => {
    const hits = [];
    for (const m of migrations) {
      const policyRe =
        /\bcreate\s+policy\s+(\S+)\s+on\s+public\.(\S+)[\s\S]*?using\s*\(\s*true\s*\)/gi;
      let match;
      while ((match = policyRe.exec(m.sql))) {
        hits.push(`${m.name}: ${match[1]} on ${match[2]}`);
      }
    }
    assert.deepEqual(
      hits,
      [],
      `USING (true) policies re-open the Data API:\n${hits.join("\n")}`,
    );
  });

  it("drops leftover Phase 0 / Phase 7 tautology policy names", () => {
    const lockdown = migrations.find(
      (m) => m.name === "20260916120000_rls_deny_by_default.sql",
    );
    assert.ok(lockdown);
    for (const name of [
      "source_accounts_owner",
      "records_all",
      "api_tokens_all",
      "audit_log_all",
      "evidence_capabilities_all",
    ]) {
      assert.match(
        lockdown.sql,
        new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${name}\\b`, "i"),
        `lockdown must drop leftover policy ${name} on already-applied DBs`,
      );
    }
  });

  it("revokes anon/authenticated Data API grants in the lockdown migration", () => {
    const lockdown = migrations.find(
      (m) => m.name === "20260916120000_rls_deny_by_default.sql",
    );
    assert.ok(lockdown);
    assert.match(lockdown.sql, /revoke all on table %s from public, anon, authenticated/i);
    assert.match(lockdown.sql, /to cortex_mirror/i);
  });
});
