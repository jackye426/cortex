import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { askMirror } from "./analyst.js";
import { logMcpAudit } from "./audit.js";
import {
  capabilityPublicView,
  mintCapability,
  retrieveSupportingEvidence,
} from "./evidence-broker.js";
import {
  embedTexts,
  embeddingModel,
  openaiConfigured,
} from "./llm.js";
import {
  type McpToolProfile,
  playbookForProfile,
} from "./mcp-profile.js";
import {
  getLatestPortrait,
  listPortraitVersions,
  refreshPortrait,
} from "./portrait.js";
import {
  getAllocatorContext,
  runPriorityVsActual,
  seedEntitiesFromDistillates,
} from "./project-brief.js";
import type { CortexStore } from "./store/index.js";
import { extractObservations } from "./intrapersonal/extract-observations.js";
import { auditSourceCoverage } from "./intrapersonal/source-health.js";
import { extractAffectProxies, logReflection } from "./intrapersonal/affect.js";
import { mineInterests } from "./intrapersonal/interest-mine.js";
import {
  getLatestInterestMap,
  refreshInterestMap,
} from "./intrapersonal/interest-map.js";
import {
  confirmHypothesis,
  getHypothesis,
  listHypotheses,
  promoteMirrorClaims,
  proposeHypothesis,
  refineHypothesis,
  rejectHypothesis,
} from "./intrapersonal/hypotheses.js";
import { compileAbilityModel } from "./intrapersonal/ability-model.js";
import {
  compileSelfModelVersion,
  getLatestSelfModel,
} from "./intrapersonal/self-model-v2.js";
import {
  completeExperiment,
  listExperiments,
  proposeExperiment,
  requestExperimentResults,
} from "./intrapersonal/experiments.js";
import { captureDecision, captureOutcome } from "./intrapersonal/decisions.js";
import { getCalibrationStats } from "./intrapersonal/calibration.js";
import { detectCycles } from "./intrapersonal/cycles.js";
import {
  compileSelfModelDiff,
  howHaveIChanged,
} from "./intrapersonal/change-explain.js";
import {
  getLatestWeeklyMirror,
  refreshWeeklyMirror,
} from "./intrapersonal/weekly-mirror.js";
import {
  listOpenQuestions,
  snapshotOpenQuestions,
} from "./intrapersonal/open-questions.js";
import { computeIntrapersonalMetrics } from "./intrapersonal/metrics.js";
import type {
  ExperimentResultPolarity,
  HypothesisState,
  InterestClass,
  InterestStatus,
  ProvenanceClaim,
  SourceFamily,
} from "./intrapersonal/types.js";

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/** @deprecated Use playbookForProfile("mirror" | "ops") */
export const CORTEX_RETRIEVAL_PLAYBOOK = playbookForProfile("mirror");

export interface RegisterCortexToolsOptions {
  profile?: McpToolProfile;
  /** Bearer token used for audit rows (never logged raw). */
  auditToken?: string;
  /**
   * Vault credential store for broker raw reads + compilers that need sessions.
   * Defaults to the primary `store` (Ops / fixture).
   */
  vaultStore?: CortexStore;
}

