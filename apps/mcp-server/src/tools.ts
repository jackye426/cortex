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
  refreshSelfModel,
  runPriorityVsActual,
  seedEntitiesFromDistillates,
} from "./project-brief.js";
import type { CortexStore } from "./store/index.js";

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
        "Light capture of a decision or outcome as distillate kind=decision|outcome on subject_type=note (D3). Embeds when OPENAI_API_KEY is set.",
      inputSchema: {
        kind: z.enum(["decision", "outcome"]),
        title: z.string(),
        content: z.string().describe("What was decided or what happened"),
        relatedEntityKey: z
          .string()
          .optional()
          .describe("Optional project canonical_key to link"),
      },
    },
    async ({ kind, title, content, relatedEntityKey }) => {
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
          // keep capture even if embed fails
        }
      }
      const row = await store.upsertDistillate({
        subjectType: "note",
        subjectId,
        kind,
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
      if (relatedEntityKey) {
        const entity = await store.upsertEntity({
          entityType: "project",
          canonicalKey: relatedEntityKey,
          displayName: relatedEntityKey,
        });
        await store.linkEntity({
          entityId: entity.id,
          linkedType: "distillate",
          linkedId: row.id,
          relation: kind,
        });
      }
      return textResult({ mode: store.mode, distillate: row });
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
        "Refresh distillate kind=self_model from latest priority_vs_actual + decisions/outcomes + briefs (D4).",
      inputSchema: {
        dryRun: z.boolean().optional(),
      },
    },
    async ({ dryRun }) => {
      const row = await refreshSelfModel(store, { dryRun });
      return textResult({ mode: store.mode, distillate: row });
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
        "Citation-required query-time Analyst over distillates + connection candidates. Ephemeral. Does not silently load raw vault rows — use retrieve_supporting_evidence when needed, then re-ask. Hypotheses ≠ facts.",
      inputSchema: {
        query: z.string(),
        mode: z.enum(["operational", "reflective", "both"]).optional(),
        limit: z.number().int().min(1).max(40).optional(),
      },
    },
    async ({ query, mode, limit }) => {
      const result = await askMirror(store, {
        query,
        mode,
        limit,
        auditToken,
        endpoint: profile,
      });
      return textResult({ ...result, vaultMode: store.mode, profile });
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
