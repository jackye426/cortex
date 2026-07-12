import type {
  CalendarEventItem,
  DistillateRow,
  EmailThread,
  FileSummary,
  RecentWorkItem,
  RecordHit,
  SessionDetail,
  SessionEnvelopeInput,
} from "./types.js";

const OWNER = "00000000-0000-4000-8000-000000000001";

export const FIXTURE_SESSIONS: SessionDetail[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    sourceId: "claude-code",
    sourceSessionId: "fixture-claude-1",
    title: "Wire Cortex ingest API",
    workspace: "C:\\Users\\yulon\\Desktop\\Current Projects\\Cortex",
    startedAt: "2026-07-10T14:00:00.000Z",
    endedAt: "2026-07-10T15:30:00.000Z",
    metadata: { fixture: true },
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Add bearer auth to the ingest endpoint.",
      },
      {
        id: "m2",
        role: "assistant",
        content: "Added CORTEX_INGEST_TOKEN bearer check on POST /v1/ingest.",
      },
    ],
    toolCalls: [
      {
        id: "t1",
        toolName: "Write",
        argsSummary: "apps/api/src/index.ts",
        status: "ok",
      },
    ],
    distillate: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    sourceId: "cursor",
    sourceSessionId: "fixture-cursor-1",
    title: "MCP phase scaffolding",
    workspace: "Cortex",
    startedAt: "2026-07-11T10:00:00.000Z",
    endedAt: null,
    metadata: { fixture: true },
    messages: [
      {
        id: "m3",
        role: "user",
        content: "Implement remote MCP with search tools.",
      },
      {
        id: "m4",
        role: "assistant",
        content: "Scaffolding apps/mcp-server with streamable HTTP.",
      },
    ],
    toolCalls: [],
    distillate: null,
  },
];

export const FIXTURE_RECORDS: RecordHit[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceId: "gmail",
    sourceRecordId: "msg-100",
    recordType: "email_message",
    payload: {
      threadId: "thread-alpha",
      subject: "Q3 roadmap sync",
      from: "alex@example.com",
      to: "you@example.com",
      snippet: "Can we review the Cortex MCP milestone?",
    },
    contentHash: "hash-email-100",
    occurredAt: "2026-07-09T09:15:00.000Z",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sourceId: "gmail",
    sourceRecordId: "msg-101",
    recordType: "email_message",
    payload: {
      threadId: "thread-alpha",
      subject: "Re: Q3 roadmap sync",
      from: "you@example.com",
      to: "alex@example.com",
      snippet: "MCP tools land in Phase 6; distillates regenerable.",
    },
    contentHash: "hash-email-101",
    occurredAt: "2026-07-09T11:00:00.000Z",
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sourceId: "calendar",
    sourceRecordId: "evt-200",
    recordType: "calendar_event",
    payload: {
      summary: "Cortex design review",
      start: "2026-07-11T16:00:00.000Z",
      end: "2026-07-11T17:00:00.000Z",
      calendarId: "primary",
      location: "Meet",
    },
    contentHash: "hash-cal-200",
    occurredAt: "2026-07-11T16:00:00.000Z",
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    sourceId: "drive",
    sourceRecordId: "file-300",
    recordType: "drive_file",
    payload: {
      name: "Cortex architecture notes.md",
      mimeType: "text/markdown",
      path: "Drive/Cortex/architecture notes.md",
      summary:
        "Three layers: raw vault, canonical records, regenerable distillates. Remote MCP reads canonical + distillates.",
    },
    contentHash: "hash-drive-300",
    occurredAt: "2026-07-08T12:00:00.000Z",
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    sourceId: "github",
    sourceRecordId: "pr-42",
    recordType: "github_pr",
    payload: {
      title: "feat: Claude + Codex backfill",
      number: 42,
      repo: "cortex",
    },
    contentHash: "hash-gh-42",
    occurredAt: "2026-07-07T18:00:00.000Z",
  },
];

export let fixtureDistillates: DistillateRow[] = [
  {
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    subjectType: "session",
    subjectId: FIXTURE_SESSIONS[0]!.id,
    kind: "summary",
    content:
      "Session focused on ingest API bearer auth using CORTEX_INGEST_TOKEN.",
    embeddingRef: null,
    model: "fixture-stub",
    metadata: { fixture: true },
    createdAt: "2026-07-10T15:31:00.000Z",
    updatedAt: "2026-07-10T15:31:00.000Z",
  },
];

// Attach distillate to first session for get_session demos
FIXTURE_SESSIONS[0]!.distillate = fixtureDistillates[0]!;

export function matchQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

