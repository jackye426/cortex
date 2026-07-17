/**
 * Detect repeating avoidance / decision patterns (I4/I5 heuristics).
 */
import type { CortexStore } from "../store/index.js";
import { proposeHypothesis } from "./hypotheses.js";
import type { HypothesisRow, ObservationRow } from "./types.js";

export interface DetectedCycle {
  kind: "avoidance" | "decision_oscillation" | "interest_fade";
  label: string;
  instances: number;
  evidenceIds: string[];
  claim: string;
}

export interface DetectCyclesResult {
  cycles: DetectedCycle[];
  hypotheses: HypothesisRow[];
}

const AVOID_RE = /\b(avoid|defer|stall|procrast|put off|later|stuck)\b/i;
const OSCILLATE_RE =
  /\b(status|autonomy|switch|oscillat|flip|change mind|reconsider)\b/i;

function groupByStem(obs: ObservationRow[]): Map<string, ObservationRow[]> {
  const map = new Map<string, ObservationRow[]>();
  for (const o of obs) {
    const words = o.statement
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 4);
    const key = words.slice(0, 2).join(" ") || o.sourceFamily;
    const list = map.get(key) ?? [];
    list.push(o);
    map.set(key, list);
  }
  return map;
}

export async function detectCycles(
  store: CortexStore,
  options: { dryRun?: boolean; minInstances?: number } = {},
): Promise<DetectCyclesResult> {
  const minInstances = options.minInstances ?? 3;
  const [observations, hypotheses, decisions] = await Promise.all([
    store.listObservations({ limit: 100 }),
    store.listHypotheses({ limit: 50 }),
    store.listDecisionsTable({ limit: 40 }),
  ]);

  const cycles: DetectedCycle[] = [];
  const avoidObs = observations.filter((o) => AVOID_RE.test(o.statement));
  for (const [stem, rows] of groupByStem(avoidObs)) {
    if (rows.length < minInstances) continue;
    cycles.push({
      kind: "avoidance",
      label: `Avoidance loop: ${stem}`,
      instances: rows.length,
      evidenceIds: rows.map((r) => r.id),
      claim: `Repeating avoidance pattern around "${stem}" (≥${rows.length} instances).`,
    });
  }

  const oscObs = observations.filter((o) => OSCILLATE_RE.test(o.statement));
  const oscDec = decisions.filter((d) =>
    OSCILLATE_RE.test(`${d.title} ${d.statement}`),
  );
  if (oscObs.length + oscDec.length >= minInstances) {
    cycles.push({
      kind: "decision_oscillation",
      label: "Decision oscillation",
      instances: oscObs.length + oscDec.length,
      evidenceIds: [
        ...oscObs.map((o) => o.id),
        ...oscDec.map((d) => d.id),
      ].slice(0, 8),
      claim:
        "Decisions appear to oscillate between competing values (e.g. status vs autonomy) across recent windows.",
    });
  }

  // Interest fade: emerging hyp with dormant interest language
  const fadeHyps = hypotheses.filter(
    (h) =>
      h.domains.includes("interest") &&
      /fade|dormant|quiet|lost interest/i.test(h.claim),
  );
  if (fadeHyps.length >= 1) {
    cycles.push({
      kind: "interest_fade",
      label: "Interest start-strong / fade",
      instances: fadeHyps.length,
      evidenceIds: fadeHyps.map((h) => h.id),
      claim:
        "Some interests appear to start strong and fade — may be situational rather than terminal.",
    });
  }

  const created: HypothesisRow[] = [];
  if (!options.dryRun) {
    for (const cycle of cycles) {
      const existing = hypotheses.find(
        (h) => h.claim.toLowerCase() === cycle.claim.toLowerCase(),
      );
      if (existing) continue;
      const row = await proposeHypothesis(store, {
        claim: cycle.claim,
        whyItMatters: `Cycle detector (${cycle.kind}) — ${cycle.instances} instances.`,
        domains: [
          cycle.kind === "avoidance"
            ? "avoidance"
            : cycle.kind === "decision_oscillation"
              ? "decision"
              : "interest",
        ],
        alternativeExplanations: [
          "Sampling bias in recent observations rather than a durable loop.",
        ],
        falsifiers: [
          "Two consecutive weeks without the repeating pattern under similar conditions.",
        ],
        confidence: Math.min(0.55, 0.3 + cycle.instances * 0.05),
        origin: "cycle_detect",
        assistantWeight: 0.5,
        metadata: {
          cycleKind: cycle.kind,
          evidenceIds: cycle.evidenceIds,
        },
      });
      created.push(row);
    }
  }

  return { cycles, hypotheses: created };
}
