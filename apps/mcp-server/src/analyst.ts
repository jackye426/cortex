/**
 * Query-time Analyst (ask_mirror) — citation-required synthesis.
 * Answers are ephemeral by default (not persisted).
 * Distillates by default — no silent raw vault expansion (use evidence broker).
 */
import { logMcpAudit } from "./audit.js";
import {
  chatJsonCompletion,
  distillateModel,
  openaiConfigured,
} from "./llm.js";
import {
  rankConnectionCandidates,
  type CandidateMemory,
} from "./connection-candidates.js";
import type { McpToolProfile } from "./mcp-profile.js";
import {
  distillateMatchesLenses,
  type MemoryMode,
} from "./store/memory-lenses.js";
import type { CortexStore } from "./store/index.js";
import type { DistillateRow, MemorySearchHit } from "./store/types.js";
import {
  balanceMemoryHits,
  familyHistogram,
} from "./intrapersonal/balanced-retrieve.js";
import { enforceClaimEvidencePolicy } from "./intrapersonal/circular-evidence.js";
import type {
  AnnotatedMemoryHit,
  InsightQualityIssue,
  ProvenanceClaim,
} from "./intrapersonal/types.js";

export interface AskMirrorOptions {
  query: string;
  mode?: MemoryMode;
  limit?: number;
  dryRun?: boolean;
  auditToken?: string;
  endpoint?: McpToolProfile;
  /** Source-balanced retrieval (default true for reflective/both). */
  balanceBySource?: boolean;
}

export interface MirrorClaim {
  text: string;
  claimType: "fact" | "observation" | "hypothesis";
  confidence: number;
  evidenceRefs: string[];
  provisional?: boolean;
  provenance?: ProvenanceClaim["provenance"];
  alternativeExplanations?: string[];
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
    sourceFamily?: string;
    independenceGroup?: string;
    supportKind?: string;
  }>;
  candidates: Array<{
    score: number;
    reasons: string[];
    a: string;
    b: string;
  }>;
  engine: "llm" | "stub";
  /** Evidence-integrity issues detected post-synthesis. */
  evidenceIssues?: InsightQualityIssue[];
  familyHistogram?: Record<string, number>;
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

function toResultEvidence(
  hits: AnnotatedMemoryHit[],
): AskMirrorResult["evidence"] {
  return hits.map((h) => ({
    id: h.id,
    kind: h.kind,
    title: h.title,
    snippet: h.snippet,
    evidenceStrength: h.evidenceStrength,
    sourceFamily: h.sourceFamily,
    independenceGroup: h.independenceGroup,
    supportKind: h.supportKind,
  }));
}

function applyEvidencePolicy(
  claims: MirrorClaim[],
  annotated: AnnotatedMemoryHit[],
): { claims: MirrorClaim[]; issues: InsightQualityIssue[] } {
  const { claims: next, issues } = enforceClaimEvidencePolicy(
    claims as ProvenanceClaim[],
    annotated,
  );
  return {
    claims: next.map((c) => ({
      text: c.text,
      claimType:
        c.claimType === "fact" ||
        c.claimType === "observation" ||
        c.claimType === "hypothesis"
          ? c.claimType
          : "observation",
      confidence: c.confidence,
      evidenceRefs: c.evidenceRefs,
      provisional: c.provisional,
      provenance: c.provenance,
      alternativeExplanations: c.alternativeExplanations,
    })),
    issues,
  };
}

function stubAnswer(
  query: string,
  annotated: AnnotatedMemoryHit[],
  candidates: AskMirrorResult["candidates"],
): AskMirrorResult {
  const evidence = toResultEvidence(annotated);
  if (annotated.length === 0) {
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
      familyHistogram: {},
      evidenceIssues: [],
    };
  }
  const refs = annotated.slice(0, 3).map((e) => e.id);
  const rawClaims: MirrorClaim[] = [
    {
      text: `Retrieved evidence related to: ${query}`,
      claimType: "observation",
      confidence: 0.55,
      evidenceRefs: refs,
    },
  ];
  const { claims, issues } = applyEvidencePolicy(rawClaims, annotated);
  return {
    answer: `Based on ${annotated.length} evidence items: ${annotated
      .slice(0, 3)
      .map((e) => e.snippet)
      .join(" | ")}`,
    claims,
    contradictions: [],
    coverage: "stub-heuristic",
    gaps: ["LLM unavailable — stub synthesis only."],
    followUpQuestions: [],
    confidence: 0.55,
    mode: "both",
    evidence,
    candidates,
    engine: "stub",
    familyHistogram: familyHistogram(annotated),
    evidenceIssues: issues,
  };
}

