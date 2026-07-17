/**
 * Prediction events + calibration stats (I4).
 */
import type { CortexStore } from "../store/index.js";
import type { PredictionEventRow } from "./types.js";

export async function recordPredictionResolution(
  store: CortexStore,
  input: {
    claimId: string;
    claimKind?: string;
    domain?: string | null;
    predicted: string;
    actual: string;
    correct: boolean;
  },
): Promise<PredictionEventRow> {
  return store.upsertPredictionEvent({
    claimId: input.claimId,
    claimKind: input.claimKind ?? "hypothesis",
    domain: input.domain ?? null,
    predicted: input.predicted,
    actual: input.actual,
    correct: input.correct,
    resolvedAt: new Date().toISOString(),
  });
}

export interface CalibrationStats {
  total: number;
  resolved: number;
  correct: number;
  accuracy: number | null;
  byDomain: Record<
    string,
    { total: number; correct: number; accuracy: number | null }
  >;
  recent: PredictionEventRow[];
}

export async function getCalibrationStats(
  store: CortexStore,
  options: { limit?: number; since?: string } = {},
): Promise<CalibrationStats> {
  const events = await store.listPredictionEvents({
    limit: options.limit ?? 100,
    since: options.since,
  });
  const resolved = events.filter((e) => e.correct != null);
  const correct = resolved.filter((e) => e.correct === true);
  const byDomain: CalibrationStats["byDomain"] = {};
  for (const e of resolved) {
    const key = e.domain ?? "unknown";
    if (!byDomain[key]) byDomain[key] = { total: 0, correct: 0, accuracy: null };
    byDomain[key]!.total += 1;
    if (e.correct) byDomain[key]!.correct += 1;
  }
  for (const row of Object.values(byDomain)) {
    row.accuracy = row.total ? row.correct / row.total : null;
  }
  return {
    total: events.length,
    resolved: resolved.length,
    correct: correct.length,
    accuracy: resolved.length ? correct.length / resolved.length : null,
    byDomain,
    recent: events.slice(0, 10),
  };
}
