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
import { fixtureEmbedFromText } from "./search-helpers.js";
import { sampleSessionTurns, turnsToExcerpts } from "../session-sampler.js";

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
    endedAt: "2026-07-11T12:00:00.000Z",
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
      attendees: [{ email: "a@example.com" }, { email: "b@example.com" }],
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
      folderPath: "Drive/Cortex",
      path: "Drive/Cortex/architecture notes.md",
      modifiedTime: "2026-07-08T12:00:00.000Z",
      textPreview:
        "Three layers: raw vault, canonical records, regenerable distillates. Remote MCP reads canonical + distillates.",
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
      repoFullName: "jackye426/cortex",
      state: "closed",
      mergedAt: "2026-07-07T19:00:00.000Z",
      userLogin: "jackye426",
      updatedAt: "2026-07-07T19:00:00.000Z",
    },
    contentHash: "hash-gh-42",
    occurredAt: "2026-07-07T18:00:00.000Z",
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sourceId: "youtube",
    sourceRecordId: "yt-watch-agent-1",
    recordType: "youtube_watch",
    payload: {
      title: "Agent memory architectures for LLM systems",
      channelTitle: "AI Engineering",
      videoId: "vid-agent-1",
      watchedAt: "2026-07-10T20:00:00.000Z",
      descriptionPreview: "Persistent memory and retrieval for agents",
    },
    contentHash: "hash-yt-1",
    occurredAt: "2026-07-10T20:00:00.000Z",
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    sourceId: "youtube",
    sourceRecordId: "yt-watch-agent-2",
    recordType: "youtube_watch",
    payload: {
      title: "Building cognitive architectures for AI agents",
      channelTitle: "AI Engineering",
      videoId: "vid-agent-2",
      watchedAt: "2026-07-11T21:00:00.000Z",
      descriptionPreview: "How agents store and retrieve episodic memory",
    },
    contentHash: "hash-yt-2",
    occurredAt: "2026-07-11T21:00:00.000Z",
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    sourceId: "youtube",
    sourceRecordId: "yt-watch-cook-1",
    recordType: "youtube_watch",
    payload: {
      title: "Perfect pasta carbonara",
      channelTitle: "Cooking Channel",
      videoId: "vid-cook-1",
      watchedAt: "2026-07-11T22:00:00.000Z",
      descriptionPreview: "Classic Italian recipe",
    },
    contentHash: "hash-yt-3",
    occurredAt: "2026-07-11T22:00:00.000Z",
  },
];

const summary1 =
  "Session focused on ingest API bearer auth using CORTEX_INGEST_TOKEN for Cortex vault writes.";
const summary2 =
  "Built remote MCP search_memory and search_records scaffolding for Cortex twin retrieval.";
const youtubeDigest =
  "YouTube week digest: recurring interest in agent memory and cognitive architectures; one-off cooking video.";

