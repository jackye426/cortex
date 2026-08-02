/**
 * VIR writeback for data-verse ledger controls.
 */
import type { CortexStore } from "../store/index.js";
import {
  confirmHypothesis,
  rejectHypothesis,
  refineHypothesis,
} from "../intrapersonal/hypotheses.js";
import type { VizVerdictRequest, VizVerdictResponse } from "@cortex/viz-contracts";

export async function applyVizVerdict(
  store: CortexStore,
  body: VizVerdictRequest,
): Promise<VizVerdictResponse> {
  const { insightId, verdict, note, claim, useful, nonObvious, retire } = body;
  if (!insightId) {
    return { ok: false, insightId: "", verdict, error: "insightId_required" };
  }

  if (verdict === "confirm") {
    const row = await confirmHypothesis(store, insightId, note, { useful, nonObvious });
    if (!row) return { ok: false, insightId, verdict, error: "not_found" };
    return { ok: true, insightId, verdict, hypothesis: row as unknown as Record<string, unknown> };
  }
  if (verdict === "reject") {
    const row = await rejectHypothesis(store, insightId, note, { retire });
    if (!row) return { ok: false, insightId, verdict, error: "not_found" };
    return { ok: true, insightId, verdict, hypothesis: row as unknown as Record<string, unknown> };
  }
  if (verdict === "refine") {
    const row = await refineHypothesis(store, insightId, { claim, note });
    if (!row) return { ok: false, insightId, verdict, error: "not_found" };
    return { ok: true, insightId, verdict, hypothesis: row as unknown as Record<string, unknown> };
  }
  return { ok: false, insightId, verdict, error: "invalid_verdict" };
}
