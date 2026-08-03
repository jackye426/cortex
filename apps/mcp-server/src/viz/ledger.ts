/**
 * Build VizLedger payloads for mirror | questions | self | interests | attr | diff.
 */
import {
  emptyLedger,
  type VizLedger,
  type VizLedgerChannel,
  type VizLedgerRow,
  type VizMeter,
} from "@cortex/viz-contracts";
import type { CortexStore } from "../store/index.js";
import { getLatestWeeklyMirror } from "../intrapersonal/weekly-mirror.js";
import { listOpenQuestions } from "../intrapersonal/open-questions.js";
import { computeIntrapersonalMetrics } from "../intrapersonal/metrics.js";
import { runPriorityVsActual } from "../project-brief.js";

async function virMeters(store: CortexStore): Promise<VizMeter[]> {
  const [m7, m30, m90] = await Promise.all([
    computeIntrapersonalMetrics(store, { windowDays: 7 }),
    computeIntrapersonalMetrics(store, { windowDays: 30 }),
    computeIntrapersonalMetrics(store, { windowDays: 90 }),
  ]);
  return [
    { id: "VIR7", label: "VIR7", value: m7.validatedInsightRate ?? 0 },
    { id: "VIR30", label: "VIR30", value: m30.validatedInsightRate ?? 0 },
    { id: "VIR90", label: "VIR90", value: m90.validatedInsightRate ?? 0 },
    { id: "PROV", label: "PROVENANCE", value: m30.provenanceCoverage ?? 0 },
    { id: "MFAM", label: "MULTI_FAM", value: m30.highConfidenceMultiFamilyRate ?? 0 },
    { id: "OUT", label: "DEC_OUT", value: m30.decisionsWithOutcomeRate ?? 0 },
  ];
}

export async function buildVizLedger(
  store: CortexStore,
  channel: VizLedgerChannel,
): Promise<VizLedger> {
  try {
    const meters = await virMeters(store);
    const ticker = [`LEDGER/${channel.toUpperCase()}`, new Date().toISOString()];
    switch (channel) {
      case "mirror":
        return await buildMirror(store, meters, ticker);
      case "questions":
        return await buildQuestions(store, meters, ticker);
      case "self":
        return await buildSelf(store, meters, ticker);
      case "interests":
        return await buildInterests(store, meters, ticker);
      case "attr":
        return await buildAttr(store, meters, ticker);
      case "diff":
        return await buildDiff(store, meters, ticker);
      default:
        return emptyLedger("mirror");
    }
  } catch (err) {
    const empty = emptyLedger(channel);
    empty.ticker = [err instanceof Error ? err.message : String(err)];
    return empty;
  }
}

async function buildMirror(
  store: CortexStore,
  meters: VizMeter[],
  ticker: string[],
): Promise<VizLedger> {
  const latest = await getLatestWeeklyMirror(store);
  const cards = (latest.mirror?.cards ?? []).slice(0, 5);
  const rows: VizLedgerRow[] = cards.map((c) => ({
    id: c.id,
    channel: "mirror",
    title: `${(c.theme ?? "insight").toUpperCase()} / ${c.notice.slice(0, 40)}`,
    subtitle: c.theme,
    confidence: c.confidence,
    x: c.confidence,
    y: Math.min(1, c.evidence.length / 5),
    detail: {
      kind: "mirror",
      theme: c.theme,
      notice: c.notice,
      why: c.why,
      evidenceCount: c.evidence.length,
      confidence: c.confidence,
      rival: c.rival,
      test: c.test,
      contradictions: c.contradictions,
      hypothesisId: c.hypothesisId ?? c.id,
      controls: c.controls,
    },
  }));
  return {
    channel: "mirror",
    generatedAt: new Date().toISOString(),
    rows,
    meters,
    ticker,
  };
}

async function buildQuestions(
  store: CortexStore,
  meters: VizMeter[],
  ticker: string[],
): Promise<VizLedger> {
  const payload = await listOpenQuestions(store, { limit: 20 });
  const rows: VizLedgerRow[] = payload.items.map((item, i) => {
    const statement =
      item.hypothesis?.claim ??
      item.experiment?.protocol ??
      item.card.notice;
    return {
      id: item.hypothesis?.id ?? item.experiment?.id ?? `q-${i}`,
      channel: "questions",
      title: statement.slice(0, 48).toUpperCase(),
      subtitle: `score=${item.score.toFixed(2)}`,
      score: item.score,
      confidence: item.hypothesis?.confidence ?? item.card.confidence,
      x: item.hypothesis?.confidence ?? 0.5,
      y: item.score,
      detail: {
        kind: "questions",
        statement,
        missingEvidence: item.reasons.filter((r) => r.includes("source") || r.includes("gap")),
        score: item.score,
        reasons: item.reasons,
        hypothesisId: item.hypothesis?.id,
      },
    };
  });
  return {
    channel: "questions",
    generatedAt: new Date().toISOString(),
    rows,
    meters,
    ticker,
  };
}

