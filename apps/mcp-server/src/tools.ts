import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { askMirror } from "./analyst.js";
import {
  embedTexts,
  embeddingModel,
  openaiConfigured,
} from "./llm.js";
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

export const CORTEX_RETRIEVAL_PLAYBOOK = `Cortex retrieval playbook (Personal Executive Twin memory):

1. "What am I building / working on?" → list_recent_work first (defaults: sessions + github_* + email; calendar excluded; future events beyond +7d dropped). Then search_memory or search_records for keywords. Deep-dive with get_session.
2. Schedule / meetings → get_calendar_range ONLY. Do not use list_recent_work for calendar — recurring future events dominate occurred_at sort.
3. Keyword search → search_records searches payload text + distillate content. Defaults exclude calendar_event. Empty count with a hint is real emptiness, not sparse indexing.
4. Semantic / insight questions → search_memory (distillates + hybrid vector). Use mode=operational|reflective|both lenses.
5. Cited synthesis / self-understanding → ask_mirror (ephemeral; requires evidence citations). Do not treat hypotheses as facts.
6. Email thread → get_email_thread with payload.threadId from an email_message hit.
7. Project/topic graph → list_entities / get_entity_links / seed_entities.
8. Twin: capture_decision / list_decisions; priority_vs_actual; refresh_self_model / get_portrait; allocator_context.
9. Call cortex_help anytime for this playbook.`;

/** Register Cortex retrieval tools on a fresh McpServer instance. */
export function registerCortexTools(
  server: McpServer,
  store: CortexStore,
): void {
  server.registerTool(
    "cortex_help",
    {
      description:
        "Return the Cortex retrieval playbook: which tool to use for work vs calendar vs deep evidence, and known failure modes (calendar bias, empty search hints).",
      inputSchema: {},
    },
    async () => textResult({ playbook: CORTEX_RETRIEVAL_PLAYBOOK }),
  );

  server.registerTool(
    "search_records",
    {
      description:
        "Keyword search over canonical record payload text (and distillate content). WHEN TO USE: find emails, GitHub items, drive files, or named topics by token. WHAT IT MISSES: pure semantic similarity (use search_memory); schedule (use get_calendar_range). Defaults exclude calendar_event so open work searches are not drowned by recurring events. Empty results include a hint — do not invent 'sparse indexing'.",
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

  server.registerTool(
    "search_memory",
    {
      description:
        "Hybrid memory search: distillate summaries (keyword + vector when distillates.embedding is populated) merged with canonical keyword hits. Supports mode=operational|reflective|both plus domain/topic/sourceType lenses. Prefer distillate hits; call get_session or ask_mirror for synthesis.",
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

  server.registerTool(
    "get_session",
    {
      description:
        "Deep-dive an AI session by UUID or source_session_id: messages, tool summaries, and attached distillate. WHEN TO USE: after list_recent_work / search_memory returns a session id and you need evidence. WHAT IT MISSES: cross-session synthesis (use search_memory / project briefs).",
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

  server.registerTool(
    "list_recent_work",
    {
      description:
        "List recent work-biased activity: sessions plus github_* / email (and optional record filters). WHEN TO USE: 'what did I work on lately?'. Defaults drop calendar_event and occurred_at > now()+7d so recurring future calendar does not dominate. WHAT IT MISSES: schedule — use get_calendar_range. Pass kinds=['session'] for sessions only; workMode=false to include all record types (still respects excludeTypes/horizon).",
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
        count: items.length,
        items,
      });
    },
  );

  server.registerTool(
    "get_email_thread",
    {
      description:
        "Load a Gmail thread by thread id (from email_message payload.threadId). WHEN TO USE: after search_records finds an email. WHAT IT MISSES: non-Gmail sources.",
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

  server.registerTool(
    "get_calendar_range",
    {
      description:
        "THE schedule tool: list calendar_event records between start and end (ISO-8601). WHEN TO USE: meetings, availability, 'what's on my calendar'. Do not use list_recent_work for this — future recurring events bias occurred_at desc.",
      inputSchema: {
        start: z.string().describe("Range start (ISO-8601)"),
        end: z.string().describe("Range end (ISO-8601)"),
      },
    },
    async ({ start, end }) => {
      const events = await store.getCalendarRange(start, end);
      return textResult({
        mode: store.mode,
        count: events.length,
        start,
        end,
        events,
      });
    },
  );

  server.registerTool(
    "get_file_summary",
    {
      description:
        "Get a Drive (or similar) file summary by record UUID or source_record_id. WHEN TO USE: after a drive_file hit. WHAT IT MISSES: full file body (vault stores metadata/summary).",
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
        "Look up a Calibre ebook by record UUID or source_record_id (uuid). Metadata/paths only — no ebook binaries.",
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
      description:
        "List recent browser bookmark records. Bookmarks + keyword_search_terms only — no visit firehose.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max results (default 20)"),
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
      description:
        "List recent Spotify play / track / episode records (spotify_play, spotify_track, spotify_episode).",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max results (default 20)"),
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
      description:
        "List recent YouTube watch / video records (youtube_watch, youtube_video).",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max results (default 20)"),
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
      const result = await runPriorityVsActual(store, { dryRun, weekOf });
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
    "ask_mirror",
    {
      description:
        "Citation-required query-time Analyst synthesis over lensed memories + connection candidates. Ephemeral (not persisted). Use for operational recall and reflective self-understanding. Hypotheses must not be treated as facts; insufficient evidence is a valid answer.",
      inputSchema: {
        query: z.string(),
        mode: z.enum(["operational", "reflective", "both"]).optional(),
        limit: z.number().int().min(1).max(40).optional(),
      },
    },
    async ({ query, mode, limit }) => {
      const result = await askMirror(store, { query, mode, limit });
      return textResult({ ...result, vaultMode: store.mode });
    },
  );

  server.registerTool(
    "get_portrait",
    {
      description:
        "Return the latest versioned portrait snapshot (kind=portrait), if any. Sensitive reflective content — use deliberately.",
      inputSchema: {},
    },
    async () => {
      const portrait = await getLatestPortrait(store);
      return textResult({ mode: store.mode, portrait });
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

export function createCortexMcpServer(store: CortexStore): McpServer {
  const server = new McpServer(
    {
      name: "cortex",
      version: "0.0.0",
    },
    { instructions: CORTEX_RETRIEVAL_PLAYBOOK },
  );
  registerCortexTools(server, store);
  return server;
}