export let fixtureDistillates: DistillateRow[] = [
  {
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    subjectType: "session",
    subjectId: FIXTURE_SESSIONS[0]!.id,
    kind: "summary",
    content: summary1,
    embeddingRef: "fixture:hash",
    embedding: fixtureEmbedFromText(summary1),
    model: "fixture-stub",
    metadata: {
      fixture: true,
      domains: ["work"],
      domain: "work",
      sourceType: "claude-code",
      topics: ["cortex", "ingest-auth"],
      projects: ["Cortex"],
      repos: ["cortex"],
      nextActions: ["Deploy MCP with bearer auth"],
      commercialVsTech: "tech",
      compilerVersion: "session-v2",
      confidence: 0.8,
    },
    createdAt: "2026-07-10T15:31:00.000Z",
    updatedAt: "2026-07-10T15:31:00.000Z",
  },
  {
    id: "f2222222-2222-4222-8222-222222222222",
    subjectType: "session",
    subjectId: FIXTURE_SESSIONS[1]!.id,
    kind: "summary",
    content: summary2,
    embeddingRef: "fixture:hash",
    embedding: fixtureEmbedFromText(summary2 + " agent memory retrieval"),
    model: "fixture-stub",
    metadata: {
      fixture: true,
      domains: ["work"],
      domain: "work",
      sourceType: "cursor",
      topics: ["cortex", "agent-memory", "mcp"],
      projects: ["Cortex", "MCP"],
      repos: ["cortex"],
      nextActions: ["Wire hybrid search_memory"],
      commercialVsTech: "tech",
      explorationSignals: [
        {
          text: "Explored hybrid memory retrieval design",
          evidenceIndices: [0],
          confidence: 0.7,
        },
      ],
      compilerVersion: "session-v2",
      confidence: 0.8,
    },
    createdAt: "2026-07-11T12:05:00.000Z",
    updatedAt: "2026-07-11T12:05:00.000Z",
  },
  {
    id: "f3333333-3333-4333-8333-333333333333",
    subjectType: "note",
    subjectId: "33333333-3333-4333-8333-333333333333",
    kind: "decision",
    content:
      "Ship distillate RAG before Obsidian\n\nPrefer pgvector on distillates over an Obsidian middle vault.",
    embeddingRef: "fixture:hash",
    embedding: fixtureEmbedFromText(
      "Ship distillate RAG before Obsidian Prefer pgvector",
    ),
    model: "fixture-capture",
    metadata: {
      fixture: true,
      domains: ["work"],
      sourceType: "manual",
      title: "Ship distillate RAG before Obsidian",
      capture: true,
      relatedEntityKey: "cortex",
      extension: "D3",
    },
    createdAt: "2026-07-11T13:00:00.000Z",
    updatedAt: "2026-07-11T13:00:00.000Z",
  },
  {
    id: "f4444444-4444-4444-8444-444444444444",
    subjectType: "week",
    subjectId: "a0280000-0000-4000-8000-000000002028",
    kind: "youtube_interest_digest",
    content: youtubeDigest,
    embeddingRef: "fixture:hash",
    embedding: fixtureEmbedFromText(
      "agent memory cognitive architectures youtube interest",
    ),
    model: "fixture-youtube",
    metadata: {
      fixture: true,
      domains: ["interest"],
      domain: "interest",
      sourceType: "youtube",
      topics: ["agent-memory", "cognitive-architecture"],
      confidence: 0.82,
      compilerVersion: "youtube-interest-v1",
      weekKey: "2026-W28",
      evidenceRefs: [
        { type: "record", id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
        { type: "record", id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      ],
      recurring: ["AI Engineering"],
      oneOff: ["Cooking Channel"],
    },
    createdAt: "2026-07-12T08:00:00.000Z",
    updatedAt: "2026-07-12T08:00:00.000Z",
  },
  {
    id: "f5555555-5555-4555-8555-555555555555",
    subjectType: "github",
    subjectId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    kind: "github_outcome_digest",
    content:
      "Shipped Claude + Codex backfill PR on jackye426/cortex. Outcome: shipped.",
    embeddingRef: "fixture:hash",
    embedding: fixtureEmbedFromText("github shipped pull request cortex backfill"),
    model: "fixture-github",
    metadata: {
      fixture: true,
      domains: ["work"],
      domain: "work",
      sourceType: "github",
      topics: ["cortex", "backfill"],
      outcome: "shipped",
      compilerVersion: "github-outcome-v2",
      sourceFingerprint: "fixture-gh",
      confidence: 0.8,
    },
    createdAt: "2026-07-12T09:00:00.000Z",
    updatedAt: "2026-07-12T09:00:00.000Z",
  },
  {
    id: "f6666666-6666-4666-8666-666666666666",
    subjectType: "calendar_event",
    subjectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind: "calendar_event_digest",
    content: "Calendar: Cortex design review. Type: review.",
    embeddingRef: "fixture:hash",
    embedding: fixtureEmbedFromText("calendar meeting cortex design review"),
    model: "fixture-calendar",
    metadata: {
      fixture: true,
      domains: ["work"],
      domain: "work",
      sourceType: "calendar",
      topics: ["cortex", "design-review"],
      meetingType: "review",
      compilerVersion: "calendar-event-v2",
      sourceFingerprint: "fixture-cal",
      confidence: 0.75,
    },
    createdAt: "2026-07-12T09:05:00.000Z",
    updatedAt: "2026-07-12T09:05:00.000Z",
  },
  {
    id: "f7777777-7777-4777-8777-777777777777",
    subjectType: "drive_file",
    subjectId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    kind: "drive_file_digest",
    content:
      "Drive file: Cortex architecture notes.md. Spec for vault + distillates.",
    embeddingRef: "fixture:hash",
    embedding: fixtureEmbedFromText("drive doc spec cortex architecture notes"),
    model: "fixture-drive",
    metadata: {
      fixture: true,
      domains: ["work", "reference"],
      domain: "work",
      sourceType: "drive",
      topics: ["cortex", "architecture"],
      docRole: "spec",
      compilerVersion: "drive-file-v2",
      sourceFingerprint: "fixture-drive",
      confidence: 0.78,
    },
    createdAt: "2026-07-12T09:10:00.000Z",
    updatedAt: "2026-07-12T09:10:00.000Z",
  },
];

// Attach distillate to first session for get_session demos
FIXTURE_SESSIONS[0]!.distillate = fixtureDistillates[0]!;
FIXTURE_SESSIONS[1]!.distillate = fixtureDistillates[1]!;

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
  const turns = s.messages.map((m, i) => ({
    index: i,
    role: m.role,
    content: m.content ?? "",
    messageId: m.id,
    toolHeavy:
      m.role === "tool" ||
      s.toolCalls.some((t) => (m.content ?? "").includes(t.toolName)),
  }));
  const sampled = sampleSessionTurns(turns);
  return {
    sourceId: s.sourceId,
    sourceSessionId: s.sourceSessionId,
    title: s.title,
    workspace: s.workspace,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    excerpts: turnsToExcerpts(sampled.turns),
    toolSummaries: s.toolCalls.map((t) =>
      t.argsSummary ? `${t.toolName}(${t.argsSummary})` : t.toolName,
    ),
    sampledTurns: sampled.turns,
    turnCount: sampled.totalTurnCount,
    sampleStrategy: sampled.sampleStrategy,
    metadata: {
      ...s.metadata,
      sessionId: s.id,
      metadataOnly: sampled.metadataOnly,
    },
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
  {
    id: "e2222222-2222-4222-8222-222222222222",
    entityType: "ambition",
    canonicalKey: "personal-executive-twin",
    displayName: "Personal Executive Twin",
    metadata: { fixture: true, weight: 1 },
    createdAt: "2026-07-10T12:00:00.000Z",
  },
  {
    id: "e3333333-3333-4333-8333-333333333333",
    entityType: "priority",
    canonicalKey: "ship-rag-memory",
    displayName: "Ship RAG memory",
    metadata: { fixture: true, weight: 0.6 },
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