async function buildSelf(
  store: CortexStore,
  meters: VizMeter[],
  ticker: string[],
): Promise<VizLedger> {
  const self = await store.getLatestSelfModelVersion();
  const rows: VizLedgerRow[] = [];
  if (self) {
    const facets = [
      ["strengths", self.strengths],
      ["limitations", self.limitations],
      ["motives", self.motives],
      ["tensions", self.tensions],
      ["identity", self.identityDevelopment],
    ] as const;
    for (const [facet, items] of facets) {
      for (const item of items) {
        rows.push({
          id: item.id ?? `${facet}-${rows.length}`,
          channel: "self",
          title: `${facet.toUpperCase()} / ${(item.title || item.statement).slice(0, 32)}`,
          subtitle: `facet=${facet}`,
          confidence: item.confidence,
          x: item.confidence,
          y: Math.min(1, (item.evidenceIds?.length ?? 1) / 5),
          detail: {
            kind: "self",
            facet,
            statement: item.statement,
            confidence: item.confidence,
            evidenceCount: item.evidenceIds?.length ?? 0,
          },
        });
      }
    }
  }
  return {
    channel: "self",
    generatedAt: new Date().toISOString(),
    rows,
    meters,
    ticker,
  };
}

async function buildInterests(
  store: CortexStore,
  meters: VizMeter[],
  ticker: string[],
): Promise<VizLedger> {
  const interests = await store.listInterests({ limit: 40 });
  const rows: VizLedgerRow[] = interests.map((interest) => ({
    id: interest.id,
    channel: "interests",
    title: `${interest.class.toUpperCase()} / ${interest.displayName.slice(0, 32)}`,
    subtitle: `class=${interest.class}`,
    confidence: interest.confidence,
    x: interest.recurrenceScore,
    y: interest.voluntaryReturnScore,
    detail: {
      kind: "interests",
      class: interest.class,
      summary: interest.summary,
      recurrence: interest.recurrenceScore,
      voluntaryReturn: interest.voluntaryReturnScore,
      energyDelta: interest.energyDelta,
    },
  }));
  return {
    channel: "interests",
    generatedAt: new Date().toISOString(),
    rows,
    meters,
    ticker,
  };
}

async function buildAttr(
  store: CortexStore,
  meters: VizMeter[],
  ticker: string[],
): Promise<VizLedger> {
  const pva = await runPriorityVsActual(store, { dryRun: true });
  const rows: VizLedgerRow[] = pva.attribution.map((row) => ({
    id: row.projectKey,
    channel: "attr",
    title: row.projectKey.toUpperCase(),
    subtitle: `pct=${row.pct.toFixed(2)}`,
    x: row.pct,
    y: Math.min(1, row.sessions / 30),
    detail: {
      kind: "attr",
      projectKey: row.projectKey,
      claimedHours: 0,
      actualHours: row.hours,
      pct: row.pct,
      sessions: row.sessions,
    },
  }));
  return {
    channel: "attr",
    generatedAt: new Date().toISOString(),
    rows,
    meters,
    ticker,
  };
}

async function buildDiff(
  store: CortexStore,
  meters: VizMeter[],
  ticker: string[],
): Promise<VizLedger> {
  const diffs = await store.listSelfModelDiffs({ limit: 1 });
  const diff = diffs[0];
  const rows: VizLedgerRow[] = [];
  if (diff) {
    const push = (
      bucket: "emerging" | "fading" | "stable",
      items: Array<Record<string, unknown>>,
    ) => {
      for (const item of items) {
        const statement = String(
          item.statement ?? item.title ?? item.claim ?? JSON.stringify(item).slice(0, 80),
        );
        rows.push({
          id: `${bucket}-${rows.length}`,
          channel: "diff",
          title: `${bucket.toUpperCase()} / ${statement.slice(0, 36)}`,
          subtitle: `bucket=${bucket}`,
          x: bucket === "emerging" ? 0.7 : bucket === "fading" ? 0.3 : 0.5,
          y: 0.4 + rows.length * 0.03,
          detail: {
            kind: "diff",
            bucket,
            statement,
            eventAnchors: Array.isArray(diff.eventAnchors)
              ? diff.eventAnchors.map((a) => String((a as { label?: string }).label ?? a)).slice(0, 6)
              : [],
          },
        });
      }
    };
    push("emerging", diff.emerging);
    push("fading", diff.fading);
    push("stable", diff.stable);
  }
  return {
    channel: "diff",
    generatedAt: new Date().toISOString(),
    rows,
    meters,
    ticker,
  };
}
