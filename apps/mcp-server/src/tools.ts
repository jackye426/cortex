import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
4. Semantic / insight questions → search_memory (distillates + hybrid). Prefer distillate hits; use get_session for evidence.
5. Email thread → get_email_thread with payload.threadId from an email_message hit.
6. Project graph → list_entities / get_entity_links (ambitions & projects).
7. Call cortex_help anytime for this playbook.`;

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
        query: z.string().describe("Search query (matched against payload text, ids, types, distillates)"),
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
          .describe("Only these record_type values (e.g. email_message, github_pr)"),
        sources: z
          .array(z.string())
          .optional()
          .describe("Only these source_id values (e.g. gmail, github)"),
        excludeTypes: z
          .array(z.string())
          .optional()
          .describe("Exclude record types (calendar_event excluded by default)"),
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
        "Hybrid memory search: distillate summaries (keyword + vector when embeddings exist) merged with canonical keyword hits. WHEN TO USE: insight questions ('what am I building', 'clinic pilot', 'healthcare pipeline'). Prefer distillate hits; call get_session for full evidence. WHAT IT MISSES: raw calendar schedule.",
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
          .describe("Distillate kinds to include (summary, project_brief, self_model, …)"),
        since: z.string().optional(),
        until: z.string().optional(),
      },
    },
    async ({ query, limit, kinds, since, until }) => {
      const result = await store.searchMemory(query, {
        limit: limit ?? 15,
        kinds,
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
        sessionId: z
          .string()
          .describe("Session UUID or source session id"),
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
          .describe("Record types to drop (default calendar_event in work mode)"),
        horizonDays: z
          .number()
          .int()
          .min(0)
          .max(3650)
          .nullable()
          .optional()
          .describe("Drop items after now+N days (default 7; null = no horizon)"),
        workMode: z
          .boolean()
          .optional()
          .describe("Prefer github/email records (default true when kinds omitted)"),
      },
    },
    async ({ limit, kinds, recordTypes, excludeTypes, horizonDays, workMode }) => {
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
        fileId: z
          .string()
          .describe("Record UUID or source_record_id"),
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
        "List project/ambition entities in the twin graph (entity_type e.g. project, ambition, priority). WHEN TO USE: map stated goals vs work. Extension point for D1–D2.",
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
        "Light capture of a decision or outcome as a canonical-shaped note via distillate metadata + entity stub (D3 extension). Stores kind=decision|outcome distillate on subject_type=note.",
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
      const row = await store.upsertDistillate({
        subjectType: "note",
        subjectId,
        kind,
        content: `${title}\n\n${content}`,
        embeddingRef: null,
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
