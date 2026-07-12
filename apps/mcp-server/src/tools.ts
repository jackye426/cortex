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

/** Register Cortex retrieval tools on a fresh McpServer instance. */
export function registerCortexTools(
  server: McpServer,
  store: CortexStore,
): void {
  server.registerTool(
    "search_records",
    {
      description:
        "Search Cortex canonical records by keyword (record type, source id, payload text).",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max results (default 20)"),
      },
    },
    async ({ query, limit }) => {
      const hits = await store.searchRecords(query, limit ?? 20);
      return textResult({
        mode: store.mode,
        count: hits.length,
        results: hits,
      });
    },
  );

  server.registerTool(
    "get_session",
    {
      description:
        "Fetch an AI session by UUID or source_session_id, including messages, tool summaries, and distillate if present.",
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
        "List recent sessions and records across Cortex sources (AI, email, calendar, drive, github, etc.).",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max items (default 20)"),
      },
    },
    async ({ limit }) => {
      const items = await store.listRecentWork(limit ?? 20);
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
        "Load a Gmail thread by thread id (from email_message payload.threadId).",
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
        "List calendar events with occurred_at / start between start and end (ISO-8601).",
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
        "Get a Drive (or similar) file summary by record UUID or source_record_id.",
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
        "Look up a Calibre ebook by record UUID or source_record_id (uuid).",
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
      description: "List recent browser bookmark records from Cortex.",
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
}

export function createCortexMcpServer(store: CortexStore): McpServer {
  const server = new McpServer({
    name: "cortex",
    version: "0.0.0",
  });
  registerCortexTools(server, store);
  return server;
}
