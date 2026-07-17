/**
 * Compile strength / limitation intrapersonal_records from outcomes + friction (I3).
 */
import type { CortexStore } from "../store/index.js";
import type { IntrapersonalRecordRow } from "./types.js";

export interface CompileAbilityModelOptions {
  dryRun?: boolean;
  limit?: number;
}

export interface CompileAbilityModelResult {
  dryRun: boolean;
  strengths: IntrapersonalRecordRow[];
  limitations: IntrapersonalRecordRow[];
  written: number;
}

function countKeyword(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.reduce((n, w) => (lower.includes(w) ? n + 1 : n), 0);
}

export async function compileAbilityModel(
  store: CortexStore,
  options: CompileAbilityModelOptions = {},
): Promise<CompileAbilityModelResult> {
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit ?? 40;

  const [github, decisions, outcomes, affect, observations] = await Promise.all([
    store.listDistillates({ limit, kinds: ["github_outcome_digest"] }),
    store.listDecisionsTable({ limit: 30 }),
    store.listDistillates({ limit: 20, kinds: ["outcome"] }),
    store.listAffectSignals({ limit: 40, signalType: "friction" }),
    store.listObservations({ limit: 40, sourceFamily: "github" }),
  ]);

  const strengthCandidates: Array<{
    title: string;
    statement: string;
    confidence: number;
    evidenceIds: string[];
  }> = [];
  const limitationCandidates: Array<{
    title: string;
    statement: string;
    confidence: number;
    evidenceIds: string[];
  }> = [];

  const shippedHits = github.filter((d) =>
    /ship|merge|release|landed|deploy|pr/i.test(d.content ?? ""),
  );
  if (shippedHits.length >= 2) {
    strengthCandidates.push({
      title: "Ships concrete outcomes",
      statement:
        "Repeated GitHub outcome digests show merge/release/shipping behaviour across contexts.",
      confidence: Math.min(0.75, 0.4 + shippedHits.length * 0.08),
      evidenceIds: shippedHits.slice(0, 5).map((d) => d.id),
    });
  }

  const decisionAligned = decisions.filter((d) =>
    /ship|focus|cut|say no|priorit/i.test(`${d.title} ${d.statement}`),
  );
  if (decisionAligned.length >= 2) {
    strengthCandidates.push({
      title: "Makes scope / priority calls",
      statement:
        "Multiple decisions show explicit prioritisation or scope cuts rather than open-ended exploration.",
      confidence: Math.min(0.7, 0.35 + decisionAligned.length * 0.1),
      evidenceIds: decisionAligned.slice(0, 5).map((d) => d.id),
    });
  }

  for (const d of outcomes) {
    const text = d.content ?? "";
    if (countKeyword(text, ["improved", "worked", "success", "shipped"]) >= 1) {
      strengthCandidates.push({
        title: "Outcome follow-through",
        statement: text.slice(0, 220),
        confidence: 0.45,
        evidenceIds: [d.id],
      });
    }
  }

  // Limitations require repeated friction — never from absence alone
  if (affect.length >= 3) {
    const avg =
      affect.reduce((s, a) => s + a.value, 0) / Math.max(affect.length, 1);
    if (avg > 0.4) {
      limitationCandidates.push({
        title: "Recurring friction load",
        statement:
          "Multiple friction affect signals cluster in recent work — may indicate overload or avoidance of hard cuts.",
        confidence: Math.min(0.65, 0.35 + affect.length * 0.05),
        evidenceIds: affect.slice(0, 5).map((a) => a.id),
      });
    }
  }

  const avoidObs = observations.filter((o) =>
    /avoid|procrast|defer|stall|stuck/i.test(o.statement),
  );
  if (avoidObs.length >= 3) {
    limitationCandidates.push({
      title: "Avoidance under ambiguity",
      statement:
        "Several observations note deferral/stall language when tasks are ambiguous.",
      confidence: Math.min(0.6, 0.3 + avoidObs.length * 0.07),
      evidenceIds: avoidObs.slice(0, 5).map((o) => o.id),
    });
  }

  // Deduplicate by title
  const uniq = <T extends { title: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    return items.filter((i) => {
      const k = i.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const strengthsIn = uniq(strengthCandidates).slice(0, 6);
  const limitationsIn = uniq(limitationCandidates).slice(0, 6);

  if (dryRun) {
    const now = new Date().toISOString();
    return {
      dryRun: true,
      written: 0,
      strengths: strengthsIn.map((s, i) => ({
        id: `dry-str-${i}`,
        recordKind: "strength",
        title: s.title,
        statement: s.statement,
        epistemicType: "interpretation",
        confidence: s.confidence,
        status: "active",
        context: {},
        behaviour: {},
        outcome: {},
        origin: "inference",
        hypothesisId: null,
        interestId: null,
        metadata: { evidenceIds: s.evidenceIds },
        createdAt: now,
        updatedAt: now,
      })),
      limitations: limitationsIn.map((s, i) => ({
        id: `dry-lim-${i}`,
        recordKind: "limitation",
        title: s.title,
        statement: s.statement,
        epistemicType: "interpretation",
        confidence: s.confidence,
        status: "active",
        context: {},
        behaviour: {},
        outcome: {},
        origin: "inference",
        hypothesisId: null,
        interestId: null,
        metadata: { evidenceIds: s.evidenceIds },
        createdAt: now,
        updatedAt: now,
      })),
    };
  }

  const strengths: IntrapersonalRecordRow[] = [];
  const limitations: IntrapersonalRecordRow[] = [];
  let written = 0;

  for (const s of strengthsIn) {
    const row = await store.upsertIntrapersonalRecord({
      recordKind: "strength",
      title: s.title,
      statement: s.statement,
      epistemicType: "interpretation",
      confidence: s.confidence,
      status: "active",
      origin: "inference",
      metadata: {
        evidenceIds: s.evidenceIds,
        compiler: "ability-model-v1",
      },
    });
    strengths.push(row);
    written += 1;
  }
  for (const s of limitationsIn) {
    const row = await store.upsertIntrapersonalRecord({
      recordKind: "limitation",
      title: s.title,
      statement: s.statement,
      epistemicType: "interpretation",
      confidence: s.confidence,
      status: "active",
      origin: "inference",
      metadata: {
        evidenceIds: s.evidenceIds,
        compiler: "ability-model-v1",
      },
    });
    limitations.push(row);
    written += 1;
  }

  return { dryRun: false, strengths, limitations, written };
}