export async function askMirror(
  store: CortexStore,
  options: AskMirrorOptions,
): Promise<AskMirrorResult> {
  const mode = classifyMode(options.query, options.mode);
  const limit = options.limit ?? 12;
  const trimmed = options.query.trim();
  const balanceBySource =
    options.balanceBySource ?? (mode === "reflective" || mode === "both");
  const finish = (result: AskMirrorResult): AskMirrorResult => {
    if (options.auditToken) {
      void logMcpAudit({
        token: options.auditToken,
        route: "ask_mirror",
        method: "TOOL",
        metadata: {
          surface: "ask_mirror",
          endpoint: options.endpoint ?? "mirror",
          purpose: trimmed.slice(0, 240),
          model: result.engine,
          evidence_classes: [
            ...new Set(result.evidence.map((e) => e.evidenceStrength)),
          ],
          source_refs: result.evidence.map((e) => e.id).slice(0, 40),
          retention: "ephemeral",
          confidence: result.confidence,
          mode: result.mode,
          family_histogram: result.familyHistogram ?? {},
          evidence_issue_count: result.evidenceIssues?.length ?? 0,
          balance_by_source: balanceBySource,
        },
      });
    }
    return result;
  };

  const wantsEmail =
    /\b(email|gmail|inbox|thread|commitment|open loop|commitments)\b/i.test(
      trimmed,
    );
  const wantsGithub = /\b(github|pull request|\bPR\b|issue|shipped|stalled)\b/i.test(
    trimmed,
  );
  const wantsCalendar = /\b(calendar|meeting|1:1|interview)\b/i.test(trimmed);
  const wantsDrive = /\b(drive|doc|spec|brief|gdoc)\b/i.test(trimmed);
  const wantsBrowser =
    /\b(browser|search|bookmark|research theme)\b/i.test(trimmed);
  const wantsSpotify = /\b(spotify|listening|podcast|music)\b/i.test(trimmed);
  const wantsYoutube = /\b(youtube|watching)\b/i.test(trimmed);

  const memory = await store.searchMemory(trimmed, {
    limit: balanceBySource ? Math.max(limit * 3, 36) : limit,
    mode,
  });

  // Working set of MemorySearchHit before annotation/balance.
  let workingHits: MemorySearchHit[] = memory.hits.map((h) => ({ ...h }));

  // Raw vault rows are broker-only — do not silently expand email/youtube here.

  const boostKinds: string[] = [];
  if (wantsEmail) boostKinds.push("email_thread_digest");
  if (wantsGithub) boostKinds.push("github_outcome_digest");
  if (wantsCalendar) boostKinds.push("calendar_event_digest");
  if (wantsDrive) boostKinds.push("drive_file_digest");
  if (wantsBrowser) boostKinds.push("browser_interest_digest");
  if (wantsSpotify) boostKinds.push("spotify_interest_digest");
  if (wantsYoutube) boostKinds.push("youtube_interest_digest");

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
  // When the query already matched a source intent (wants*), treat as topical so
  // drive/browser/spotify/youtube digests are not dropped for missing token overlap.
  const sourceIntent =
    wantsEmail ||
    wantsGithub ||
    wantsCalendar ||
    wantsDrive ||
    wantsBrowser ||
    wantsSpotify ||
    wantsYoutube;
  if (boostKinds.length) {
    const boostedHits: MemorySearchHit[] = [];
    for (const d of boosted) {
      if (!distillateMatchesLenses(d, { mode })) continue;
      const hay = `${d.content ?? ""}\n${JSON.stringify(d.metadata)}`.toLowerCase();
      const tokens = trimmed
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4);
      const topical =
        sourceIntent ||
        tokens.length === 0 ||
        tokens.some((t) => hay.includes(t)) ||
        /email|gmail|commitment|open loop|docmap|pilot|github|calendar|meeting|drive|doc|spec|brief|browser|bookmark|spotify|youtube|watching/i.test(
          trimmed,
        );
      if (!topical) continue;
      boostedHits.push({
        kind: "distillate",
        id: d.id,
        score: 0.82,
        title: `${d.kind}:${d.subjectType}/${d.subjectId}`,
        snippet: (d.content ?? "").slice(0, 280),
        distillateKind: d.kind,
        subjectType: d.subjectType,
        subjectId: d.subjectId,
        sourceId:
          typeof d.metadata.sourceType === "string"
            ? d.metadata.sourceType
            : typeof d.metadata.sourceId === "string"
              ? d.metadata.sourceId
              : undefined,
      });
    }
    if (boostedHits.length) {
      const rest = workingHits.filter(
        (e) => !boostedHits.some((b) => b.id === e.id),
      );
      workingHits = [...boostedHits, ...rest];
    }
  }

  // Lens-filtered fallback: natural-language questions often miss keyword ILIKE
  const poolCap = balanceBySource ? Math.max(limit * 3, 36) : limit;
  if (workingHits.length < Math.min(poolCap, 6)) {
    for (const d of distillates) {
      if (workingHits.length >= poolCap) break;
      if (!distillateMatchesLenses(d, { mode })) continue;
      if (workingHits.some((e) => e.id === d.id)) continue;
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
      workingHits.push({
        kind: "distillate",
        id: d.id,
        score: 0.55,
        title: `${d.kind}:${d.subjectType}/${d.subjectId}`,
        snippet: (d.content ?? "").slice(0, 280),
        distillateKind: d.kind,
        subjectType: d.subjectType,
        subjectId: d.subjectId,
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

  // Promote connection-candidate nodes into the working hit pool
  for (const c of ranked) {
    for (const node of [c.a, c.b]) {
      if (workingHits.some((e) => e.id === node.id)) continue;
      const d = byId.get(node.id);
      workingHits.push({
        kind: "distillate",
        id: node.id,
        score: Math.max(0.5, c.score),
        title: d
          ? `${d.kind}:${d.subjectType}/${d.subjectId}`
          : `${node.kind}:${node.id}`,
        snippet: (d?.content ?? node.content).slice(0, 280),
        distillateKind: d?.kind ?? node.kind,
        subjectType: d?.subjectType,
        subjectId: d?.subjectId,
        sourceId:
          typeof d?.metadata.sourceType === "string"
            ? d.metadata.sourceType
            : undefined,
      });
    }
  }

  const annotated = balanceBySource
    ? balanceMemoryHits(workingHits, { limit, perFamily: 3 })
    : balanceMemoryHits(workingHits, {
        limit,
        perFamily: Math.max(limit, 12),
      });
  const evidence = toResultEvidence(annotated);
  const hist = familyHistogram(annotated);

  const allowedIds = new Set(annotated.map((e) => e.id));
  for (const c of ranked) {
    allowedIds.add(c.a.id);
    allowedIds.add(c.b.id);
  }

  if (!openaiConfigured() || options.dryRun) {
    const stub = stubAnswer(trimmed, annotated, candidateSummary);
    stub.mode = mode;
    return finish(stub);
  }

  if (annotated.length === 0 && ranked.length === 0) {
    return finish({
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
      familyHistogram: hist,
      evidenceIssues: [],
    });
  }

  const evidenceBlock = annotated
    .map(
      (e) =>
        `- id=${e.id} kind=${e.kind} family=${e.sourceFamily} support=${e.supportKind} strength=${e.evidenceStrength} title=${e.title}\n  ${e.snippet}`,
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
  claims: [{ text, claimType: "fact"|"observation"|"hypothesis", confidence: number, evidenceRefs: string[], alternativeExplanations?: string[] }],
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
- Do not treat portrait/self_model alone as independent proof — prefer cross-family evidence.
- High-confidence claims should cite multiple source families when available; otherwise lower confidence.
- Include alternativeExplanations for substantial interpretive claims.
- Do not invent ids.`,
      user: `Mode: ${mode}\nQuestion: ${trimmed}\n\nEvidence:\n${evidenceBlock}\n\nConnection candidates:\n${candidateBlock || "(none)"}`.slice(
        0,
        24000,
      ),
      model: analystModel(),
    });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : [];
    const validated: MirrorClaim[] = validateClaims(
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
          alternativeExplanations: asStringArray(row.alternativeExplanations),
        };
      }),
      allowedIds,
    );
    const { claims, issues } = applyEvidencePolicy(validated, annotated);

    return finish({
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
      familyHistogram: hist,
      evidenceIssues: issues,
    });
  } catch (err) {
    console.warn(
      "[ask_mirror] LLM failed:",
      err instanceof Error ? err.message : err,
    );
    const stub = stubAnswer(trimmed, annotated, candidateSummary);
    stub.mode = mode;
    stub.gaps.push("LLM synthesis failed; returned stub.");
    return finish(stub);
  }
}

/** @internal exported for tests */
export function _validateClaimsForTest(
  claims: MirrorClaim[],
  allowed: string[],
): MirrorClaim[] {
  return validateClaims(claims, new Set(allowed));
}

export type { DistillateRow, MemorySearchHit };