export function recordToRecent(r: RecordHit): RecentWorkItem {
  const title =
    (typeof r.payload.title === "string" && r.payload.title) ||
    (typeof r.payload.subject === "string" && r.payload.subject) ||
    (typeof r.payload.name === "string" && r.payload.name) ||
    (typeof r.payload.summary === "string" && r.payload.summary) ||
    `${r.recordType}:${r.sourceRecordId}`;
  return {
    kind: "record",
    id: r.id,
    sourceId: r.sourceId,
    title,
    occurredAt: r.occurredAt,
    recordType: r.recordType,
  };
}

export function sessionToRecent(s: SessionDetail): RecentWorkItem {
  return {
    kind: "session",
    id: s.id,
    sourceId: s.sourceId,
    title: s.title ?? s.sourceSessionId,
    occurredAt: s.endedAt ?? s.startedAt,
  };
}

export function emailThreadFromRecords(
  threadId: string,
  records: RecordHit[],
): EmailThread | null {
  const messages = records
    .filter(
      (r) =>
        r.recordType === "email_message" &&
        r.payload.threadId === threadId,
    )
    .sort((a, b) =>
      (a.occurredAt ?? "").localeCompare(b.occurredAt ?? ""),
    )
    .map((r) => ({
      id: r.id,
      sourceRecordId: r.sourceRecordId,
      from: typeof r.payload.from === "string" ? r.payload.from : null,
      to: typeof r.payload.to === "string" ? r.payload.to : null,
      subject:
        typeof r.payload.subject === "string" ? r.payload.subject : null,
      snippet:
        typeof r.payload.snippet === "string" ? r.payload.snippet : null,
      occurredAt: r.occurredAt,
    }));
  if (messages.length === 0) return null;
  return {
    threadId,
    subject: messages[0]?.subject ?? null,
    messages,
  };
}

export function calendarFromRecords(
  start: string,
  end: string,
  records: RecordHit[],
): CalendarEventItem[] {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return records
    .filter((r) => r.recordType === "calendar_event")
    .map((r) => {
      const eventStart =
        (typeof r.payload.start === "string" && r.payload.start) ||
        r.occurredAt;
      return {
        id: r.id,
        sourceRecordId: r.sourceRecordId,
        summary:
          typeof r.payload.summary === "string" ? r.payload.summary : null,
        start: eventStart,
        end: typeof r.payload.end === "string" ? r.payload.end : null,
        calendarId:
          typeof r.payload.calendarId === "string"
            ? r.payload.calendarId
            : null,
        location:
          typeof r.payload.location === "string" ? r.payload.location : null,
      } satisfies CalendarEventItem;
    })
    .filter((e) => {
      if (!e.start) return false;
      const t = Date.parse(e.start);
      if (Number.isNaN(t)) return false;
      if (!Number.isNaN(startMs) && t < startMs) return false;
      if (!Number.isNaN(endMs) && t > endMs) return false;
      return true;
    });
}

export function fileFromRecords(
  fileId: string,
  records: RecordHit[],
): FileSummary | null {
  const r = records.find(
    (row) =>
      (row.id === fileId || row.sourceRecordId === fileId) &&
      (row.recordType === "drive_file" ||
        row.recordType === "ebook" ||
        row.recordType.includes("file")),
  );
  if (!r) return null;
  return {
    id: r.id,
    sourceRecordId: r.sourceRecordId,
    name: typeof r.payload.name === "string" ? r.payload.name : null,
    mimeType:
      typeof r.payload.mimeType === "string" ? r.payload.mimeType : null,
    path: typeof r.payload.path === "string" ? r.payload.path : null,
    summary:
      typeof r.payload.summary === "string" ? r.payload.summary : null,
    occurredAt: r.occurredAt,
    metadata: r.payload,
  };
}

export function sessionToEnvelope(s: SessionDetail): SessionEnvelopeInput {
  return {
    sourceId: s.sourceId,
    sourceSessionId: s.sourceSessionId,
    title: s.title,
    workspace: s.workspace,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    excerpts: s.messages
      .map((m) => m.content)
      .filter((c): c is string => Boolean(c)),
    toolSummaries: s.toolCalls.map((t) =>
      t.argsSummary ? `${t.toolName}(${t.argsSummary})` : t.toolName,
    ),
    metadata: { ...s.metadata, sessionId: s.id },
  };
}

export { OWNER };

/** In-memory project graph for fixture twin path demos. */
export const fixtureEntities: import("./types.js").EntityRow[] = [
  {
    id: "e1111111-1111-4111-8111-111111111111",
    entityType: "project",
    canonicalKey: "cortex",
    displayName: "Cortex",
    metadata: { fixture: true },
    createdAt: "2026-07-10T12:00:00.000Z",
  },
];

export const fixtureEntityLinks: import("./types.js").EntityLinkRow[] = [
  {
    id: "el111111-1111-4111-8111-111111111111",
    entityId: fixtureEntities[0]!.id,
    linkedType: "session",
    linkedId: FIXTURE_SESSIONS[0]!.id,
    relation: "related",
    metadata: { fixture: true },
    createdAt: "2026-07-10T12:05:00.000Z",
  },
];
