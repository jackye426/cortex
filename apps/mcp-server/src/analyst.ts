/**
 * Query-time Analyst (ask_mirror) — citation-required synthesis.
 * Answers are ephemeral by default (not persisted).
 */
import {
  chatJsonCompletion,
  distillateModel,
  openaiConfigured,
} from "./llm.js";
import {
  rankConnectionCandidates,
  type CandidateMemory,
} from "./connection-candidates.js";
import {
  distillateMatchesLenses,
  type MemoryMode,
} from "./store/memory-lenses.js";
import type { CortexStore } from "./store/index.js";
import type { DistillateRow, MemorySearchHit, RecordHit } from "./store/types.js";

export interface AskMirrorOptions {
  query: string;
  mode?: MemoryMode;
  limit?: number;
  dryRun?: boolean;
}

export interface MirrorClaim {
  text: string;
  claimType: "fact" | "observation" | "hypothesis";
  confidence: number;
  evidenceRefs: string[];
}

export interface AskMirrorResult {
  answer: string;
  claims: MirrorClaim[];
  contradictions: string[];
  coverage: string;
  gaps: string[];
  followUpQuestions: string[];
  confidence: number;
  mode: MemoryMode;
  evidence: Array<{
    id: string;
    kind: string;
    title: string;
    snippet: string;
    evidenceStrength: "distillate" | "keyword_only";
  }>;
  candidates: Array<{
    score: number;
    reasons: string[];
    a: string;
    b: string;
  }>;
  engine: "llm" | "stub";
}

function classifyMode(query: string, explicit?: MemoryMode): MemoryMode {
  if (explicit) return explicit;
  const q = query.toLowerCase();
  if (
    /next action|what did i (do|ship|build)|commitment|follow.?through|calendar|email thread/i.test(
      q,
    )
  ) {
    return "operational";
  }
  if (
    /avoid|strength|weakness|tendenc|interest|explor|pattern|who am i|overlap|friction/i.test(
      q,
    )
  ) {
    return "reflective";
  }
  return "both";
}

