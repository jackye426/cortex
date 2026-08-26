import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CompanyBrainConfigError,
  loadCompanyBrainConfig,
  resolveActorFromToken,
} from "./env.js";

const base = {
  COMPANY_BRAIN_STORE: "memory",
  COMPANY_BRAIN_CUTOVER_AT: "2026-08-01T00:00:00Z",
  COMPANY_BRAIN_GITHUB_ALLOWED_REPOS: "forma/app",
  COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET: "whsec",
  COMPANY_BRAIN_INGEST_TOKEN: "ingest-token",
  COMPANY_BRAIN_AGENT_TOKEN: "agent-token",
  COMPANY_BRAIN_FOUNDER_JACK_TOKEN: "jack-token",
  COMPANY_BRAIN_FOUNDER_ERIC_TOKEN: "eric-token",
};

describe("loadCompanyBrainConfig", () => {
  it("loads memory config from COMPANY_BRAIN_* only", () => {
    const config = loadCompanyBrainConfig({
      ...base,
      SUPABASE_URL: "https://cortex.supabase.co",
      CORTEX_INGEST_TOKEN: "cortex-token",
    });
    assert.equal(config.storeMode, "memory");
    assert.deepEqual(config.github.allowedRepos, ["forma/app"]);
    assert.equal(config.supabase, undefined);
  });

  it("refuses generic Cortex credentials in supabase mode", () => {
    assert.throws(
      () =>
        loadCompanyBrainConfig({
          ...base,
          COMPANY_BRAIN_STORE: "supabase",
          SUPABASE_URL: "https://aaaa.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service",
        }),
      (error: unknown) =>
        error instanceof CompanyBrainConfigError &&
        /generic SUPABASE_URL/.test(error.message),
    );
  });

  it("requires project ref to match supabase URL", () => {
    assert.throws(
      () =>
        loadCompanyBrainConfig({
          ...base,
          COMPANY_BRAIN_STORE: "supabase",
          COMPANY_BRAIN_SUPABASE_URL: "https://abc123.supabase.co",
          COMPANY_BRAIN_SUPABASE_SERVICE_ROLE_KEY: "service",
          COMPANY_BRAIN_SUPABASE_PROJECT_REF: "other",
        }),
      CompanyBrainConfigError,
    );
  });

  it("rejects reused tokens and missing cutover", () => {
    assert.throws(
      () =>
        loadCompanyBrainConfig({
          ...base,
          COMPANY_BRAIN_AGENT_TOKEN: "ingest-token",
        }),
      CompanyBrainConfigError,
    );
    assert.throws(
      () => loadCompanyBrainConfig({ ...base, COMPANY_BRAIN_CUTOVER_AT: "" }),
      CompanyBrainConfigError,
    );
  });

  it("resolves founder and agent tokens", () => {
    const config = loadCompanyBrainConfig(base);
    assert.equal(resolveActorFromToken(config, "jack-token").ok, true);
    assert.equal(resolveActorFromToken(config, "nope").ok, false);
  });
});
