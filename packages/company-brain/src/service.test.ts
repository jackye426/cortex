import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCompanyBrainConfig } from "./env.js";
import { mapGithubWebhook } from "./github.js";
import { CompanyBrain } from "./service.js";
import { MemoryCompanyBrainStore } from "./store.js";

const env = {
  COMPANY_BRAIN_STORE: "memory",
  COMPANY_BRAIN_CUTOVER_AT: "2026-08-01T00:00:00Z",
  COMPANY_BRAIN_GITHUB_ALLOWED_REPOS: "forma/app",
  COMPANY_BRAIN_GITHUB_INSTALLATION_IDS: "99",
  COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET: "whsec",
  COMPANY_BRAIN_INGEST_TOKEN: "ingest-token",
  COMPANY_BRAIN_AGENT_TOKEN: "agent-token",
  COMPANY_BRAIN_FOUNDER_JACK_TOKEN: "jack-token",
  COMPANY_BRAIN_FOUNDER_ERIC_TOKEN: "eric-token",
};

function sign(body: string): string {
  return `sha256=${createHmac("sha256", "whsec").update(body, "utf8").digest("hex")}`;
}

function prPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "closed",
    installation: { id: 99 },
    repository: { full_name: "forma/app" },
    pull_request: {
      number: 12,
      title: "Fix posture report",
      merged: true,
      merged_at: "2026-08-20T12:00:00Z",
      created_at: "2026-07-01T12:00:00Z",
      updated_at: "2026-08-20T12:00:00Z",
      ...overrides,
    },
  };
}

function brain() {
  const config = loadCompanyBrainConfig(env);
  return new CompanyBrain(config, new MemoryCompanyBrainStore());
}

function ingestPr(instance: CompanyBrain, payload: unknown, deliveryId = "del-1") {
  const rawBody = JSON.stringify(payload);
  return instance.ingestGithubWebhook({
    eventName: "pull_request",
    deliveryId,
    rawBody,
    signatureHeader: sign(rawBody),
    payload,
  });
}

const jack = {
  id: "jack",
  kind: "founder" as const,
  displayName: "Jack",
  founderKey: "jack" as const,
};
const eric = {
  id: "eric",
  kind: "founder" as const,
  displayName: "Eric",
  founderKey: "eric" as const,
};
const agent = {
  id: "agent",
  kind: "agent" as const,
  displayName: "Agent",
};