function analystModel(): string {
  return process.env.CORTEX_ANALYST_MODEL?.trim() || distillateModel();
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function validateClaims(
  claims: MirrorClaim[],
  allowedIds: Set<string>,
): MirrorClaim[] {
  return claims
    .map((c) => ({
      ...c,
      evidenceRefs: c.evidenceRefs.filter((id) => allowedIds.has(id)),
    }))
    .filter((c) => c.evidenceRefs.length > 0 || c.claimType === "hypothesis");
}

function stubAnswer(
  query: string,
  evidence: AskMirrorResult["evidence"],
  candidates: AskMirrorResult["candidates"],
): AskMirrorResult {
  if (evidence.length === 0) {
    return {
      answer: "Insufficient evidence in the vault for this question.",
      claims: [],
      contradictions: [],
      coverage: "empty",
      gaps: ["No matching distillates or keyword hits."],
      followUpQuestions: ["Try a more specific project, topic, or time range."],
      confidence: 0,
      mode: "both",
      evidence,
      candidates,
      engine: "stub",
    };
  }
  const refs = evidence.slice(0, 3).map((e) => e.id);
  return {
    answer: `Based on ${evidence.length} evidence items: ${evidence
      .slice(0, 3)
      .map((e) => e.snippet)
      .join(" | ")}`,
    claims: [
      {
        text: `Retrieved evidence related to: ${query}`,
        claimType: "observation",
        confidence: 0.55,
        evidenceRefs: refs,
      },
    ],
    contradictions: [],
    coverage: "stub-heuristic",
    gaps: ["LLM unavailable — stub synthesis only."],
    followUpQuestions: [],
    confidence: 0.55,
    mode: "both",
    evidence,
    candidates,
    engine: "stub",
  };
}

export async function askMirror(
  store: CortexStore,
  options: AskMirrorOptions,
): Promise<AskMirrorResult> {
  const mode = classifyMode(options.query, options.mode);
  const limit = options.limit ?? 12;
  const trimmed = options.query.trim();

  const wantsEmail =
    /\b(email|gmail|inbox|thread|commitment|open loop|commitments)\b/i.test(
      trimmed,
    );
  const wantsGithub = /\b(github|pull request|\bPR\b|issue|shipped|stalled)\b/i.test(
    trimmed,
  );
  const wantsCalendar = /\b(calendar|meeting|1:1|interview)\b/i.test(trimmed);

  const memory = await store.searchMemory(trimmed, {
    limit,
    mode,
  });

  const evidence: AskMirrorResult["evidence"] = memory.hits.map((h) => ({
    id: h.id,
    kind: h.distillateKind ?? h.recordType ?? h.kind,
    title: h.title,
    snippet: h.snippet,
    evidenceStrength: h.kind === "distillate" ? "distillate" : "keyword_only",
  }));

  // Expand keyword-only records when reflective/cross questions need support
  if (mode !== "operational") {
    const records = await store.searchRecords(trimmed, {
      limit: 8,
      recordTypes: ["youtube_watch", "youtube_video", "email_message"],
    });
    for (const r of records.hits) {
      if (evidence.some((e) => e.id === r.id)) continue;
      evidence.push({
        id: r.id,
        kind: r.recordType,
        title:
          (typeof r.payload.title === "string" && r.payload.title) ||
          (typeof r.payload.subject === "string" && r.payload.subject) ||
          r.sourceRecordId,
        snippet: JSON.stringify(r.payload).slice(0, 220),
        evidenceStrength: "keyword_only",
      });
    }
  }

  const boostKinds: string[] = [];
  if (wantsEmail) boostKinds.push("email_thread_digest");
  if (wantsGithub) boostKinds.push("github_outcome_digest");
  if (wantsCalendar) boostKinds.push("calendar_event_digest");

  const [recentDistillates, boosted] = await Promise.all([
    store.listDistillates({ limit: 40 }),
    boostKinds.length
      ? store.listDistillates({ limit: 20, kinds: boostKinds })
      : Promise.resolve([]),
  ]);
  const distillates = [...boosted, ...recentDistillates].filter(
    (d, i, arr) => arr.findIndex((x) => x.id === d.id) === i,
  );
  const byId = new Map(distillates.map((d) => [d.id, d]));

  // Source-aware boost: vector search often floods with session summaries.
  if (boostKinds.length) {
    const boostedEvidence: AskMirrorResult["evidence"] = [];
    for (const d of boosted) {
      if (!distillateMatchesLenses(d, { mode })) continue;
      const hay = `${d.content ?? ""}\n${JSON.stringify(d.metadata)}`.toLowerCase();
      const tokens = trimmed
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4);
      const topical =
        tokens.length === 0 ||
        tokens.some((t) => hay.includes(t)) ||
        /email|gmail|commitment|open loop|docmap|pilot|github|calendar|meeting/i.test(
          trimmed,
        );
      if (!topical) continue;
      boostedEvidence.push({
        id: d.id,
        kind: d.kind,
        title: `${d.kind}:${d.subjectType}/${d.subjectId}`,
        snippet: (d.content ?? "").slice(0, 280),
        evidenceStrength: "distillate",
      });
    }
    if (boostedEvidence.length) {
      const rest = evidence.filter(
        (e) => !boostedEvidence.some((b) => b.id === e.id),
      );
      evidence.length = 0;
      evidence.push(...boostedEvidence, ...rest);
      if (evidence.length > Math.max(limit, 12)) {
        evidence.length = Math.max(limit, 12);
      }
    }
  }

  // Lens-filtered fallback: natural-language questions often miss keyword ILIKE
  if (evidence.length < Math.min(limit, 6)) {
    for (const d of distillates) {
      if (evidence.length >= limit) break;
      if (!distillateMatchesLenses(d, { mode })) continue;
      if (evidence.some((e) => e.id === d.id)) continue;
      const hay = `${d.content ?? ""}\n${JSON.stringify(d.metadata)}`.toLowerCase();
      const tokens = trimmed
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4);
      const hit =
        tokens.length === 0 ||
        tokens.some((t) => hay.includes(t)) ||
        /next action|commitment|overlap|interest|youtube|cortex|weak|strength|explor|email|gmail/i.test(
          trimmed,
        );
      if (!hit) continue;
      evidence.push({
        id: d.id,
        kind: d.kind,
        title: `${d.kind}:${d.subjectType}/${d.subjectId}`,
        snippet: (d.content ?? "").slice(0, 280),
        evidenceStrength: "distillate",
      });
    }
  }

  const candidatesInput: CandidateMemory[] = distillates.map((d) => ({
    id: d.id,
    kind: d.kind,
    sourceType:
      typeof d.metadata.sourceType === "string"
        ? d.metadata.sourceType
        : typeof d.metadata.sourceId === "string"
          ? d.metadata.sourceId
          : d.kind.includes("youtube")
            ? "youtube"
            : "session",
    content: d.content ?? "",
    topics: Array.isArray(d.metadata.topics)
      ? d.metadata.topics.filter((x): x is string => typeof x === "string")
      : [],
    projects: Array.isArray(d.metadata.projects)
      ? d.metadata.projects.filter((x): x is string => typeof x === "string")
      : [],
    occurredAt: d.updatedAt,
    embedding: d.embedding,
    domain:
      typeof d.metadata.domain === "string"
        ? d.metadata.domain
        : Array.isArray(d.metadata.domains)
          ? String(d.metadata.domains[0] ?? "")
          : undefined,
  }));

  const ranked = rankConnectionCandidates(candidatesInput, {
    limit: 8,
    requireCrossSource: /overlap|youtube|interest|cross/i.test(trimmed)
      ? true
      : false,
  });

  const candidateSummary = ranked.map((c) => ({
    score: c.score,
    reasons: c.reasons,
    a: c.a.id,
    b: c.b.id,
  }));

  // Promote connection-candidate nodes into cited evidence with content
  for (const c of ranked) {
    for (const node of [c.a, c.b]) {
      if (evidence.some((e) => e.id === node.id)) continue;
      const d = byId.get(node.id);
      evidence.push({
        id: node.id,
        kind: node.kind,
        title: d
          ? `${d.kind}:${d.subjectType}/${d.subjectId}`
          : `${node.kind}:${node.id}`,
        snippet: (d?.content ?? node.content).slice(0, 280),
        evidenceStrength: "distillate",
      });
    }
  }

  const allowedIds = new Set(evidence.map((e) => e.id));
  for (const c of ranked) {
    allowedIds.add(c.a.id);
    allowedIds.add(c.b.id);
  }

  if (!openaiConfigured() || options.dryRun) {
    const stub = stubAnswer(trimmed, evidence, candidateSummary);
    stub.mode = mode;
    return stub;
  }

  if (evidence.length === 0 && ranked.length === 0) {
    return {
      answer: "Insufficient evidence in the vault for this question.",
      claims: [],
      contradictions: [],
      coverage: "empty",
      gaps: ["No matching memories found."],
      followUpQuestions: [],
      confidence: 0,
      mode,
      evidence,
      candidates: candidateSummary,
      engine: "llm",
    };
  }

  const evidenceBlock = evidence
    .map(
      (e) =>
        `- id=${e.id} kind=${e.kind} strength=${e.evidenceStrength} title=${e.title}\n  ${e.snippet}`,
    )
    .join("\n");
  const candidateBlock = ranked
    .map(
      (c) =>
        `- ${c.a.id} ↔ ${c.b.id} score=${c.score.toFixed(2)} reasons=${c.reasons.join("; ")}`,
    )
    .join("\n");

  try {
    const { text } = await chatJsonCompletion({
      system: `You are Cortex Mirror Analyst. Answer ONLY from supplied evidence.
Return JSON: {
  answer: string,
  claims: [{ text, claimType: "fact"|"observation"|"hypothesis", confidence: number, evidenceRefs: string[] }],
  contradictions: string[],
  coverage: string,
  gaps: string[],
  followUpQuestions: string[],
  confidence: number
}
Rules:
- Every non-hypothesis claim MUST cite evidenceRefs that exist in the evidence list.
- keyword_only evidence is weaker than distillate evidence; do not claim strong semantic overlap from keyword_only alone.
- Prefer "insufficient evidence" over speculation.
- Psychological conclusions must be labeled hypothesis and include gaps/counterevidence when possible.
- Do not invent ids.`,
      user: `Mode: ${mode}\nQuestion: ${trimmed}\n\nEvidence:\n${evidenceBlock}\n\nConnection candidates:\n${candidateBlock || "(none)"}`.slice(
        0,
        24000,
      ),
      model: analystModel(),
    });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : [];
    const claims: MirrorClaim[] = validateClaims(
      rawClaims.map((c) => {
        const row = c as Record<string, unknown>;
        const claimType =
          row.claimType === "fact" ||
          row.claimType === "observation" ||
          row.claimType === "hypothesis"
            ? row.claimType
            : "observation";
        return {
          text: typeof row.text === "string" ? row.text : "",
          claimType,
          confidence: typeof row.confidence === "number" ? row.confidence : 0.5,
          evidenceRefs: asStringArray(row.evidenceRefs),
        };
      }),
      allowedIds,
    );

    return {
      answer:
        typeof parsed.answer === "string"
          ? parsed.answer
          : "Unable to synthesize answer.",
      claims,
      contradictions: asStringArray(parsed.contradictions),
      coverage: typeof parsed.coverage === "string" ? parsed.coverage : "unknown",
      gaps: asStringArray(parsed.gaps),
      followUpQuestions: asStringArray(parsed.followUpQuestions),
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      mode,
      evidence,
      candidates: candidateSummary,
      engine: "llm",
    };
  } catch (err) {
    console.warn(
      "[ask_mirror] LLM failed:",
      err instanceof Error ? err.message : err,
    );
    const stub = stubAnswer(trimmed, evidence, candidateSummary);
    stub.mode = mode;
    stub.gaps.push("LLM synthesis failed; returned stub.");
    return stub;
  }
}

/** @internal exported for tests */
export function _validateClaimsForTest(
  claims: MirrorClaim[],
  allowed: string[],
): MirrorClaim[] {
  return validateClaims(claims, new Set(allowed));
}

export type { DistillateRow, MemorySearchHit, RecordHit };
