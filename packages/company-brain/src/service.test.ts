import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCompanyBrainConfig } from "./env.js";
import { mapGithubWebhook } from "./github.js";
import { CompanyBrain } from "./service.js";
import { MemoryCompanyBrainStore } from "./store.js";

const SECRET = "webhook-secret-32-bytes-minimum-value";
const env = {
  COMPANY_BRAIN_STORE: "memory",
  COMPANY_BRAIN_CUTOVER_AT: "2026-08-01T00:00:00Z",
  COMPANY_BRAIN_GITHUB_ALLOWED_REPOS: "forma/app",
  COMPANY_BRAIN_GITHUB_INSTALLATION_IDS: "99",
  COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET: SECRET,
  COMPANY_BRAIN_INGEST_TOKEN: "ingest-token-value-at-least-32-bytes",
  COMPANY_BRAIN_AGENT_TOKEN: "agent-token-value-at-least-32-bytes-x",
  COMPANY_BRAIN_FOUNDER_JACK_TOKEN: "jack-token-value-at-least-32-bytes-x",
  COMPANY_BRAIN_FOUNDER_ERIC_TOKEN: "eric-token-value-at-least-32-bytes-x",
};

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body, "utf8").digest("hex")}`;
}

function prPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "closed",
    installation: { id: 99 },
    sender: { login: "eric-forma" },
    repository: { full_name: "forma/app" },
    pull_request: {
      number: 12,
      title: "Fix posture report",
      body: "pre-cutover private body must not persist",
      merged: true,
      merged_at: "2026-08-20T12:00:00Z",
      created_at: "2026-07-01T12:00:00Z",
      updated_at: "2026-08-20T12:00:00Z",
      html_url: "https://github.com/forma/app/pull/12",
      ...overrides,
    },
  };
}

function brain() {
  const config = loadCompanyBrainConfig(env);
  return new CompanyBrain(config, new MemoryCompanyBrainStore());
}

function ingestPr(
  instance: CompanyBrain,
  payload: unknown,
  deliveryId = "del-1",
) {
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
  it("rejects unsigned, out-of-scope, pre-cutover, and missing timestamps before persist", async () => {
    const instance = brain();
    const payload = prPayload();
    const rawBody = JSON.stringify(payload);
    const unsigned = await instance.ingestGithubWebhook({
      eventName: "pull_request",
      deliveryId: "d1",
      rawBody,
      signatureHeader: undefined,
      payload,
    });
    assert.equal(unsigned.accepted, false);
    if (!unsigned.accepted) assert.equal(unsigned.code, "unsigned");

    const scoped = await ingestPr(instance, {
      ...payload,
      repository: { full_name: "other/repo" },
    });
    assert.equal(scoped.accepted, false);
    if (!scoped.accepted) assert.equal(scoped.code, "out_of_scope");

    const early = await ingestPr(
      instance,
      prPayload({ merged_at: "2026-07-01T00:00:00Z", merged: true }),
    );
    assert.equal(early.accepted, false);
    if (!early.accepted) assert.equal(early.code, "pre_cutover");

    const missing = await ingestPr(
      instance,
      prPayload({ merged_at: "", updated_at: "", created_at: "", merged: true }),
    );
    assert.equal(missing.accepted, false);
    if (!missing.accepted) assert.equal(missing.code, "missing_timestamp");
    assert.equal((await instance.store.listEvents()).length, 0);
    assert.equal(await instance.store.countEvents(), 0);
  });

  it("stores a minimized, ingest-attributed merged PR hard fact", async () => {
    const instance = brain();
    const first = await ingestPr(instance, prPayload());
    assert.equal(first.accepted, true);
    if (!first.accepted) throw new Error("expected accept");
    assert.equal(first.event.actorId, "ingest");
    assert.equal(first.observation?.actorId, "ingest");
    assert.equal(first.event.payload.actorLogin, "eric-forma");
    assert.equal("pr" in first.event.payload, false);
    assert.equal("body" in first.event.payload, false);
    assert.equal(first.appliedRevision?.epistemicClass, "fact");
    const state = await instance.currentState();
    assert.equal(state.length, 1);
    assert.ok(state[0]?.citations.length);
    const citation = state[0]!.citations[0]!;
    const resolved = await instance.evidence(citation.eventId);
    assert.deepEqual(Object.keys(resolved).sort(), [
      "entityKey",
      "eventId",
      "excerpt",
      "source",
      "sourceActionAt",
    ]);
  });

  it("is idempotent on delivery replay", async () => {
    const instance = brain();
    await ingestPr(instance, prPayload(), "same");
    const replay = await ingestPr(instance, prPayload(), "same");
    assert.equal(replay.accepted, true);
    if (!replay.accepted) throw new Error("expected accept");
    assert.equal(replay.duplicate, true);
    assert.equal((await instance.store.listEvents()).length, 1);
  });

  it("keeps older and equal-time deliveries without replacing latest", async () => {
    const instance = brain();
    await ingestPr(instance, prPayload(), "new");
    const equal = await ingestPr(
      instance,
      {
        action: "synchronize",
        installation: { id: 99 },
        repository: { full_name: "forma/app" },
        pull_request: {
          number: 12,
          title: "equal timestamp",
          merged: false,
          updated_at: "2026-08-20T12:00:00Z",
        },
      },
      "equal",
    );
    assert.equal(equal.accepted, true);
    if (!equal.accepted) throw new Error("expected accept");
    assert.equal(equal.stale, true);
    const latest = await instance.store.latestEventForEntity("pr:forma/app#12");
    assert.equal(latest?.externalEventId, "new");
  });

  it("tracks concurrent PRs independently and closes only matching work", async () => {
    const instance = brain();
    for (const number of [4, 5]) {
      await ingestPr(
        instance,
        {
          action: "opened",
          installation: { id: 99 },
          repository: { full_name: "forma/app" },
          pull_request: {
            number,
            title: `WIP ${number}`,
            merged: false,
            created_at: "2026-08-18T12:00:00Z",
            updated_at: `2026-08-18T12:0${number}:00Z`,
          },
        },
        `open-${number}`,
      );
    }
    const pendingBefore = (await instance.store.listProposals()).filter(
      (row) => row.status === "pending",
    );
    assert.equal(pendingBefore.length, 2);
    assert.notEqual(pendingBefore[0]?.stateKey, pendingBefore[1]?.stateKey);

    await ingestPr(
      instance,
      prPayload({
        number: 4,
        title: "WIP 4",
        merged: true,
        merged_at: "2026-08-21T12:00:00Z",
      }),
      "merge-4",
    );
    const proposals = await instance.store.listProposals();
    assert.equal(
      proposals.find((row) => row.stateKey.endsWith(".4"))?.status,
      "superseded",
    );
    assert.equal(
      proposals.find((row) => row.stateKey.endsWith(".5"))?.status,
      "pending",
    );
  });
});

describe("approval, evidence, and idempotency", () => {
  it("requires evidence for interpretive proposals", async () => {
    const instance = brain();
    await assert.rejects(
      instance.proposeStateChange({
        actor: agent,
        requestId: "empty-evidence",
        stateKey: "product.wedge",
        statement: "Unsupported claim",
        evidenceIds: [],
      }),
      /require at least one evidence/,
    );
  });

  it("lets agents propose idempotently but not approve", async () => {
    const instance = brain();
    const ingested = await ingestPr(instance, prPayload());
    if (!ingested.accepted) throw new Error("need event");
    const input = {
      actor: agent,
      requestId: "proposal-1",
      stateKey: "product.wedge",
      statement: "Physio is the customer",
      evidenceIds: [ingested.event.id],
    };
    const proposal = await instance.proposeStateChange(input);
    const replay = await instance.proposeStateChange(input);
    assert.equal(replay.id, proposal.id);
    await assert.rejects(
      instance.decideProposal({
        actor: agent,
        proposalId: proposal.id,
        action: "approve",
      }),
      /only authenticated founders/,
    );
    assert.equal(
      (await instance.store.getProposal(proposal.id))?.status,
      "pending",
    );
  });

  it("preserves MCP observation evidence lineage and request idempotency", async () => {
    const instance = brain();
    const ingested = await ingestPr(instance, prPayload());
    if (!ingested.accepted) throw new Error("need event");
    const observation = await instance.proposeObservation({
      actor: jack,
      requestId: "obs-1",
      statement: "The report needs to show drift",
      evidenceIds: [ingested.event.id],
      topicKeys: ["product.report"],
    });
    const replay = await instance.proposeObservation({
      actor: jack,
      requestId: "obs-1",
      statement: "ignored retry body",
      evidenceIds: [ingested.event.id],
      topicKeys: ["product.report"],
    });
    assert.equal(replay.id, observation.id);
    const proposal = await instance.proposeStateChange({
      actor: jack,
      requestId: "state-from-obs",
      stateKey: "product.report",
      statement: "Report exposes within-session drift",
      evidenceIds: [observation.id],
    });
    await instance.decideProposal({
      actor: eric,
      proposalId: proposal.id,
      action: "approve",
    });
    const state = (await instance.currentState()).find(
      (row) => row.stateKey === "product.report",
    );
    assert.ok(state?.citations.some((row) => row.eventId === ingested.event.id));
  });

  it("resolves conflicting Jack/Eric proposals into cited current state", async () => {
    const instance = brain();
    const ingested = await ingestPr(instance, prPayload());
    if (!ingested.accepted) throw new Error("need event");
    const jackProposal = await instance.proposeStateChange({
      actor: jack,
      requestId: "jack-wedge",
      stateKey: "product.wedge",
      statement: "Clinic value is longitudinal posture monitoring",
      evidenceIds: [ingested.event.id],
    });
    await instance.proposeStateChange({
      actor: eric,
      requestId: "eric-wedge",
      stateKey: "product.wedge",
      statement: "Clinic value is between-appointment adherence",
      evidenceIds: [ingested.event.id],
    });
    assert.equal(
      (await instance.context()).contradictions[0]?.pending.length,
      2,
    );
    await instance.decideProposal({
      actor: jack,
      proposalId: jackProposal.id,
      action: "approve",
    });
    const current = (await instance.currentState()).find(
      (row) => row.stateKey === "product.wedge",
    );
    assert.match(current?.statement ?? "", /longitudinal posture monitoring/);
    assert.ok(current?.citations.some((row) => row.eventId === ingested.event.id));
  });

  it("validates refinement before mutation and covers reject/stale approval", async () => {
    const instance = brain();
    const ingested = await ingestPr(instance, prPayload());
    if (!ingested.accepted) throw new Error("need event");
    const proposal = await instance.proposeStateChange({
      actor: eric,
      requestId: "refine-1",
      stateKey: "go.to.market",
      statement: "Use physios",
      evidenceIds: [ingested.event.id],
    });
    await assert.rejects(
      instance.decideProposal({
        actor: jack,
        proposalId: proposal.id,
        action: "refine",
        refinementStatement: " ",
      }),
      /refine requires/,
    );
    assert.equal(
      (await instance.store.getProposal(proposal.id))?.status,
      "pending",
    );
    const refined = await instance.decideProposal({
      actor: jack,
      proposalId: proposal.id,
      action: "refine",
      refinementStatement: "Physio is the filter, not the customer",
    });
    assert.equal(
      refined.revision?.statement,
      "Physio is the filter, not the customer",
    );
    await assert.rejects(
      instance.decideProposal({
        actor: jack,
        proposalId: proposal.id,
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