describe("Company Brain GitHub slice", () => {
  it("rejects unsigned, out-of-scope, pre-cutover, and missing timestamps before persist", () => {
    const instance = brain();
    const payload = prPayload();
    const rawBody = JSON.stringify(payload);

    const unsigned = instance.ingestGithubWebhook({
      eventName: "pull_request",
      deliveryId: "d1",
      rawBody,
      signatureHeader: undefined,
      payload,
    });
    assert.equal(unsigned.accepted, false);
    if (!unsigned.accepted) assert.equal(unsigned.code, "unsigned");

    const scoped = ingestPr(instance, {
      ...payload,
      repository: { full_name: "other/repo" },
    });
    assert.equal(scoped.accepted, false);
    if (!scoped.accepted) assert.equal(scoped.code, "out_of_scope");

    const early = ingestPr(
      instance,
      prPayload({ merged_at: "2026-07-01T00:00:00Z", merged: true }),
    );
    assert.equal(early.accepted, false);
    if (!early.accepted) assert.equal(early.code, "pre_cutover");

    const missing = ingestPr(
      instance,
      prPayload({ merged_at: "", updated_at: "", created_at: "", merged: true }),
    );
    assert.equal(missing.accepted, false);
    if (!missing.accepted) assert.equal(missing.code, "missing_timestamp");

    assert.equal(instance.store.listEvents().length, 0);
    assert.equal(instance.store.countCortexLikeRows(), 0);
  });

  it("auto-applies a merged PR as a cited hard fact and is idempotent on replay", () => {
    const instance = brain();
    const first = ingestPr(instance, prPayload());
    assert.equal(first.accepted, true);
    if (!first.accepted) throw new Error("expected accept");
    assert.equal(first.duplicate, false);
    assert.ok(first.appliedRevision);
    assert.equal(first.appliedRevision?.epistemicClass, "fact");

    const replay = ingestPr(instance, prPayload(), "del-1");
    assert.equal(replay.accepted, true);
    if (!replay.accepted) throw new Error("expected accept");
    assert.equal(replay.duplicate, true);
    assert.equal(instance.store.listEvents().length, 1);

    const state = instance.currentState();
    assert.equal(state.length, 1);
    const revision = state[0];
    assert.ok(revision);
    assert.match(revision.statement, /PR #12 merged/);
    assert.ok(revision.citations.length > 0);
    const citation = revision.citations[0];
    assert.ok(citation);
    const resolved = instance.evidence(jack, citation.eventId);
    assert.equal(resolved.eventId, citation.eventId);
    assert.equal(instance.changes()[0]?.kind, "revision");
  });

  it("keeps stale deliveries in history without regressing latest state", () => {
    const instance = brain();
    ingestPr(instance, prPayload({ updated_at: "2026-08-20T12:00:00Z" }), "new");
    const stale = ingestPr(
      instance,
      {
        action: "opened",
        installation: { id: 99 },
        repository: { full_name: "forma/app" },
        pull_request: {
          number: 12,
          title: "older",
          merged: false,
          created_at: "2026-08-10T12:00:00Z",
          updated_at: "2026-08-10T12:00:00Z",
        },
      },
      "old",
    );
    assert.equal(stale.accepted, true);
    if (!stale.accepted) throw new Error("expected accept");
    assert.equal(stale.stale, true);
    const latest = instance.store.latestEventForEntity("pr:forma/app#12");
    assert.equal(latest?.externalEventId, "new");
    assert.equal(instance.store.listEvents().length, 2);
  });

  it("does not auto-apply interpretive GitHub observations", () => {
    const instance = brain();
    const opened = ingestPr(
      instance,
      {
        action: "opened",
        installation: { id: 99 },
        repository: { full_name: "forma/app" },
        pull_request: {
          number: 4,
          title: "WIP report",
          merged: false,
          created_at: "2026-08-18T12:00:00Z",
          updated_at: "2026-08-18T12:00:00Z",
        },
      },
      "open-1",
    );
    assert.equal(opened.accepted, true);
    if (!opened.accepted) throw new Error("expected accept");
    assert.equal(opened.appliedRevision, undefined);
    assert.equal(opened.proposal?.status, "pending");
    assert.equal(opened.proposal?.epistemicClass, "interpretation");
  });
});

describe("approval and contradictions", () => {
  it("lets agents propose but not approve", () => {
    const instance = brain();
    const ingested = ingestPr(instance, prPayload());
    if (!ingested.accepted || !ingested.event) throw new Error("need event");
    const proposal = instance.proposeStateChange({
      actor: agent,
      stateKey: "product.wedge",
      statement: "Physio is the customer",
      evidenceIds: [ingested.event.id],
    });
    assert.throws(
      () =>
        instance.decideProposal({
          actor: agent,
          proposalId: proposal.id,
          action: "approve",
        }),
      /only authenticated founders/,
    );
    assert.equal(instance.store.getProposal(proposal.id)?.status, "pending");
  });

  it("resolves conflicting Jack/Eric proposals into a cited current state", () => {
    const instance = brain();
    const ingested = ingestPr(instance, prPayload());
    if (!ingested.accepted || !ingested.event) throw new Error("need event");

    const jackProposal = instance.proposeStateChange({
      actor: jack,
      stateKey: "product.wedge",
      statement: "Clinic value is longitudinal posture monitoring",
      evidenceIds: [ingested.event.id],
    });
    instance.proposeStateChange({
      actor: eric,
      stateKey: "product.wedge",
      statement: "Clinic value is between-appointment adherence",
      evidenceIds: [ingested.event.id],
    });

    const context = instance.context();
    const contradiction = context.contradictions.find(
      (row) => row.stateKey === "product.wedge",
    );
    assert.ok(contradiction);
    assert.equal(contradiction.pending.length, 2);

    const approved = instance.decideProposal({
      actor: jack,
      proposalId: jackProposal.id,
      action: "approve",
    });
    assert.ok(approved.revision);
    assert.equal(
      instance.store.listProposals().filter((row) => row.status === "pending")
        .length,
      0,
    );
    const current = instance.currentState().find((row) => row.stateKey === "product.wedge");
    assert.ok(current);
    assert.match(current.statement, /longitudinal posture monitoring/);
    assert.ok(current.citations.some((row) => row.eventId === ingested.event.id));
    assert.equal(instance.store.getProposal(jackProposal.id)?.status, "approved");
  });

  it("covers reject, refine, and stale second approval", () => {
    const instance = brain();
    const ingested = ingestPr(instance, prPayload());
    if (!ingested.accepted || !ingested.event) throw new Error("need event");
    const rejected = instance.proposeStateChange({
      actor: jack,
      stateKey: "go.to.market",
      statement: "Sell seats to physios",
      evidenceIds: [ingested.event.id],
    });
    instance.decideProposal({
      actor: eric,
      proposalId: rejected.id,
      action: "reject",
      note: "filter not customer",
    });
    assert.equal(instance.store.getProposal(rejected.id)?.status, "rejected");

    const refined = instance.proposeStateChange({
      actor: eric,
      stateKey: "go.to.market",
      statement: "Use physios as a recruitment filter",
      evidenceIds: [ingested.event.id],
    });
    const result = instance.decideProposal({
      actor: jack,
      proposalId: refined.id,
      action: "refine",
      refinementStatement: "Physio is the filter, not the customer",
    });
    assert.equal(result.revision?.statement, "Physio is the filter, not the customer");
    assert.throws(
      () =>
        instance.decideProposal({
          actor: jack,
          proposalId: refined.id,
          action: "approve",
        }),
      /proposal is approved/,
    );
  });
});

describe("github mapping helpers", () => {
  it("requires a valid signature before mapping", () => {
    const config = loadCompanyBrainConfig(env);
    const payload = prPayload();
    const rawBody = JSON.stringify(payload);
    const mapped = mapGithubWebhook({
      config,
      eventName: "pull_request",
      deliveryId: "x",
      rawBody,
      signatureHeader: "sha256=deadbeef",
      payload,
    });
    assert.equal(mapped.ok, false);
  });
});
