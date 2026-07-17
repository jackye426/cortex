import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixtureStore } from "../store/fixture-store.js";
import {
  confirmHypothesis,
  proposeHypothesis,
  rejectHypothesis,
} from "./hypotheses.js";
import { compileSelfModelVersion } from "./self-model-v2.js";
import {
  completeExperiment,
  proposeExperiment,
} from "./experiments.js";
import { refreshWeeklyMirror } from "./weekly-mirror.js";
import { assertInsightCardComplete } from "./insight-card.js";
import { diffSelfModelVersions } from "./change-explain.js";
import { computeIntrapersonalMetrics } from "./metrics.js";

describe("hypotheses → self-model corrections", () => {
  it("reject keeps claim out of next self-model version", async () => {
    const store = new FixtureStore();
    const hyp = await proposeHypothesis(store, {
      claim: "I avoid hard prioritisation when status feels at risk",
      whyItMatters: "Burns weeks",
      domains: ["avoidance", "motive"],
      alternativeExplanations: ["Calendar overload"],
      confidence: 0.5,
      origin: "user",
    });

    const v1 = await compileSelfModelVersion(store, { skipAbility: true });
    assert.ok(v1.version);
    const inV1 = v1.version!.tensions.some(
      (t) => t.hypothesisId === hyp.id || t.statement.includes("prioritisation"),
    );
    assert.equal(inV1, true);

    await rejectHypothesis(store, hyp.id, "Not accurate", { retire: false });

    const v2 = await compileSelfModelVersion(store, { skipAbility: true });
    assert.ok(v2.version);
    assert.ok((v2.version!.version ?? 0) > (v1.version!.version ?? 0));
    const inV2 = v2.version!.tensions.some(
      (t) => t.hypothesisId === hyp.id || t.statement === hyp.claim,
    );
    assert.equal(inV2, false);
    assert.ok(
      v2.version!.userCorrections.some(
        (c) => c.verdict === "reject" || String(c.insightId) === hyp.id,
      ),
    );
  });

  it("confirm records VIR verdict", async () => {
    const store = new FixtureStore();
    const hyp = await proposeHypothesis(store, {
      claim: "Deep work after noon recovers energy",
      domains: ["energy"],
      confidence: 0.4,
    });
    await confirmHypothesis(store, hyp.id, "Useful", {
      useful: true,
      nonObvious: true,
    });
    const verdicts = await store.listInsightVerdicts({ insightId: hyp.id });
    assert.equal(verdicts[0]?.verdict, "confirm");
    assert.equal(verdicts[0]?.useful, true);
  });
});

describe("experiments calibration", () => {
  it("contradict → hypothesis disputed + confidence drop", async () => {
    const store = new FixtureStore();
    const hyp = await proposeHypothesis(store, {
      claim: "Shipping tiny PRs always restores momentum",
      domains: ["strength"],
      confidence: 0.6,
    });
    await store.upsertHypothesis({
      id: hyp.id,
      claim: hyp.claim,
      confidence: 0.6,
      sourceDiversity: 2,
      state: "emerging",
      domains: hyp.domains,
      alternativeExplanations: hyp.alternativeExplanations,
    });
    const exp = await proposeExperiment(store, { hypothesisId: hyp.id });
    assert.ok(exp);
    const { hypothesis } = await completeExperiment(store, {
      experimentId: exp!.id,
      resultSummary: "Tiny PR did not restore momentum; still stalled.",
      resultPolarity: "contradicts",
    });
    assert.ok(hypothesis);
    assert.equal(hypothesis!.state, "disputed");
    assert.ok(hypothesis!.confidence < 0.6);
  });
});

describe("weekly mirror", () => {
  it("returns ≤5 full insight cards", async () => {
    const store = new FixtureStore();
    await proposeHypothesis(store, {
      claim: "Energy dips after long email blocks",
      domains: ["energy"],
    });
    const result = await refreshWeeklyMirror(store, { dryRun: false });
    assert.ok(result.mirror.cards.length <= 5);
    assert.equal(result.mirror.cards.length, 5);
    for (const card of result.mirror.cards) {
      const missing = assertInsightCardComplete(card);
      assert.deepEqual(missing, []);
      assert.ok(card.controls.confirm && card.controls.reject && card.controls.refine);
    }
  });
});

describe("self-model diff emerging/fading", () => {
  it("classifies emerging and fading items across versions", () => {
    const from = {
      id: "v1",
      version: 1,
      summary: "v1",
      compiledFrom: {},
      strengths: [
        {
          title: "Ships",
          statement: "Ships concrete outcomes",
          confidence: 0.6,
        },
      ],
      limitations: [],
      motives: [
        {
          title: "Status",
          statement: "Status seeking",
          confidence: 0.5,
        },
      ],
      tensions: [],
      identityDevelopment: [],
      openQuestionIds: [],
      supersedesId: null,
      userCorrections: [],
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    const to = {
      id: "v2",
      version: 2,
      summary: "v2",
      compiledFrom: {},
      strengths: [
        {
          title: "Ships",
          statement: "Ships concrete outcomes",
          confidence: 0.7,
        },
        {
          title: "Focus",
          statement: "Protects deep work blocks",
          confidence: 0.55,
        },
      ],
      limitations: [],
      motives: [],
      tensions: [],
      identityDevelopment: [],
      openQuestionIds: [],
      supersedesId: "v1",
      userCorrections: [],
      createdAt: "2026-07-10T00:00:00.000Z",
    };
    const diff = diffSelfModelVersions(from, to);
    assert.ok(diff.emerging.some((e) => String(e.title) === "Focus"));
    assert.ok(diff.fading.some((e) => String(e.title) === "Status"));
    assert.ok(diff.stable.some((e) => String(e.title) === "Ships"));
  });
});

describe("metrics VIR", () => {
  it("computes VIR from insight verdicts", async () => {
    const store = new FixtureStore();
    const hyp = await proposeHypothesis(store, {
      claim: "Voluntary return marks terminal interest",
      domains: ["interest"],
    });
    await confirmHypothesis(store, hyp.id, "Yep", {
      useful: true,
      nonObvious: true,
    });
    await rejectHypothesis(
      store,
      (
        await proposeHypothesis(store, {
          claim: "Noise claim",
          domains: ["other"],
        })
      ).id,
      "Nope",
    );

    // Surface via weekly mirror so denominator is cards
    await refreshWeeklyMirror(store);
    const metrics = await computeIntrapersonalMetrics(store, {
      windowDays: 30,
    });
    assert.ok(metrics.surfacedDenom > 0);
    assert.ok(metrics.validatedNumer >= 1);
    assert.ok(metrics.validatedInsightRate != null);
    assert.ok(metrics.validatedInsightRate! > 0);
    assert.ok((metrics.verdictCounts.confirm ?? 0) >= 1);
    assert.ok((metrics.verdictCounts.reject ?? 0) >= 1);
  });
});