/** Register Cortex retrieval tools on a fresh McpServer instance. */
export function registerCortexTools(
  server: McpServer,
  store: CortexStore,
  options: RegisterCortexToolsOptions = {},
): void {
  const profile: McpToolProfile = options.profile ?? "mirror";
  const auditToken = options.auditToken ?? "anonymous";
  const isOps = profile === "ops";
  const playbook = playbookForProfile(profile);
  const vaultStore = options.vaultStore ?? store;

  server.registerTool(
    "cortex_help",
    {
      description:
        "Return the Cortex retrieval playbook for this endpoint (Mirror vs Ops).",
      inputSchema: {},
    },
    async () =>
      textResult({
        profile,
        playbook,
        credential: store.credential,
        evidenceRule:
          "Distillates by default. Raw evidence only via retrieve_supporting_evidence under deterministic policy + capabilities.",
        firstMove: "Follow the playbook above; start with list_recent_work or search_memory for ordinary questions.",
      }),
  );

  if (isOps) {
    server.registerTool(
      "search_records",
      {
        description:
          "OPS: Keyword search over canonical record payload text (and distillate content). Mirror agents must use search_memory + evidence broker instead.",
        inputSchema: {
          query: z
            .string()
            .describe(
              "Search query (matched against payload text, ids, types, distillates)",
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Max results (default 20)"),
          recordTypes: z
            .array(z.string())
            .optional()
            .describe(
              "Only these record_type values (e.g. email_message, github_pr)",
            ),
          sources: z
            .array(z.string())
            .optional()
            .describe("Only these source_id values (e.g. gmail, github)"),
          excludeTypes: z
            .array(z.string())
            .optional()
            .describe(
              "Exclude record types (calendar_event excluded by default)",
            ),
          since: z.string().optional().describe("ISO lower bound on occurred_at"),
          until: z.string().optional().describe("ISO upper bound on occurred_at"),
          includeCalendar: z
            .boolean()
            .optional()
            .describe("If true, do not default-exclude calendar_event"),
        },
      },
      async ({
        query,
        limit,
        recordTypes,
        sources,
        excludeTypes,
        since,
        until,
        includeCalendar,
      }) => {
        const result = await store.searchRecords(query, {
          limit: limit ?? 20,
          recordTypes,
          sources,
          excludeTypes,
          since,
          until,
          excludeCalendarDefault: !includeCalendar,
        });
        return textResult({
          mode: store.mode,
          count: result.hits.length,
          distillateCount: result.distillates.length,
          results: result.hits,
          distillates: result.distillates,
          hint: result.hint,
        });
      },
    );
  }

  server.registerTool(
    "search_memory",
    {
      description:
        "Hybrid memory search over distillates (keyword + vector when embeddings exist). Supports mode=operational|reflective|both. Prefer this over raw vault tools. For raw excerpts use retrieve_supporting_evidence.",
      inputSchema: {
        query: z.string().describe("Natural-language or keyword query"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max hits (default 15)"),
        kinds: z
          .array(z.string())
          .optional()
          .describe(
            "Distillate kinds (summary, youtube_interest_digest, project_brief, portrait, …)",
          ),
        mode: z
          .enum(["operational", "reflective", "both"])
          .optional()
          .describe("Retrieval lens (default both)"),
        domains: z.array(z.string()).optional(),
        topics: z.array(z.string()).optional(),
        sourceTypes: z.array(z.string()).optional(),
        minConfidence: z.number().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
      },
    },
    async ({
      query,
      limit,
      kinds,
      mode,
      domains,
      topics,
      sourceTypes,
      minConfidence,
      since,
      until,
    }) => {
      const result = await store.searchMemory(query, {
        limit: limit ?? 15,
        kinds,
        mode,
        domains,
        topics,
        sourceTypes,
        minConfidence,
        since,
        until,
      });
      return textResult({
        mode: store.mode,
        count: result.hits.length,
        hits: result.hits,
        hint: result.hint,
      });
    },
  );

  if (isOps) {
    server.registerTool(
      "get_session",
      {
        description:
          "OPS: Deep-dive an AI session (full messages). Mirror must use retrieve_supporting_evidence with source_types=['session'] instead.",
        inputSchema: {
          sessionId: z.string().describe("Session UUID or source session id"),
        },
      },
      async ({ sessionId }) => {
        const session = await store.getSession(sessionId);
        if (!session) {
          return textResult({ mode: store.mode, found: false, sessionId });
        }
        return textResult({ mode: store.mode, found: true, session });
      },
    );
  }

  server.registerTool(
    "list_recent_work",
    {
      description:
        "List recent work-biased activity. Mirror: prefer sessions + github/email signals for orientation; deep session text is broker-only. Schedule → get_calendar_range.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max items (default 20)"),
        kinds: z
          .array(z.enum(["session", "record"]))
          .optional()
          .describe("Restrict to session and/or record kinds"),
        recordTypes: z
          .array(z.string())
          .optional()
          .describe("When including records, only these types"),
        excludeTypes: z
          .array(z.string())
          .optional()
          .describe(
            "Record types to drop (default calendar_event in work mode)",
          ),
        horizonDays: z
          .number()
          .int()
          .min(0)
          .max(3650)
          .nullable()
          .optional()
          .describe(
            "Drop items after now+N days (default 7; null = no horizon)",
          ),
        workMode: z
          .boolean()
          .optional()
          .describe(
            "Prefer github/email records (default true when kinds omitted)",
          ),
      },
    },
    async ({
      limit,
      kinds,
      recordTypes,
      excludeTypes,
      horizonDays,
      workMode,
    }) => {
      const items = await store.listRecentWork({
        limit: limit ?? 20,
        kinds,
        recordTypes,
        excludeTypes,
        horizonDays: horizonDays === undefined ? undefined : horizonDays,
        workMode,
      });
      return textResult({
        mode: store.mode,
        profile,
        count: items.length,
        items,
        note: isOps
          ? undefined
          : "Session message bodies are broker-only on Mirror.",
      });
    },
  );

  if (isOps) {
    server.registerTool(
      "get_email_thread",
      {
        description:
          "OPS: Load a full Gmail thread. Mirror must use the evidence broker.",
        inputSchema: {
          threadId: z.string().describe("Gmail thread id"),
        },
      },
      async ({ threadId }) => {
        const thread = await store.getEmailThread(threadId);
        if (!thread) {
          return textResult({ mode: store.mode, found: false, threadId });
        }
        return textResult({ mode: store.mode, found: true, thread });
      },
    );
  }

  server.registerTool(
    "get_calendar_range",
    {
      description: isOps
        ? "OPS: Calendar events in range (may include location)."
        : "Sanitised calendar structure (summary/start/end/attendee_count). Descriptions and attachments require retrieve_supporting_evidence.",
      inputSchema: {
        start: z.string().describe("Range start (ISO-8601)"),
        end: z.string().describe("Range end (ISO-8601)"),
      },
    },
    async ({ start, end }) => {
      if (isOps) {
        const events = await store.getCalendarRange(start, end);
        return textResult({
          mode: store.mode,
          credential: store.credential,
          count: events.length,
          start,
          end,
          events,
        });
      }
      const events = await store.getCalendarStructure(start, end);
      return textResult({
        mode: store.mode,
        credential: store.credential,
        profile: "mirror",
        sanitised: true,
        count: events.length,
        start,
        end,
        events,
        note: "Descriptions/attachments via retrieve_supporting_evidence (calendar + description_excerpt / attachment_name).",
      });
    },
  );

  if (isOps) {
    server.registerTool(
      "get_file_summary",
      {
        description:
          "OPS: Drive file summary by id. Mirror uses broker for text_preview.",
        inputSchema: {
          fileId: z.string().describe("Record UUID or source_record_id"),
        },
      },
      async ({ fileId }) => {
        const file = await store.getFileSummary(fileId);
        if (!file) {
          return textResult({ mode: store.mode, found: false, fileId });
        }
        return textResult({ mode: store.mode, found: true, file });
      },
    );

    server.registerTool(
      "get_ebook",
      {
        description:
          "OPS: Look up a Calibre ebook by record UUID or source_record_id.",
        inputSchema: {
          ebookId: z.string().describe("Record UUID or Calibre uuid"),
        },
      },
      async ({ ebookId }) => {
        const hits = await store.listRecordsByType("ebook", 200);
        const hit =
          hits.find(
            (h) => h.id === ebookId || h.sourceRecordId === ebookId,
          ) ?? null;
        if (!hit) {
          return textResult({ mode: store.mode, found: false, ebookId });
        }
        return textResult({ mode: store.mode, found: true, ebook: hit });
      },
    );

    server.registerTool(
      "list_bookmarks",
      {
        description: "OPS: List recent browser bookmark records.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async ({ limit }) => {
        const results = await store.listRecordsByType("bookmark", limit ?? 20);
        return textResult({
          mode: store.mode,
          count: results.length,
          results,
        });
      },
    );

    server.registerTool(
      "recent_plays",
      {
        description: "OPS: List recent Spotify play/track/episode records.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async ({ limit }) => {
        const capped = limit ?? 20;
        const [plays, tracks, episodes] = await Promise.all([
          store.listRecordsByType("spotify_play", capped),
          store.listRecordsByType("spotify_track", capped),
          store.listRecordsByType("spotify_episode", capped),
        ]);
        const results = [...plays, ...tracks, ...episodes]
          .sort((a, b) =>
            (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""),
          )
          .slice(0, capped);
        return textResult({
          mode: store.mode,
          count: results.length,
          results,
        });
      },
    );

    server.registerTool(
      "recent_watches",
      {
        description: "OPS: List recent YouTube watch/video records.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async ({ limit }) => {
        const capped = limit ?? 20;
        const [watches, videos] = await Promise.all([
          store.listRecordsByType("youtube_watch", capped),
          store.listRecordsByType("youtube_video", capped),
        ]);
        const results = [...watches, ...videos]
          .sort((a, b) =>
            (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""),
          )
          .slice(0, capped);
        return textResult({
          mode: store.mode,
          count: results.length,
          results,
        });
      },
    );
  }

  server.registerTool(
    "list_entities",
    {
      description:
        "List project/ambition entities in the twin graph (entity_type e.g. project, ambition, priority). WHEN TO USE: map stated goals vs work. Twin D1.",
      inputSchema: {
        entityType: z
          .string()
          .optional()
          .describe("Filter by entity_type (project, ambition, priority, …)"),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ entityType, limit }) => {
      const entities = await store.listEntities(entityType, limit ?? 50);
      return textResult({
        mode: store.mode,
        count: entities.length,
        entities,
      });
    },
  );

  server.registerTool(
    "upsert_entity",
    {
      description:
        "Create or update a project/ambition/priority entity (unique on owner + entity_type + canonical_key). Twin path D1.",
      inputSchema: {
        entityType: z.string().describe("project | ambition | priority | …"),
        canonicalKey: z.string().describe("Stable slug key"),
        displayName: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      },
    },
    async ({ entityType, canonicalKey, displayName, metadata }) => {
      const entity = await store.upsertEntity({
        entityType,
        canonicalKey,
        displayName,
        metadata,
      });
      return textResult({ mode: store.mode, entity });
    },
  );

  server.registerTool(
    "seed_entities",
    {
      description:
        "Seed project entities from session distillate metadata.projects[] and link sessions (D1). WHEN TO USE: after distillate worker has written summaries with projects[].",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ limit, dryRun }) => {
      const result = await seedEntitiesFromDistillates(store, {
        limit: limit ?? 80,
        dryRun,
      });
      return textResult(result);
    },
  );

  server.registerTool(
    "link_entity",
    {
      description:
        "Link an entity to a session/record/repo (entity_links). Twin path D1 project graph.",
      inputSchema: {
        entityId: z.string(),
        linkedType: z.string().describe("session | record | repo | …"),
        linkedId: z.string().describe("UUID of linked row"),
        relation: z.string().optional().describe("Default related"),
        metadata: z.record(z.unknown()).optional(),
      },
    },
    async ({ entityId, linkedType, linkedId, relation, metadata }) => {
      const link = await store.linkEntity({
        entityId,
        linkedType,
        linkedId,
        relation,
        metadata,
      });
      return textResult({ mode: store.mode, link });
    },
  );

  server.registerTool(
    "get_entity_links",
    {
      description: "List entity_links for a project/ambition entity id.",
      inputSchema: {
        entityId: z.string(),
      },
    },
    async ({ entityId }) => {
      const links = await store.listEntityLinks(entityId);
      return textResult({
        mode: store.mode,
        count: links.length,
        links,
      });
    },
  );

  server.registerTool(
    "capture_decision",
    {
      description:
        "Capture a decision (I4): writes first-class decisions row + distillate kind=decision projection for search. For outcomes use capture_outcome (or kind=outcome for legacy).",
      inputSchema: {
        kind: z.enum(["decision", "outcome"]).optional(),
        title: z.string(),
        content: z.string().describe("What was decided or what happened"),
        expectedOutcome: z.string().optional(),
        relatedEntityKey: z
          .string()
          .optional()
          .describe("Optional project canonical_key to link"),
        relatedHypothesisIds: z.array(z.string()).optional(),
        decisionId: z
          .string()
          .optional()
          .describe("Required when kind=outcome (links actual result)"),
        alignedWithExpected: z.boolean().optional(),
        learning: z.string().optional(),
      },
    },
    async ({
      kind,
      title,
      content,
      expectedOutcome,
      relatedEntityKey,
      relatedHypothesisIds,
      decisionId,
      alignedWithExpected,
      learning,
    }) => {
      const effectiveKind = kind ?? "decision";
      if (effectiveKind === "outcome") {
        if (!decisionId) {
          // Legacy path: outcome distillate only
          const subjectId = randomUUID();
          const body = `${title}\n\n${content}`;
          let embedding: number[] | null = null;
          let embeddingRef: string | null = null;
          if (openaiConfigured()) {
            try {
              const [vec] = await embedTexts([body]);
              embedding = vec ?? null;
              embeddingRef = embedding ? `openai:${embeddingModel()}` : null;
            } catch {
              // keep capture
            }
          }
          const row = await store.upsertDistillate({
            subjectType: "note",
            subjectId,
            kind: "outcome",
            content: body,
            embeddingRef,
            embedding,
            model: "mcp-capture",
            metadata: {
              title,
              capture: true,
              relatedEntityKey: relatedEntityKey ?? null,
              extension: "D3",
            },
          });
          return textResult({ mode: store.mode, distillate: row, legacy: true });
        }
        const result = await captureOutcome(store, {
          decisionId,
          actualOutcome: content,
          alignedWithExpected,
          learning,
        });
        return textResult({ mode: store.mode, ...result });
      }
      const result = await captureDecision(store, {
        title,
        statement: content,
        expectedOutcome,
        relatedEntityKeys: relatedEntityKey ? [relatedEntityKey] : [],
        relatedHypothesisIds,
      });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "capture_outcome",
    {
      description:
        "Record actual outcome for a decision_id (I4). Updates decision_outcomes + optional outcome distillate.",
      inputSchema: {
        decisionId: z.string(),
        actualOutcome: z.string(),
        alignedWithExpected: z.boolean().optional(),
        learning: z.string().optional(),
      },
    },
    async ({ decisionId, actualOutcome, alignedWithExpected, learning }) => {
      const result = await captureOutcome(store, {
        decisionId,
        actualOutcome,
        alignedWithExpected,
        learning,
      });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "list_decisions",
    {
      description:
        "List recent decision/outcome distillates (D3). Optional kind filter.",
      inputSchema: {
        kind: z
          .enum(["decision", "outcome"])
          .optional()
          .describe("Filter to one kind; omit for both"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ kind, limit }) => {
      const kinds = kind ? [kind] : ["decision", "outcome"];
      const rows = await store.listDistillates({
        limit: limit ?? 20,
        kinds,
      });
      return textResult({
        mode: store.mode,
        count: rows.length,
        decisions: rows,
      });
    },
  );

  server.registerTool(
    "priority_vs_actual",
    {
      description:
        "Compute and persist a week priority_vs_actual distillate: session hours attributed to projects vs ambition/priority entities (D2). Heuristic; LLM optional elsewhere.",
      inputSchema: {
        dryRun: z.boolean().optional(),
        weekOf: z
          .string()
          .optional()
          .describe("ISO date inside the target week (default now)"),
      },
    },
    async ({ dryRun, weekOf }) => {
      const result = await runPriorityVsActual(vaultStore, { dryRun, weekOf });
      return textResult(result);
    },
  );

  server.registerTool(
    "refresh_self_model",
    {
      description:
        "Compile self-model v2 (hypotheses + interests + ability records → self_model_versions) and project distillate kind=self_model (I3/D4).",
      inputSchema: {
        dryRun: z.boolean().optional(),
      },
    },
    async ({ dryRun }) => {
      const compiled = await compileSelfModelVersion(store, { dryRun });
      return textResult({
        mode: store.mode,
        distillate: compiled.distillate,
        version: compiled.version,
        written: compiled.written,
      });
    },
  );

  server.registerTool(
    "allocator_context",
    {
      description:
        "Return structured 3h/3w/3y capital-allocator prompt seed over D1–D4 (projects, briefs, priority_vs_actual, decisions, self_model). Not a separate product — grounding pack only (D5).",
      inputSchema: {},
    },
    async () => {
      const ctx = await getAllocatorContext(store);
      return textResult({ mode: store.mode, ...ctx });
    },
  );

  server.registerTool(
    "request_evidence_capability",
    {
      description:
        "Mint a short-lived scoped capability for sensitive broker access. Restricted class cannot be minted here — use Ops issue_restricted_capability. Routine fields do not need a capability.",
      inputSchema: {
        purpose: z.string().describe("Why raw evidence is needed (audited)"),
        sourceTypes: z
          .array(z.string())
          .describe("email|session|calendar|drive|github|youtube|…"),
        since: z.string().describe("ISO start of allowed window"),
        until: z.string().describe("ISO end of allowed window"),
        subjectIds: z.array(z.string()).optional(),
        maxResults: z.number().int().min(1).max(10).optional(),
        permittedFields: z
          .array(z.string())
          .describe(
            "e.g. timestamp,sender,subject,body_excerpt,session_excerpt,description_excerpt,text_preview",
          ),
        ttlSeconds: z.number().int().min(30).max(900).optional(),
      },
    },
    async ({
      purpose,
      sourceTypes,
      since,
      until,
      subjectIds,
      maxResults,
      permittedFields,
      ttlSeconds,
    }) => {
      const minted = mintCapability({
        purpose,
        class: "sensitive",
        sourceTypes,
        dateRange: { since, until },
        subjectIds,
        maxResults: maxResults ?? 5,
        permittedFields,
        ttlSeconds,
        issuedBy: "mirror",
      });
      void logMcpAudit({
        token: auditToken,
        route: "request_evidence_capability",
        method: "TOOL",
        metadata: {
          surface: "request_evidence_capability",
          endpoint: profile,
          purpose,
          ok: minted.ok,
          denied: minted.ok ? null : minted.denied,
        },
      });
      if (!minted.ok) {
        return textResult({
          ok: false,
          denied: minted.denied,
          reason: minted.reason,
        });
      }
      return textResult({
        ok: true,
        capability: capabilityPublicView(minted.capability),
      });
    },
  );

  if (isOps) {
    server.registerTool(
      "issue_restricted_capability",
      {
        description:
          "OPS ONLY: Mint a restricted, short-lived capability for high-sensitivity broker access.",
        inputSchema: {
          purpose: z.string(),
          sourceTypes: z.array(z.string()),
          since: z.string(),
          until: z.string(),
          subjectIds: z.array(z.string()).optional(),
          maxResults: z.number().int().min(1).max(10).optional(),
          permittedFields: z.array(z.string()),
          ttlSeconds: z.number().int().min(30).max(600).optional(),
        },
      },
      async ({
        purpose,
        sourceTypes,
        since,
        until,
        subjectIds,
        maxResults,
        permittedFields,
        ttlSeconds,
      }) => {
        const minted = mintCapability({
          purpose,
          class: "restricted",
          sourceTypes,
          dateRange: { since, until },
          subjectIds,
          maxResults: maxResults ?? 3,
          permittedFields,
          ttlSeconds,
          issuedBy: "ops",
        });
        void logMcpAudit({
          token: auditToken,
          route: "issue_restricted_capability",
          method: "TOOL",
          metadata: {
            surface: "issue_restricted_capability",
            endpoint: "ops",
            purpose,
            ok: minted.ok,
            denied: minted.ok ? null : minted.denied,
          },
        });
        if (!minted.ok) {
          return textResult({
            ok: false,
            denied: minted.denied,
            reason: minted.reason,
          });
        }
        return textResult({
          ok: true,
          capability: capabilityPublicView(minted.capability),
        });
      },
    );
  }

  server.registerTool(
    "retrieve_supporting_evidence",
    {
      description:
        "Policy-gated raw evidence broker. Returns redacted excerpts only (ephemeral). Sensitive fields require a capability; restricted requires ops-issued capability. Deterministic policy decides access.",
      inputSchema: {
        purpose: z.string(),
        sourceTypes: z.array(z.string()),
        since: z.string().optional(),
        until: z.string().optional(),
        subjectIds: z.array(z.string()).optional(),
        maxResults: z.number().int().min(1).max(10).optional(),
        permittedFields: z.array(z.string()).optional(),
        capabilityId: z.string().optional(),
      },
    },
    async ({
      purpose,
      sourceTypes,
      since,
      until,
      subjectIds,
      maxResults,
      permittedFields,
      capabilityId,
    }) => {
      const result = await retrieveSupportingEvidence(
        store,
        profile,
        {
          purpose,
          sourceTypes,
          dateRange:
            since && until ? { since, until } : undefined,
          subjectIds,
          maxResults,
          permittedFields,
          capabilityId,
        },
        auditToken,
        vaultStore,
      );
      return textResult(result);
    },
  );

  server.registerTool(
    "ask_mirror",
    {
      description:
        "Citation-required query-time Analyst over distillates + connection candidates. Ephemeral. Does not silently load raw vault rows — use retrieve_supporting_evidence when needed, then re-ask. Hypotheses ≠ facts. Reflective/both modes use source-balanced retrieval; assistant-only support is down-ranked.",
      inputSchema: {
        query: z.string(),
        mode: z.enum(["operational", "reflective", "both"]).optional(),
        limit: z.number().int().min(1).max(40).optional(),
        balanceBySource: z
          .boolean()
          .optional()
          .describe(
            "Override source balancing (default true for reflective/both)",
          ),
      },
    },
    async ({ query, mode, limit, balanceBySource }) => {
      const result = await askMirror(store, {
        query,
        mode,
        limit,
        balanceBySource,
        auditToken,
        endpoint: profile,
      });
      return textResult({ ...result, vaultMode: store.mode, profile });
    },
  );

  server.registerTool(
    "audit_source_coverage",
    {
      description:
        "Evidence-integrity audit: per-source ingest/distill/embed coverage, reflective vs operational share, and AI drowning risk (I1).",
      inputSchema: {},
    },
    async () => {
      const report = await auditSourceCoverage(store);
      void logMcpAudit({
        token: auditToken,
        route: "audit_source_coverage",
        method: "TOOL",
        metadata: {
          surface: "audit_source_coverage",
          endpoint: profile,
          retention: "ephemeral",
          ai_share: report.aiSessionShareOfRecentDistillates,
        },
      });
      return textResult({ mode: store.mode, ...report });
    },
  );

  server.registerTool(
    "list_observations",
    {
      description:
        "List durable factual observations / self-reports extracted for intrapersonal evidence (I1). Not interpretations.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        sourceFamily: z
          .enum([
            "ai_sessions",
            "calendar",
            "email",
            "github",
            "drive",
            "media_youtube",
            "media_spotify",
            "browser",
            "reading",
            "decisions",
            "reflections",
            "people_feedback",
            "other",
          ])
          .optional(),
        since: z.string().optional(),
        until: z.string().optional(),
      },
    },
    async ({ limit, sourceFamily, since, until }) => {
      const rows = await store.listObservations({
        limit,
        sourceFamily: sourceFamily as SourceFamily | undefined,
        since,
        until,
      });
      return textResult({
        mode: store.mode,
        count: rows.length,
        observations: rows,
      });
    },
  );

  server.registerTool(
    "extract_observations",
    {
      description:
        "Extract factual observations from recent distillates into the observations table (I1 nightly job). dryRun previews without writing.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ limit, dryRun }) => {
      const result = await extractObservations(store, { limit, dryRun });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "list_interests",
    {
      description:
        "List first-class interest entities with terminal/instrumental/aspirational/situational/dormant classification (I2).",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        class: z
          .enum([
            "terminal",
            "instrumental",
            "aspirational",
            "situational",
            "dormant",
          ])
          .optional(),
        status: z.enum(["active", "dormant", "retired"]).optional(),
      },
    },
    async ({ limit, class: interestClass, status }) => {
      const rows = await store.listInterests({
        limit,
        class: interestClass as InterestClass | undefined,
        status: status as InterestStatus | undefined,
      });
      return textResult({ mode: store.mode, count: rows.length, interests: rows });
    },
  );

  server.registerTool(
    "upsert_interest",
    {
      description:
        "Manually create or refine an interest entity (class, status, summary).",
      inputSchema: {
        canonicalKey: z.string(),
        displayName: z.string().optional(),
        class: z.enum([
          "terminal",
          "instrumental",
          "aspirational",
          "situational",
          "dormant",
        ]),
        status: z.enum(["active", "dormant", "retired"]).optional(),
        summary: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
      },
    },
    async ({ canonicalKey, displayName, class: interestClass, status, summary, confidence }) => {
      const row = await store.upsertInterest({
        canonicalKey,
        displayName,
        class: interestClass,
        status,
        summary,
        confidence,
        metadata: { source: "user", refined: true },
      });
      return textResult({ mode: store.mode, interest: row });
    },
  );

  server.registerTool(
    "get_interest_map",
    {
      description:
        "Return the latest Interest Map (grouped terminal/instrumental/aspirational/situational/dormant) with evidence summaries (I2).",
      inputSchema: {},
    },
    async () => {
      const result = await getLatestInterestMap(store);
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "refresh_interest_map",
    {
      description:
        "Mine interest candidates from digests/sessions and compile a versioned interest_map distillate (I2 weekly job).",
      inputSchema: {
        dryRun: z.boolean().optional(),
        weekKey: z.string().optional(),
        skipMine: z.boolean().optional(),
      },
    },
    async ({ dryRun, weekKey, skipMine }) => {
      const result = await refreshInterestMap(store, {
        dryRun,
        weekKey,
        skipMine,
      });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "mine_interests",
    {
      description:
        "Mine and classify interest entities from interest digests + session topics without compiling the map.",
      inputSchema: {
        limit: z.number().int().min(1).max(300).optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ limit, dryRun }) => {
      const result = await mineInterests(store, { limit, dryRun });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "log_reflection",
    {
      description:
        "Capture a direct reflection / energy-valence self-report as observation + affect signals (I2).",
      inputSchema: {
        text: z.string(),
        energy: z.number().min(-1).max(1).optional(),
        valence: z.number().min(-1).max(1).optional(),
        interestKey: z.string().optional(),
        occurredAt: z.string().optional(),
      },
    },
    async ({ text, energy, valence, interestKey, occurredAt }) => {
      const result = await logReflection(store, {
        text,
        energy,
        valence,
        interestKey,
        occurredAt,
      });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "extract_affect_proxies",
    {
      description:
        "Infer energy/friction/flow affect signals from session distillate metadata (I2).",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ limit, dryRun }) => {
      const result = await extractAffectProxies(store, { limit, dryRun });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "list_hypotheses",
    {
      description:
        "List durable intrapersonal hypotheses (state/domain/minConfidence filters) (I3).",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        state: z
          .enum(["emerging", "supported", "disputed", "retired"])
          .optional(),
        domain: z.string().optional(),
        minConfidence: z.number().min(0).max(1).optional(),
      },
    },
    async ({ limit, state, domain, minConfidence }) => {
      const rows = await listHypotheses(store, {
        limit,
        state: state as HypothesisState | undefined,
        domain,
        minConfidence,
      });
      return textResult({ mode: store.mode, count: rows.length, hypotheses: rows });
    },
  );

  server.registerTool(
    "get_hypothesis",
    {
      description: "Get one hypothesis by id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const row = await getHypothesis(store, id);
      return textResult({ mode: store.mode, hypothesis: row });
    },
  );

  server.registerTool(
    "propose_hypothesis",
    {
      description:
        "Add a testable hypothesis to the ledger (requires rival explanation; generates one if omitted).",
      inputSchema: {
        claim: z.string(),
        whyItMatters: z.string().optional(),
        domains: z.array(z.string()).optional(),
        alternativeExplanations: z.array(z.string()).optional(),
        falsifiers: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
      },
    },
    async ({
      claim,
      whyItMatters,
      domains,
      alternativeExplanations,
      falsifiers,
      confidence,
    }) => {
      const row = await proposeHypothesis(store, {
        claim,
        whyItMatters,
        domains,
        alternativeExplanations,
        falsifiers,
        confidence,
        origin: "user",
      });
      return textResult({ mode: store.mode, hypothesis: row });
    },
  );

  server.registerTool(
    "promote_mirror_claims",
    {
      description:
        "Promote ask_mirror hypothesis claims into the durable ledger at low confidence (origin=ask_mirror).",
      inputSchema: {
        claims: z.array(
          z.object({
            text: z.string(),
            claimType: z.string(),
            confidence: z.number(),
            evidenceRefs: z.array(z.string()).optional(),
            alternativeExplanations: z.array(z.string()).optional(),
            provisional: z.boolean().optional(),
          }),
        ),
        whyItMatters: z.string().optional(),
        domains: z.array(z.string()).optional(),
      },
    },
    async ({ claims, whyItMatters, domains }) => {
      const rows = await promoteMirrorClaims(store, {
        claims: claims as ProvenanceClaim[],
        whyItMatters,
        domains,
      });
      return textResult({ mode: store.mode, count: rows.length, hypotheses: rows });
    },
  );

  server.registerTool(
    "confirm_hypothesis",
    {
      description: "User confirms a hypothesis — raises confidence / may mark supported; records VIR verdict.",
      inputSchema: {
        id: z.string(),
        note: z.string().optional(),
        useful: z.boolean().optional(),
        nonObvious: z.boolean().optional(),
      },
    },
    async ({ id, note, useful, nonObvious }) => {
      const row = await confirmHypothesis(store, id, note, { useful, nonObvious });
      return textResult({ mode: store.mode, hypothesis: row });
    },
  );

  server.registerTool(
    "reject_hypothesis",
    {
      description:
        "User rejects a hypothesis — marks disputed/retired so next self-model omits it.",
      inputSchema: {
        id: z.string(),
        note: z.string().optional(),
        retire: z.boolean().optional(),
      },
    },
    async ({ id, note, retire }) => {
      const row = await rejectHypothesis(store, id, note, { retire });
      return textResult({ mode: store.mode, hypothesis: row });
    },
  );

  server.registerTool(
    "refine_hypothesis",
    {
      description: "Refine a hypothesis claim — retires prior and creates linked child.",
      inputSchema: {
        id: z.string(),
        claim: z.string().optional(),
        whyItMatters: z.string().optional(),
        note: z.string().optional(),
        domains: z.array(z.string()).optional(),
      },
    },
    async ({ id, claim, whyItMatters, note, domains }) => {
      const row = await refineHypothesis(store, id, {
        claim,
        whyItMatters,
        note,
        domains,
      });
      return textResult({ mode: store.mode, hypothesis: row });
    },
  );

  server.registerTool(
    "list_intrapersonal_records",
    {
      description: "List typed self-model atoms (strengths, limitations, motives, …).",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        recordKind: z.string().optional(),
        status: z.enum(["active", "disputed", "retired"]).optional(),
      },
    },
    async ({ limit, recordKind, status }) => {
      const rows = await store.listIntrapersonalRecords({
        limit,
        recordKind,
        status,
      });
      return textResult({ mode: store.mode, count: rows.length, records: rows });
    },
  );

  server.registerTool(
    "compile_ability_model",
    {
      description:
        "Heuristic compile of strength/limitation intrapersonal_records from github outcomes + friction (I3).",
      inputSchema: {
        dryRun: z.boolean().optional(),
      },
    },
    async ({ dryRun }) => {
      const result = await compileAbilityModel(store, { dryRun });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "get_self_model",
    {
      description: "Latest structured self_model_versions row + search distillate projection.",
      inputSchema: {},
    },
    async () => {
      const result = await getLatestSelfModel(store);
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "list_self_model_versions",
    {
      description: "List self_model_versions history (newest first).",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ limit }) => {
      const versions = await store.listSelfModelVersions({ limit });
      return textResult({
        mode: store.mode,
        count: versions.length,
        versions,
      });
    },
  );

  server.registerTool(
    "propose_experiment",
    {
      description: "Attach a behavioural test protocol to a hypothesis (I4).",
      inputSchema: {
        hypothesisId: z.string(),
        title: z.string().optional(),
        protocol: z.string().optional(),
        dueAt: z.string().optional(),
      },
    },
    async ({ hypothesisId, title, protocol, dueAt }) => {
      const row = await proposeExperiment(store, {
        hypothesisId,
        title,
        protocol,
        dueAt,
      });
      return textResult({ mode: store.mode, experiment: row });
    },
  );

  server.registerTool(
    "list_experiments",
    {
      description: "List experiments filtered by status / hypothesis.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        status: z
          .enum(["proposed", "active", "completed", "abandoned"])
          .optional(),
        hypothesisId: z.string().optional(),
      },
    },
    async ({ limit, status, hypothesisId }) => {
      const rows = await listExperiments(store, { limit, status, hypothesisId });
      return textResult({ mode: store.mode, count: rows.length, experiments: rows });
    },
  );

  server.registerTool(
    "complete_experiment",
    {
      description:
        "Record experiment result; updates hypothesis state/confidence + prediction event (I4).",
      inputSchema: {
        experimentId: z.string(),
        resultSummary: z.string(),
        resultPolarity: z.enum(["supports", "contradicts", "inconclusive"]),
      },
    },
    async ({ experimentId, resultSummary, resultPolarity }) => {
      const result = await completeExperiment(store, {
        experimentId,
        resultSummary,
        resultPolarity: resultPolarity as ExperimentResultPolarity,
      });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "request_experiment_results",
    {
      description: "List active/proposed experiments past due_at (follow-up prompts).",
      inputSchema: {},
    },
    async () => {
      const rows = await requestExperimentResults(store);
      return textResult({ mode: store.mode, count: rows.length, experiments: rows });
    },
  );

  server.registerTool(
    "get_calibration_stats",
    {
      description: "Prediction accuracy by domain from prediction_events (I4).",
      inputSchema: {
        since: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ since, limit }) => {
      const stats = await getCalibrationStats(store, { since, limit });
      return textResult({ mode: store.mode, ...stats });
    },
  );

  server.registerTool(
    "detect_cycles",
    {
      description:
        "Heuristic cycle detector for avoidance / decision oscillation patterns (I4).",
      inputSchema: {
        dryRun: z.boolean().optional(),
      },
    },
    async ({ dryRun }) => {
      const result = await detectCycles(store, { dryRun });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "diff_self_model",
    {
      description: "Structural diff between self-model versions (emerging/fading/stable) (I5).",
      inputSchema: {
        toVersionId: z.string().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ toVersionId, dryRun }) => {
      const diff = await compileSelfModelDiff(store, { toVersionId, dryRun });
      return textResult({ mode: store.mode, diff });
    },
  );

  server.registerTool(
    "how_have_i_changed",
    {
      description:
        "Cited longitudinal answer from self_model_diffs (+ optional change_report distillate) (I5).",
      inputSchema: {
        sinceVersion: z.number().int().optional(),
        writeReport: z.boolean().optional(),
      },
    },
    async ({ sinceVersion, writeReport }) => {
      const result = await howHaveIChanged(store, { sinceVersion, writeReport });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "list_prediction_results",
    {
      description: "List recent prediction_events (confirmed/disproved).",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        claimId: z.string().optional(),
      },
    },
    async ({ limit, claimId }) => {
      const rows = await store.listPredictionEvents({ limit, claimId });
      return textResult({ mode: store.mode, count: rows.length, predictions: rows });
    },
  );

  server.registerTool(
    "get_weekly_mirror",
    {
      description:
        "Return Weekly Mirror (≤5 insight cards: energy, attention, avoidance, decisions, emerging interests) (I6).",
      inputSchema: {},
    },
    async () => {
      const result = await getLatestWeeklyMirror(store);
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "refresh_weekly_mirror",
    {
      description: "Compile and persist weekly_mirror distillate for the ISO week.",
      inputSchema: {
        dryRun: z.boolean().optional(),
        weekKey: z.string().optional(),
      },
    },
    async ({ dryRun, weekKey }) => {
      const result = await refreshWeeklyMirror(store, { dryRun, weekKey });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "list_open_questions",
    {
      description:
        "Rank unresolved hypotheses + due experiments by value × uncertainty × testability (I6).",
      inputSchema: {
        limit: z.number().int().min(1).max(30).optional(),
      },
    },
    async ({ limit }) => {
      const payload = await listOpenQuestions(store, { limit });
      return textResult({ mode: store.mode, ...payload });
    },
  );

  server.registerTool(
    "snapshot_open_questions",
    {
      description: "Persist open_questions_snapshot distillate for the week.",
      inputSchema: {
        dryRun: z.boolean().optional(),
      },
    },
    async ({ dryRun }) => {
      const result = await snapshotOpenQuestions(store, { dryRun });
      return textResult({ mode: store.mode, ...result });
    },
  );

  server.registerTool(
    "confirm_insight",
    {
      description: "Thin wrapper — confirm hypothesis/insight for VIR instrumentation.",
      inputSchema: {
        insightId: z.string(),
        note: z.string().optional(),
        useful: z.boolean().optional(),
        nonObvious: z.boolean().optional(),
      },
    },
    async ({ insightId, note, useful, nonObvious }) => {
      const row = await confirmHypothesis(store, insightId, note, {
        useful,
        nonObvious,
      });
      return textResult({ mode: store.mode, hypothesis: row });
    },
  );

  server.registerTool(
    "reject_insight",
    {
      description: "Thin wrapper — reject hypothesis/insight for VIR instrumentation.",
      inputSchema: {
        insightId: z.string(),
        note: z.string().optional(),
        retire: z.boolean().optional(),
      },
    },
    async ({ insightId, note, retire }) => {
      const row = await rejectHypothesis(store, insightId, note, { retire });
      return textResult({ mode: store.mode, hypothesis: row });
    },
  );

  server.registerTool(
    "refine_insight",
    {
      description: "Thin wrapper — refine hypothesis/insight claim text.",
      inputSchema: {
        insightId: z.string(),
        claim: z.string().optional(),
        note: z.string().optional(),
      },
    },
    async ({ insightId, claim, note }) => {
      const row = await refineHypothesis(store, insightId, { claim, note });
      return textResult({ mode: store.mode, hypothesis: row });
    },
  );

  server.registerTool(
    "intrapersonal_metrics",
    {
      description:
        "Validated Insight Rate + provenance / contradiction / outcome supporting metrics (I6).",
      inputSchema: {
        windowDays: z.number().int().min(1).max(365).optional(),
      },
    },
    async ({ windowDays }) => {
      const metrics = await computeIntrapersonalMetrics(store, { windowDays });
      return textResult({ mode: store.mode, ...metrics });
    },
  );

  server.registerTool(
    "get_portrait",
    {
      description:
        "Return the latest versioned portrait (reflective_sensitive). Use deliberately; stronger protection than ordinary distillates.",
      inputSchema: {},
    },
    async () => {
      const portrait = await getLatestPortrait(store);
      void logMcpAudit({
        token: auditToken,
        route: "get_portrait",
        method: "TOOL",
        metadata: {
          surface: "portrait",
          endpoint: profile,
          sensitivity: "reflective_sensitive",
          portraitId: portrait?.id ?? null,
        },
      });
      return textResult({
        mode: store.mode,
        sensitivity: "reflective_sensitive",
        portrait,
      });
    },
  );

  server.registerTool(
    "list_portrait_versions",
    {
      description: "List recent versioned portrait distillates (newest first).",
      inputSchema: {
        limit: z.number().int().min(1).max(30).optional(),
      },
    },
    async ({ limit }) => {
      const versions = await listPortraitVersions(store, limit ?? 10);
      return textResult({
        mode: store.mode,
        count: versions.length,
        versions,
      });
    },
  );

  server.registerTool(
    "refresh_portrait",
    {
      description:
        "Create a new versioned portrait snapshot from session + interest evidence. Does not overwrite prior versions.",
      inputSchema: {
        dryRun: z.boolean().optional(),
      },
    },
    async ({ dryRun }) => {
      const result = await refreshPortrait(store, { dryRun });
      return textResult(result);
    },
  );
}

export function createCortexMcpServer(
  store: CortexStore,
  options: RegisterCortexToolsOptions = {},
): McpServer {
  const profile = options.profile ?? "mirror";
  const server = new McpServer(
    {
      name: profile === "ops" ? "cortex-ops" : "cortex",
      version: "0.0.0",
    },
    { instructions: playbookForProfile(profile) },
  );
  registerCortexTools(server, store, options);
  return server;
}
