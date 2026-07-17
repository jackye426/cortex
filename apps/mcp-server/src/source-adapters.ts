/**
 * Shared source-adapter contract for post-quality-gate distillate compilers.
 *
 * Enablement is gated by CORTEX_SOURCE_ADAPTERS (twin-pipeline). CLI can still
 * dry-run / live-write any adapter for acceptance checks.
 */
import { redactText } from "@cortex/redaction";
import type { CortexStore } from "./store/index.js";
import type { DistillateRow, RecordHit } from "./store/types.js";
import { normalizeTopic } from "./store/memory-lenses.js";
import { stableSubjectUuid } from "./stable-id.js";
import {
  chatJsonCompletion,
  distillateModel,
  embedTexts,
  openaiConfigured,
} from "./llm.js";
import {
  inWeek,
  isoWeekKey,
  sourceFingerprint,
  weekRange,
} from "./week-helpers.js";
import { runYoutubeInterestDigest } from "./youtube-digest.js";

export type SourceDomain = "work" | "interest" | "personal" | "reference";

export interface SourceAdapterContext {
  store: CortexStore;
  dryRun?: boolean;
  force?: boolean;
  limit?: number;
  /** ISO week key for week-scoped adapters (default: current week). */
  weekKey?: string;
}

export interface SourceAdapterResult {
  adapter: string;
  dryRun: boolean;
  scanned: number;
  written: number;
  skipped: number;
  skippedSensitive?: number;
  sensitiveReasons?: Record<string, number>;
  distillates: DistillateRow[];
}

export interface SourceAdapter {
  id: string;
  kind: string;
  domainDefault: SourceDomain;
  grain: string;
  evaluationQuestions: string[];
  /** nightly | weekly — used by twin-pipeline cadence. */
  cadence: "nightly" | "weekly" | "manual";
  run(ctx: SourceAdapterContext): Promise<SourceAdapterResult>;
}

async function maybeEmbed(content: string): Promise<{
  embedding: number[] | null;
  embeddingRef: string | null;
}> {
  if (!openaiConfigured() || !content.trim()) {
    return { embedding: null, embeddingRef: null };
  }
  try {
    const [vec] = await embedTexts([content]);
    if (!vec?.length) return { embedding: null, embeddingRef: null };
    return {
      embedding: vec,
      embeddingRef: `openai:${process.env.CORTEX_EMBEDDING_MODEL?.trim() || "text-embedding-3-small"}`,
    };
  } catch {
    return { embedding: null, embeddingRef: null };
  }
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((s) => s.trim())
    : [];
}

async function upsertDigest(args: {
  store: CortexStore;
  dryRun: boolean;
  subjectType: string;
  subjectId: string;
  kind: string;
  content: string;
  domains: SourceDomain[];
  sourceType: string;
  topics: string[];
  evidenceRefs: unknown[];
  compilerVersion: string;
  sourceFingerprint: string;
  extraMeta?: Record<string, unknown>;
  model: string;
  confidence?: number;
}): Promise<DistillateRow> {
  const { embedding, embeddingRef } =
    args.dryRun || !openaiConfigured()
      ? { embedding: null, embeddingRef: null }
      : await maybeEmbed(
          [args.content, ...args.topics.map((t) => `topic:${t}`)].join("\n"),
        );
  const draft = {
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    kind: args.kind,
    content: args.content,
    embeddingRef,
    embedding,
    model: args.model,
    metadata: {
      domains: args.domains,
      domain: args.domains[0],
      topics: args.topics,
      sourceType: args.sourceType,
      evidenceRefs: args.evidenceRefs,
      compilerVersion: args.compilerVersion,
      sourceFingerprint: args.sourceFingerprint,
      confidence: args.confidence ?? 0.65,
      ...args.extraMeta,
    },
  };
  if (args.dryRun) {
    const now = new Date().toISOString();
    return { id: "dry-run", ...draft, createdAt: now, updatedAt: now };
  }
  const row = await args.store.upsertDistillate(draft);
  for (const topic of args.topics.slice(0, 8)) {
    const entity = await args.store.upsertEntity({
      entityType: "topic",
      canonicalKey: topic,
      displayName: topic.replace(/-/g, " "),
      metadata: { source: args.sourceType },
    });
    await args.store.linkEntity({
      entityId: entity.id,
      linkedType: "distillate",
      linkedId: row.id,
      relation: "mentions",
    });
  }
  return row;
}

function groupBy<T>(items: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const list = m.get(k) ?? [];
    list.push(item);
    m.set(k, list);
  }
  return m;
}

function latestOccurredAt(msgs: RecordHit[]): string {
  let best = "";
  for (const m of msgs) {
    const t = m.occurredAt ?? "";
    if (t > best) best = t;
  }
  return best;
}

type ExistingDigestIndex = Map<
  string,
  { fingerprint: string; compilerVersion: string }
>;

async function loadExistingBySubject(
  store: CortexStore,
  kind: string,
  compilerVersion: string,
  limit = 120,
): Promise<ExistingDigestIndex> {
  const existing = await store.listDistillates({ limit, kinds: [kind] });
  const map: ExistingDigestIndex = new Map();
  for (const d of existing) {
    if (d.metadata.compilerVersion !== compilerVersion) continue;
    map.set(d.subjectId, {
      fingerprint: String(d.metadata.sourceFingerprint ?? ""),
      compilerVersion,
    });
  }
  return map;
}

function shouldSkipSubject(
  existing: ExistingDigestIndex,
  subjectId: string,
  fingerprint: string,
  force?: boolean,
): boolean {
  if (force) return false;
  const hit = existing.get(subjectId);
  if (!hit) return false;
  // Same compiler + same fingerprint → skip; missing fingerprint → skip once
  // (legacy v2 rows written before fingerprint) unless force.
  if (!hit.fingerprint) return true;
  return hit.fingerprint === fingerprint;
}

// ─── email-thread-v2 ─────────────────────────────────────────────────────────

const EMAIL_THREAD_COMPILER = "email-thread-v2";

function isNoisyEmail(r: RecordHit): boolean {
  const labels = Array.isArray(r.payload.labelIds)
    ? r.payload.labelIds.map(String)
    : [];
  const subject = String(r.payload.subject ?? "");
  const from = String(r.payload.from ?? "");
  if (labels.includes("SPAM")) return true;
  if (labels.includes("CATEGORY_PROMOTIONS")) return true;
  if (labels.includes("CATEGORY_SOCIAL")) return true;
  if (
    /unsubscribe|newsletter|noreply|no-reply|donotreply|do-not-reply/i.test(
      subject,
    )
  ) {
    return true;
  }
  if (/noreply|no-reply|donotreply|notifications?@|mailer-daemon/i.test(from)) {
    return true;
  }
  if (
    /unread messages waiting|you have \d+\s+(new\s+)?messages|new notification/i.test(
      subject,
    )
  ) {
    return true;
  }
  if (
    labels.includes("CATEGORY_UPDATES") &&
    !labels.includes("IMPORTANT") &&
    !labels.includes("STARRED")
  ) {
    return true;
  }
  return false;
}

async function compileEmailThreadDigest(
  subject: string,
  msgs: RecordHit[],
): Promise<{
  content: string;
  topics: string[];
  commitments: string[];
  openLoops: string[];
  model: string;
}> {
  const lines = msgs
    .slice()
    .sort((a, b) => (a.occurredAt ?? "").localeCompare(b.occurredAt ?? ""))
    .map((m) => {
      const from = String(m.payload.from ?? "?");
      const snip = String(m.payload.snippet ?? "").replace(/\s+/g, " ").trim();
      return `- from=${from} | ${snip.slice(0, 220)}`;
    })
    .slice(0, 12);

  const fallbackContent =
    `Email thread "${subject}" (${msgs.length} msgs). ${lines.map((l) => l.replace(/^- /, "")).join(" | ")}`.slice(
      0,
      1200,
    );
  const fallbackTopics = [
    normalizeTopic(subject.split(/\s+/).slice(0, 4).join(" ")),
  ].filter(Boolean);

  if (!openaiConfigured()) {
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      commitments: [],
      openLoops: [],
      model: "cortex-email-digest-stub",
    };
  }

  try {
    const { text, model } = await chatJsonCompletion({
      system: `You distill a Gmail thread into personal memory JSON for an executive twin.
Return ONLY JSON: {
  "summary": string,
  "commitments": string[],
  "openLoops": string[],
  "topics": string[],
  "confidence": number
}
Rules:
- Prefer observable commitments and open loops (who owes what, by when if stated).
- Do not invent psychology; do not treat newsletters as commitments.
- topics: 1-5 short slugs (kebab-case ok).
- Keep summary under 400 chars.`,
      user: `Subject: ${subject}\nMessages (${msgs.length}):\n${lines.join("\n")}`.slice(
        0,
        8000,
      ),
      model: distillateModel(),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallbackContent;
    const commitments = asStrings(parsed.commitments).slice(0, 8);
    const openLoops = asStrings(parsed.openLoops).slice(0, 8);
    const topics = asStrings(parsed.topics)
      .map((t) => normalizeTopic(t))
      .filter(Boolean)
      .slice(0, 6);
    const content = [
      summary,
      commitments.length ? `Commitments: ${commitments.join("; ")}` : "",
      openLoops.length ? `Open loops: ${openLoops.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1600);
    return {
      content,
      topics: topics.length ? topics : fallbackTopics,
      commitments,
      openLoops,
      model,
    };
  } catch (err) {
    console.warn(
      "[email-thread] LLM failed; stub:",
      err instanceof Error ? err.message : err,
    );
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      commitments: [],
      openLoops: [],
      model: "cortex-email-digest-stub",
    };
  }
}

export const emailThreadAdapter: SourceAdapter = {
  id: "email-thread",
  kind: "email_thread_digest",
  domainDefault: "work",
  grain: "gmail thread (≥2 messages): commitments + open loops",
  cadence: "nightly",
  evaluationQuestions: [
    "What commitments did email create this week?",
    "Which email threads relate to active Cortex or DocMap work?",
    "What open loops am I carrying in email?",
  ],
  async run(ctx) {
    const maxThreads = Math.max(1, Math.min(ctx.limit ?? 8, 100));
    const records = await ctx.store.listRecordsByType(
      "email_message",
      Math.min(2000, Math.max(400, maxThreads * 20)),
    );
    const filtered = records.filter((r) => !isNoisyEmail(r));
    const byThread = groupBy(
      filtered,
      (r) => String(r.payload.threadId ?? r.sourceRecordId),
    );

    const threads = [...byThread.entries()]
      .map(([threadId, msgs]) => ({
        threadId,
        msgs,
        latest: latestOccurredAt(msgs),
        fingerprint: sourceFingerprint(msgs),
      }))
      .filter((t) => t.msgs.length >= 2)
      .sort((a, b) => b.latest.localeCompare(a.latest))
      .slice(0, maxThreads);

    const existing = ctx.force
      ? new Map()
      : await loadExistingBySubject(
          ctx.store,
          "email_thread_digest",
          EMAIL_THREAD_COMPILER,
        );

    const distillates: DistillateRow[] = [];
    let written = 0;
    let skipped = 0;

    for (const { threadId, msgs, fingerprint } of threads) {
      const subjectId = stableSubjectUuid("email-thread", threadId);
      if (shouldSkipSubject(existing, subjectId, fingerprint, ctx.force)) {
        skipped += 1;
        continue;
      }
      const subject = String(msgs[0]?.payload.subject ?? threadId);
      const compiled = await compileEmailThreadDigest(subject, msgs);
      const row = await upsertDigest({
        store: ctx.store,
        dryRun: Boolean(ctx.dryRun),
        subjectType: "email_thread",
        subjectId,
        kind: this.kind,
        content: compiled.content,
        domains: ["work"],
        sourceType: "gmail",
        topics: compiled.topics,
        evidenceRefs: msgs.map((m) => ({ type: "record", id: m.id })),
        compilerVersion: EMAIL_THREAD_COMPILER,
        sourceFingerprint: fingerprint,
        model: compiled.model,
        extraMeta: {
          messageCount: msgs.length,
          subject,
          threadId,
          commitments: compiled.commitments,
          openLoops: compiled.openLoops,
          grain: "multi_message_thread",
        },
      });
      distillates.push(row);
      written += 1;
    }

    const singleMsgSkipped = [...byThread.values()].filter(
      (m) => m.length < 2,
    ).length;

    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: filtered.length,
      written,
      skipped: skipped + singleMsgSkipped,
      distillates,
    };
  },
};

// ─── github-outcome-v2 ───────────────────────────────────────────────────────

const GITHUB_OUTCOME_COMPILER = "github-outcome-v2";

function githubOutcomeHeuristic(r: RecordHit): {
  outcome: "shipped" | "closed" | "stalled" | "open";
} {
  const state = String(r.payload.state ?? "").toLowerCase();
  const mergedAt = r.payload.mergedAt ?? r.payload.merged_at;
  if (mergedAt) return { outcome: "shipped" };
  if (state === "closed") return { outcome: "closed" };
  const updated =
    String(r.payload.updatedAt ?? r.payload.updated_at ?? r.occurredAt ?? "") ||
    "";
  if (updated) {
    const ageMs = Date.now() - Date.parse(updated);
    if (Number.isFinite(ageMs) && ageMs > 14 * 86400000) {
      return { outcome: "stalled" };
    }
  }
  return { outcome: "open" };
}

async function compileGithubOutcome(r: RecordHit): Promise<{
  content: string;
  topics: string[];
  outcome: string;
  nextLink?: string;
  model: string;
}> {
  const title = String(r.payload.title ?? r.sourceRecordId);
  const state = String(r.payload.state ?? "unknown");
  const repo = String(r.payload.repoFullName ?? r.payload.repo ?? "");
  const number = r.payload.number ?? "";
  const user = String(r.payload.userLogin ?? "");
  const heuristic = githubOutcomeHeuristic(r);
  const fallbackContent =
    `GitHub ${r.recordType} ${repo}#${number}: ${title} [${state}/${heuristic.outcome}] by ${user}`.slice(
      0,
      1200,
    );
  const fallbackTopics = [
    normalizeTopic(repo),
    normalizeTopic(title.split(/\s+/).slice(0, 3).join(" ")),
  ].filter(Boolean);

  if (!openaiConfigured()) {
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      outcome: heuristic.outcome,
      model: "cortex-github-digest-stub",
    };
  }

  try {
    const { text, model } = await chatJsonCompletion({
      system: `You distill a GitHub PR/issue into personal memory JSON for an executive twin.
Return ONLY JSON: {
  "summary": string,
  "outcome": "shipped" | "closed" | "stalled" | "open",
  "nextLink": string | null,
  "topics": string[],
  "confidence": number
}
Rules:
- outcome: shipped if merged; closed if closed without merge; stalled if open and idle >14d; else open.
- nextLink: optional follow-up action if implied; else null. Do not invent.
- topics: 1-5 short slugs. summary under 400 chars.`,
      user: JSON.stringify({
        recordType: r.recordType,
        repo,
        number,
        title,
        state,
        userLogin: user,
        mergedAt: r.payload.mergedAt ?? r.payload.merged_at ?? null,
        updatedAt: r.payload.updatedAt ?? r.payload.updated_at ?? r.occurredAt,
        heuristicOutcome: heuristic.outcome,
        bodyPreview: String(r.payload.body ?? r.payload.bodyText ?? "").slice(
          0,
          600,
        ),
      }).slice(0, 6000),
      model: distillateModel(),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const outcomeRaw = String(parsed.outcome ?? heuristic.outcome).toLowerCase();
    const outcome = (
      ["shipped", "closed", "stalled", "open"] as const
    ).includes(outcomeRaw as "shipped")
      ? outcomeRaw
      : heuristic.outcome;
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallbackContent;
    const nextLink =
      typeof parsed.nextLink === "string" && parsed.nextLink.trim()
        ? parsed.nextLink.trim()
        : undefined;
    const topics = asStrings(parsed.topics)
      .map((t) => normalizeTopic(t))
      .filter(Boolean)
      .slice(0, 6);
    const content = [
      summary,
      `Outcome: ${outcome}`,
      nextLink ? `Next: ${nextLink}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1600);
    return {
      content,
      topics: topics.length ? topics : fallbackTopics,
      outcome,
      nextLink,
      model,
    };
  } catch (err) {
    console.warn(
      "[github-outcome] LLM failed; stub:",
      err instanceof Error ? err.message : err,
    );
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      outcome: heuristic.outcome,
      model: "cortex-github-digest-stub",
    };
  }
}

export const githubOutcomeAdapter: SourceAdapter = {
  id: "github-outcome",
  kind: "github_outcome_digest",
  domainDefault: "work",
  grain: "PR/issue that changed state (merged/closed/open>14d)",
  cadence: "nightly",
  evaluationQuestions: [
    "Which session next-actions later shipped on GitHub?",
    "What PRs stalled this month?",
  ],
  async run(ctx) {
    const maxItems = Math.max(1, Math.min(ctx.limit ?? 15, 100));
    const [prs, issues] = await Promise.all([
      ctx.store.listRecordsByType("github_pr", 500),
      ctx.store.listRecordsByType("github_issue", 500),
    ]);
    const items = [...prs, ...issues]
      .filter((r) => {
        const user = String(r.payload.userLogin ?? r.payload.user ?? "");
        if (/bot|dependabot|renovate|\[bot\]/i.test(user)) return false;
        // Never distill repo/README blobs via this adapter
        if (r.recordType !== "github_pr" && r.recordType !== "github_issue") {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))
      .slice(0, maxItems);

    const existing = ctx.force
      ? new Map()
      : await loadExistingBySubject(
          ctx.store,
          "github_outcome_digest",
          GITHUB_OUTCOME_COMPILER,
        );

    const distillates: DistillateRow[] = [];
    let written = 0;
    let skipped = 0;

    for (const r of items) {
      const fingerprint = sourceFingerprint([r]);
      const subjectId = r.id;
      if (shouldSkipSubject(existing, subjectId, fingerprint, ctx.force)) {
        skipped += 1;
        continue;
      }
      const compiled = await compileGithubOutcome(r);
      const row = await upsertDigest({
        store: ctx.store,
        dryRun: Boolean(ctx.dryRun),
        subjectType: "github",
        subjectId,
        kind: this.kind,
        content: compiled.content,
        domains: ["work"],
        sourceType: "github",
        topics: compiled.topics,
        evidenceRefs: [{ type: "record", id: r.id }],
        compilerVersion: GITHUB_OUTCOME_COMPILER,
        sourceFingerprint: fingerprint,
        model: compiled.model,
        extraMeta: {
          outcome: compiled.outcome,
          state: String(r.payload.state ?? ""),
          repo: String(r.payload.repoFullName ?? r.payload.repo ?? ""),
          nextLink: compiled.nextLink ?? null,
          recordType: r.recordType,
        },
      });
      distillates.push(row);
      written += 1;
    }

    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: prs.length + issues.length,
      written,
      skipped,
      distillates,
    };
  },
};

// ─── calendar-event-v2 ───────────────────────────────────────────────────────

const CALENDAR_EVENT_COMPILER = "calendar-event-v2";

const CALENDAR_ALLOW =
  /\b(1:1|1-1|one.on.one|sync|review|interview|standup|stand-up|retro|demo|pilot)\b/i;
const CALENDAR_NOISE =
  /\b(gym|workout|focus|block|reminder|lunch|commute|personal care|ooo|out of office|dentist|doctor|haircut)\b/i;

function attendeeCount(r: RecordHit): number {
  const attendees = r.payload.attendees;
  if (Array.isArray(attendees)) return attendees.length;
  const n = r.payload.attendeeCount;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function isKeptMeeting(r: RecordHit): boolean {
  const summary = String(r.payload.summary ?? r.payload.title ?? "").trim();
  if (!summary) return false;
  if (CALENDAR_NOISE.test(summary)) return false;
  const allow = CALENDAR_ALLOW.test(summary);
  const attendees = attendeeCount(r);
  if (r.payload.recurringEventId && !allow) return false;
  if (allow) return true;
  // Non-allowlist: keep only multi-attendee non-noisy meetings
  return attendees >= 2;
}

async function compileCalendarEvent(r: RecordHit): Promise<{
  content: string;
  topics: string[];
  meetingType: string;
  relatedProjects: string[];
  openLoops: string[];
  model: string;
}> {
  const summary = String(r.payload.summary ?? r.payload.title ?? r.sourceRecordId);
  const start = String(r.payload.start ?? r.occurredAt ?? "");
  const end = String(r.payload.end ?? "");
  const fallbackContent =
    `Calendar: ${summary}. start=${start} end=${end} attendees=${attendeeCount(r)}`.slice(
      0,
      1200,
    );
  const fallbackTopics = [
    normalizeTopic(summary.split(/\s+/).slice(0, 4).join(" ")),
  ].filter(Boolean);

  if (!openaiConfigured()) {
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      meetingType: CALENDAR_ALLOW.test(summary) ? "work" : "meeting",
      relatedProjects: [],
      openLoops: [],
      model: "cortex-calendar-digest-stub",
    };
  }

  try {
    const { text, model } = await chatJsonCompletion({
      system: `You distill a kept calendar meeting into personal memory JSON.
Return ONLY JSON: {
  "summary": string,
  "meetingType": string,
  "relatedProjects": string[],
  "openLoops": string[],
  "topics": string[],
  "confidence": number
}
Rules:
- Do NOT invent commitments from the title alone.
- relatedProjects / openLoops only when clearly implied by title or description.
- summary under 400 chars.`,
      user: JSON.stringify({
        summary,
        start,
        end,
        attendees: attendeeCount(r),
        description: String(r.payload.description ?? "").slice(0, 400),
        location: r.payload.location ?? null,
      }).slice(0, 4000),
      model: distillateModel(),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const summaryText =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallbackContent;
    const meetingType =
      typeof parsed.meetingType === "string" && parsed.meetingType.trim()
        ? parsed.meetingType.trim()
        : "meeting";
    const relatedProjects = asStrings(parsed.relatedProjects).slice(0, 6);
    const openLoops = asStrings(parsed.openLoops).slice(0, 6);
    const topics = asStrings(parsed.topics)
      .map((t) => normalizeTopic(t))
      .filter(Boolean)
      .slice(0, 6);
    const content = [
      summaryText,
      `Type: ${meetingType}`,
      relatedProjects.length
        ? `Projects: ${relatedProjects.join("; ")}`
        : "",
      openLoops.length ? `Open loops: ${openLoops.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1600);
    return {
      content,
      topics: topics.length ? topics : fallbackTopics,
      meetingType,
      relatedProjects,
      openLoops,
      model,
    };
  } catch (err) {
    console.warn(
      "[calendar-event] LLM failed; stub:",
      err instanceof Error ? err.message : err,
    );
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      meetingType: "meeting",
      relatedProjects: [],
      openLoops: [],
      model: "cortex-calendar-digest-stub",
    };
  }
}

export const calendarEventAdapter: SourceAdapter = {
  id: "calendar-event",
  kind: "calendar_event_digest",
  domainDefault: "work",
  grain: "kept meeting (allowlist or ≥2 attendees; no gym/focus)",
  cadence: "nightly",
  evaluationQuestions: [
    "Which meetings this week relate to DocMap/Cortex?",
    "Where did calendar time diverge from session effort?",
  ],
  async run(ctx) {
    const maxItems = Math.max(1, Math.min(ctx.limit ?? 15, 100));
    const until = new Date().toISOString();
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const records = await ctx.store.listRecordsByTypeInRange(
      "calendar_event",
      since,
      until,
      1000,
    );
    const kept = records
      .filter(isKeptMeeting)
      .sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))
      .slice(0, maxItems);

    const existing = ctx.force
      ? new Map()
      : await loadExistingBySubject(
          ctx.store,
          "calendar_event_digest",
          CALENDAR_EVENT_COMPILER,
        );

    const distillates: DistillateRow[] = [];
    let written = 0;
    let skipped = 0;

    for (const r of kept) {
      const fingerprint = sourceFingerprint([r]);
      const subjectId = r.id;
      if (shouldSkipSubject(existing, subjectId, fingerprint, ctx.force)) {
        skipped += 1;
        continue;
      }
      const compiled = await compileCalendarEvent(r);
      const row = await upsertDigest({
        store: ctx.store,
        dryRun: Boolean(ctx.dryRun),
        subjectType: "calendar_event",
        subjectId,
        kind: this.kind,
        content: compiled.content,
        domains: ["work"],
        sourceType: "calendar",
        topics: compiled.topics,
        evidenceRefs: [{ type: "record", id: r.id }],
        compilerVersion: CALENDAR_EVENT_COMPILER,
        sourceFingerprint: fingerprint,
        model: compiled.model,
        extraMeta: {
          meetingType: compiled.meetingType,
          relatedProjects: compiled.relatedProjects,
          openLoops: compiled.openLoops,
          summary: String(r.payload.summary ?? r.payload.title ?? ""),
        },
      });
      distillates.push(row);
      written += 1;
    }

    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: records.length,
      written,
      skipped: skipped + (records.length - kept.length),
      distillates,
    };
  },
};

// ─── drive-file-v2 ───────────────────────────────────────────────────────────

const DRIVE_FILE_COMPILER = "drive-file-v2";

const DEFAULT_SENSITIVE_PATH_SUBSTR = [
  "password",
  "passwords",
  "credentials",
  "secrets",
  "private",
  "tax",
  "passport",
  "bank",
  "ssn",
  "identity",
  "2fa",
  "recovery codes",
];

const SENSITIVE_FILENAME_RE =
  /\b(password|passwd|credential|secret|api[_-]?keys?|private[_-]?key|recovery|otp|pin|passport|national.?id|ni.?number|driving.?licen[cs]e|birth.?cert|medical.?record)\b/i;

const PII_HEURISTIC_RE =
  /\bpassword\s*[:=]|iban\b|\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b|\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/i;

export type DriveSensitiveReason =
  | "path"
  | "filename"
  | "secret_pattern"
  | "pii_heuristic"
  | "allowlist";

export function driveSensitiveReasons(r: RecordHit): DriveSensitiveReason[] {
  const reasons: DriveSensitiveReason[] = [];
  const name = String(r.payload.name ?? r.payload.title ?? "");
  const path = String(
    r.payload.folderPath ??
      r.payload.path ??
      r.payload.parentsPath ??
      r.payload.fullPath ??
      "",
  );
  const haystack = `${path} ${name}`.toLowerCase();

  const denylist = (
    process.env.CORTEX_DRIVE_SENSITIVE_PATHS?.trim()
      ? process.env.CORTEX_DRIVE_SENSITIVE_PATHS.split(",")
      : DEFAULT_SENSITIVE_PATH_SUBSTR
  ).map((s) => s.trim().toLowerCase()).filter(Boolean);

  for (const needle of denylist) {
    if (needle && haystack.includes(needle)) {
      reasons.push("path");
      break;
    }
  }
  if (SENSITIVE_FILENAME_RE.test(name)) {
    reasons.push("filename");
  }

  const preview = String(
    r.payload.textPreview ?? r.payload.exportText ?? r.payload.content ?? "",
  );
  if (preview) {
    const secrets = redactText(preview);
    if (secrets.redacted) reasons.push("secret_pattern");
    if (PII_HEURISTIC_RE.test(preview)) reasons.push("pii_heuristic");
  }

  const allowRaw = process.env.CORTEX_DRIVE_DISTILL_ALLOW?.trim();
  if (allowRaw) {
    const allows = allowRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const pathOk = allows.some(
      (a) =>
        path.includes(a) ||
        name.includes(a) ||
        String(r.payload.parents ?? "").includes(a),
    );
    if (!pathOk) reasons.push("allowlist");
  }

  return reasons;
}

function isHighSignalDriveFile(r: RecordHit): boolean {
  const name = String(r.payload.name ?? "");
  if (!name.trim()) return false;
  if (/\.tmp$/i.test(name) || /^copy of /i.test(name)) return false;
  if (r.payload.trashed === true) return false;
  const mime = String(r.payload.mimeType ?? r.payload.mime ?? "");
  const docLike =
    /document|markdown|pdf|text\/plain|msword|officedocument\.wordprocessing|application\/pdf/i.test(
      mime,
    ) || /\.(md|docx?|pdf|txt|gdoc)$/i.test(name);
  if (!docLike && mime && /spreadsheet|sheet|image\//i.test(mime)) return false;
  const preview = String(
    r.payload.textPreview ?? r.payload.exportText ?? "",
  ).trim();
  if (!preview) return false;
  return true;
}

async function compileDriveFile(r: RecordHit): Promise<{
  content: string;
  topics: string[];
  docRole: string;
  decisions: string[];
  model: string;
}> {
  const name = String(r.payload.name ?? r.sourceRecordId);
  const preview = String(
    r.payload.textPreview ?? r.payload.exportText ?? "",
  ).slice(0, 1200);
  const fallbackContent = `Drive file: ${name}. ${preview}`.slice(0, 1200);
  const fallbackTopics = [
    normalizeTopic(name.split(/[.\s_-]+/).slice(0, 4).join(" ")),
  ].filter(Boolean);

  if (!openaiConfigured()) {
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      docRole: "other",
      decisions: [],
      model: "cortex-drive-digest-stub",
    };
  }

  try {
    const { text, model } = await chatJsonCompletion({
      system: `You distill a Drive document into personal memory JSON.
Return ONLY JSON: {
  "summary": string,
  "docRole": "spec" | "brief" | "notes" | "other",
  "topics": string[],
  "decisions": string[],
  "confidence": number
}
Rules:
- Only use facts present in the preview. Do not invent decisions.
- summary under 400 chars.`,
      user: `Name: ${name}\nMime: ${String(r.payload.mimeType ?? "")}\nPreview:\n${preview}`.slice(
        0,
        6000,
      ),
      model: distillateModel(),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallbackContent;
    const docRoleRaw = String(parsed.docRole ?? "other").toLowerCase();
    const docRole = (
      ["spec", "brief", "notes", "other"] as const
    ).includes(docRoleRaw as "spec")
      ? docRoleRaw
      : "other";
    const decisions = asStrings(parsed.decisions).slice(0, 8);
    const topics = asStrings(parsed.topics)
      .map((t) => normalizeTopic(t))
      .filter(Boolean)
      .slice(0, 6);
    const content = [
      summary,
      `Role: ${docRole}`,
      decisions.length ? `Decisions: ${decisions.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1600);
    return {
      content,
      topics: topics.length ? topics : fallbackTopics,
      docRole,
      decisions,
      model,
    };
  } catch (err) {
    console.warn(
      "[drive-file] LLM failed; stub:",
      err instanceof Error ? err.message : err,
    );
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      docRole: "other",
      decisions: [],
      model: "cortex-drive-digest-stub",
    };
  }
}

export const driveFileAdapter: SourceAdapter = {
  id: "drive-file",
  kind: "drive_file_digest",
  domainDefault: "work",
  grain: "high-signal Drive doc (specs/briefs) after sensitivity gate",
  cadence: "nightly",
  evaluationQuestions: [
    "What docs did I revise while working on DocMap/Cortex?",
  ],
  async run(ctx) {
    const maxItems = Math.max(1, Math.min(ctx.limit ?? 15, 80));
    const until = new Date().toISOString();
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    const records = await ctx.store.listRecordsByTypeInRange(
      "drive_file",
      since,
      until,
      1000,
    );

    const sensitiveReasons: Record<string, number> = {};
    let skippedSensitive = 0;
    const candidates: RecordHit[] = [];
    for (const r of records) {
      if (!isHighSignalDriveFile(r)) continue;
      const reasons = driveSensitiveReasons(r);
      if (reasons.length) {
        skippedSensitive += 1;
        for (const reason of reasons) {
          sensitiveReasons[reason] = (sensitiveReasons[reason] ?? 0) + 1;
        }
        continue;
      }
      candidates.push(r);
    }

    const kept = candidates
      .sort((a, b) => {
        const am = String(
          a.payload.modifiedTime ?? a.occurredAt ?? "",
        );
        const bm = String(
          b.payload.modifiedTime ?? b.occurredAt ?? "",
        );
        return bm.localeCompare(am);
      })
      .slice(0, maxItems);

    const existing = ctx.force
      ? new Map()
      : await loadExistingBySubject(
          ctx.store,
          "drive_file_digest",
          DRIVE_FILE_COMPILER,
        );

    const distillates: DistillateRow[] = [];
    let written = 0;
    let skipped = 0;

    for (const r of kept) {
      const fingerprint = sourceFingerprint([
        {
          sourceRecordId: r.sourceRecordId,
          occurredAt: String(
            r.payload.modifiedTime ?? r.occurredAt ?? "",
          ),
        },
      ]);
      const subjectId = r.id;
      if (shouldSkipSubject(existing, subjectId, fingerprint, ctx.force)) {
        skipped += 1;
        continue;
      }
      const compiled = await compileDriveFile(r);
      const row = await upsertDigest({
        store: ctx.store,
        dryRun: Boolean(ctx.dryRun),
        subjectType: "drive_file",
        subjectId,
        kind: this.kind,
        content: compiled.content,
        domains: ["work", "reference"],
        sourceType: "drive",
        topics: compiled.topics,
        evidenceRefs: [{ type: "record", id: r.id }],
        compilerVersion: DRIVE_FILE_COMPILER,
        sourceFingerprint: fingerprint,
        model: compiled.model,
        extraMeta: {
          docRole: compiled.docRole,
          decisions: compiled.decisions,
          name: String(r.payload.name ?? ""),
        },
      });
      distillates.push(row);
      written += 1;
    }

    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: records.length,
      written,
      skipped: skipped + (records.length - candidates.length - skippedSensitive),
      skippedSensitive,
      sensitiveReasons,
      distillates,
    };
  },
};

// ─── browser-interest-v2 ─────────────────────────────────────────────────────

const BROWSER_INTEREST_COMPILER = "browser-interest-v2";

function browserTerm(r: RecordHit): string {
  return String(
    r.payload.normalizedTerm ??
      r.payload.query ??
      r.payload.name ??
      r.payload.title ??
      "",
  ).trim();
}

function isNoisyBrowserTerm(term: string): boolean {
  if (!term || term.length <= 1) return true;
  if (/^(facebook|gmail|youtube|login|maps|google|bing)$/i.test(term)) {
    return true;
  }
  // Navigational single-token URLs / hosts
  if (/^[a-z0-9.-]+\.(com|org|net|io|dev)$/i.test(term)) return true;
  return false;
}

async function compileBrowserWeek(
  weekKey: string,
  items: RecordHit[],
  terms: string[],
): Promise<{
  content: string;
  topics: string[];
  themes: string[];
  recurring: string[];
  oneOff: string[];
  model: string;
}> {
  const counts = new Map<string, number>();
  for (const t of terms) {
    const key = t.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const recurring = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([t]) => t)
    .slice(0, 12);
  const oneOff = [...counts.entries()]
    .filter(([, n]) => n === 1)
    .map(([t]) => t)
    .slice(0, 12);
  const fallbackContent =
    `Browser week ${weekKey}: ${items.length} bookmarks/searches. Themes: ${terms.slice(0, 12).join("; ")}`.slice(
      0,
      1200,
    );
  const fallbackTopics = terms
    .slice(0, 8)
    .map((t) => normalizeTopic(t.split(/\s+/).slice(0, 3).join(" ")))
    .filter(Boolean);

  if (!openaiConfigured()) {
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      themes: terms.slice(0, 8),
      recurring,
      oneOff,
      model: "cortex-browser-digest-stub",
    };
  }

  try {
    const { text, model } = await chatJsonCompletion({
      system: `You distill a week of browser bookmarks/searches into reflective interest JSON.
Return ONLY JSON: {
  "summary": string,
  "themes": string[],
  "recurring": string[],
  "oneOff": string[],
  "topics": string[],
  "confidence": number
}
Rules:
- This is research interest, not identity. Do not pathologize.
- Prefer themes over raw URL dumps. summary under 400 chars.`,
      user: `Week ${weekKey}\nTerms (${terms.length}):\n${terms.slice(0, 40).join("\n")}`.slice(
        0,
        6000,
      ),
      model: distillateModel(),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallbackContent;
    const themes = asStrings(parsed.themes).slice(0, 10);
    const recurringOut = asStrings(parsed.recurring).slice(0, 10);
    const oneOffOut = asStrings(parsed.oneOff).slice(0, 10);
    const topics = asStrings(parsed.topics)
      .map((t) => normalizeTopic(t))
      .filter(Boolean)
      .slice(0, 8);
    const content = [
      summary,
      themes.length ? `Themes: ${themes.join("; ")}` : "",
      recurringOut.length ? `Recurring: ${recurringOut.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1600);
    return {
      content,
      topics: topics.length ? topics : fallbackTopics,
      themes: themes.length ? themes : terms.slice(0, 8),
      recurring: recurringOut.length ? recurringOut : recurring,
      oneOff: oneOffOut.length ? oneOffOut : oneOff,
      model,
    };
  } catch (err) {
    console.warn(
      "[browser-interest] LLM failed; stub:",
      err instanceof Error ? err.message : err,
    );
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      themes: terms.slice(0, 8),
      recurring,
      oneOff,
      model: "cortex-browser-digest-stub",
    };
  }
}

export const browserInterestAdapter: SourceAdapter = {
  id: "browser-interest",
  kind: "browser_interest_digest",
  domainDefault: "interest",
  grain: "one digest per ISO week (bookmarks + search_query)",
  cadence: "weekly",
  evaluationQuestions: [
    "What research themes appear in browser searches that never became coding sessions?",
  ],
  async run(ctx) {
    const weekKey = ctx.weekKey ?? isoWeekKey();
    const { start, end } = weekRange(weekKey);
    const limit = Math.max(50, Math.min(ctx.limit ?? 200, 500));
    const [bookmarks, searches] = await Promise.all([
      ctx.store.listRecordsByTypeInRange("bookmark", start, end, limit),
      ctx.store.listRecordsByTypeInRange("search_query", start, end, limit),
    ]);
    const items = [...bookmarks, ...searches].filter((r) =>
      inWeek(r.occurredAt, start, end),
    );
    if (items.length === 0) {
      return {
        adapter: this.id,
        dryRun: Boolean(ctx.dryRun),
        scanned: 0,
        written: 0,
        skipped: 1,
        distillates: [],
      };
    }

    const terms = items
      .map(browserTerm)
      .filter((t) => !isNoisyBrowserTerm(t));
    const fingerprint = sourceFingerprint(items);
    const subjectId = stableSubjectUuid("browser-week", weekKey);
    const existing = ctx.force
      ? new Map()
      : await loadExistingBySubject(
          ctx.store,
          "browser_interest_digest",
          BROWSER_INTEREST_COMPILER,
          40,
        );
    if (shouldSkipSubject(existing, subjectId, fingerprint, ctx.force)) {
      return {
        adapter: this.id,
        dryRun: Boolean(ctx.dryRun),
        scanned: items.length,
        written: 0,
        skipped: 1,
        distillates: [],
      };
    }

    const compiled = await compileBrowserWeek(weekKey, items, terms);
    const row = await upsertDigest({
      store: ctx.store,
      dryRun: Boolean(ctx.dryRun),
      subjectType: "week",
      subjectId,
      kind: this.kind,
      content: compiled.content,
      domains: ["interest", "reference"],
      sourceType: "browser",
      topics: compiled.topics,
      evidenceRefs: items.slice(0, 40).map((r) => ({ type: "record", id: r.id })),
      compilerVersion: BROWSER_INTEREST_COMPILER,
      sourceFingerprint: fingerprint,
      model: compiled.model,
      extraMeta: {
        weekKey,
        itemCount: items.length,
        themes: compiled.themes,
        recurring: compiled.recurring,
        oneOff: compiled.oneOff,
      },
    });
    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: items.length,
      written: 1,
      skipped: 0,
      distillates: [row],
    };
  },
};

// ─── spotify-interest-v2 ─────────────────────────────────────────────────────

const SPOTIFY_INTEREST_COMPILER = "spotify-interest-v2";

function spotifyArtistNames(r: RecordHit): string[] {
  const artists = r.payload.artists;
  if (Array.isArray(artists)) {
    return artists
      .map((a) => {
        if (typeof a === "string") return a;
        if (a && typeof a === "object" && "name" in a) {
          return String((a as { name: unknown }).name ?? "");
        }
        return "";
      })
      .filter(Boolean);
  }
  const show = String(r.payload.showName ?? r.payload.show ?? "");
  if (show) return [show];
  const name = String(r.payload.name ?? r.payload.trackName ?? "");
  return name ? [name] : [];
}

async function compileSpotifyWeek(
  weekKey: string,
  items: RecordHit[],
  recurring: string[],
): Promise<{
  content: string;
  topics: string[];
  themes: string[];
  recurring: string[];
  model: string;
}> {
  const fallbackContent =
    `Spotify week ${weekKey}: ${items.length} plays/episodes. Recurring: ${recurring.slice(0, 8).join(", ") || "none"}`.slice(
      0,
      1200,
    );
  const fallbackTopics = recurring.slice(0, 8).map(normalizeTopic).filter(Boolean);

  if (!openaiConfigured()) {
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      themes: recurring.slice(0, 6),
      recurring,
      model: "cortex-spotify-digest-stub",
    };
  }

  try {
    const { text, model } = await chatJsonCompletion({
      system: `You distill a week of Spotify listening into reflective interest JSON.
Return ONLY JSON: {
  "summary": string,
  "recurring": string[],
  "themes": string[],
  "topics": string[],
  "confidence": number
}
Rules:
- Reflective only — do not claim identity from one-off plays.
- Prefer recurring artists/shows. summary under 400 chars.`,
      user: `Week ${weekKey}\nItem count: ${items.length}\nRecurring artists/shows: ${recurring.join(", ")}\nSample: ${items
        .slice(0, 20)
        .map((r) => String(r.payload.name ?? r.payload.title ?? r.sourceRecordId))
        .join("; ")}`.slice(0, 6000),
      model: distillateModel(),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallbackContent;
    const recurringOut = asStrings(parsed.recurring).slice(0, 12);
    const themes = asStrings(parsed.themes).slice(0, 10);
    const topics = asStrings(parsed.topics)
      .map((t) => normalizeTopic(t))
      .filter(Boolean)
      .slice(0, 8);
    const content = [
      summary,
      recurringOut.length
        ? `Recurring: ${recurringOut.join("; ")}`
        : `Recurring: ${recurring.slice(0, 8).join("; ") || "none"}`,
      themes.length ? `Themes: ${themes.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1600);
    return {
      content,
      topics: topics.length ? topics : fallbackTopics,
      themes,
      recurring: recurringOut.length ? recurringOut : recurring,
      model,
    };
  } catch (err) {
    console.warn(
      "[spotify-interest] LLM failed; stub:",
      err instanceof Error ? err.message : err,
    );
    return {
      content: fallbackContent,
      topics: fallbackTopics,
      themes: recurring.slice(0, 6),
      recurring,
      model: "cortex-spotify-digest-stub",
    };
  }
}

export const spotifyInterestAdapter: SourceAdapter = {
  id: "spotify-interest",
  kind: "spotify_interest_digest",
  domainDefault: "interest",
  grain: "one digest per ISO week of plays/episodes",
  cadence: "weekly",
  evaluationQuestions: [
    "What listening themes recur alongside my coding interests?",
  ],
  async run(ctx) {
    const weekKey = ctx.weekKey ?? isoWeekKey();
    const { start, end } = weekRange(weekKey);
    const limit = Math.max(50, Math.min(ctx.limit ?? 200, 500));
    const [plays, episodes] = await Promise.all([
      ctx.store.listRecordsByTypeInRange("spotify_play", start, end, limit),
      ctx.store.listRecordsByTypeInRange("spotify_episode", start, end, limit),
    ]);
    const items = [...plays, ...episodes].filter((r) => {
      const playedAt = String(r.payload.playedAt ?? r.occurredAt ?? "");
      return inWeek(playedAt || r.occurredAt, start, end);
    });
    if (items.length === 0) {
      return {
        adapter: this.id,
        dryRun: Boolean(ctx.dryRun),
        scanned: 0,
        written: 0,
        skipped: 1,
        distillates: [],
      };
    }

    const artists = new Map<string, number>();
    for (const r of items) {
      for (const a of spotifyArtistNames(r)) {
        artists.set(a, (artists.get(a) ?? 0) + 1);
      }
    }
    const recurring = [...artists.entries()]
      .filter(([, n]) => n > 1)
      .map(([a]) => a);

    const fingerprint = sourceFingerprint(
      items.map((r) => ({
        sourceRecordId: r.sourceRecordId,
        occurredAt: String(r.payload.playedAt ?? r.occurredAt ?? ""),
      })),
    );
    const subjectId = stableSubjectUuid("spotify-week", weekKey);
    const existing = ctx.force
      ? new Map()
      : await loadExistingBySubject(
          ctx.store,
          "spotify_interest_digest",
          SPOTIFY_INTEREST_COMPILER,
          40,
        );
    if (shouldSkipSubject(existing, subjectId, fingerprint, ctx.force)) {
      return {
        adapter: this.id,
        dryRun: Boolean(ctx.dryRun),
        scanned: items.length,
        written: 0,
        skipped: 1,
        distillates: [],
      };
    }

    const compiled = await compileSpotifyWeek(weekKey, items, recurring);
    const row = await upsertDigest({
      store: ctx.store,
      dryRun: Boolean(ctx.dryRun),
      subjectType: "week",
      subjectId,
      kind: this.kind,
      content: compiled.content,
      domains: ["interest"],
      sourceType: "spotify",
      topics: compiled.topics,
      evidenceRefs: items.slice(0, 40).map((r) => ({ type: "record", id: r.id })),
      compilerVersion: SPOTIFY_INTEREST_COMPILER,
      sourceFingerprint: fingerprint,
      model: compiled.model,
      extraMeta: {
        weekKey,
        itemCount: items.length,
        recurring: compiled.recurring,
        themes: compiled.themes,
      },
    });
    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: items.length,
      written: 1,
      skipped: 0,
      distillates: [row],
    };
  },
};

// ─── youtube-interest (wave-0 peer wrapper) ───────────────────────────────────

export const youtubeInterestAdapter: SourceAdapter = {
  id: "youtube-interest",
  kind: "youtube_interest_digest",
  domainDefault: "interest",
  grain: "one digest per ISO week of watches/videos (prefer Takeout watches)",
  cadence: "weekly",
  evaluationQuestions: [
    "What YouTube channels or themes recurred in my watching this week?",
  ],
  async run(ctx) {
    const result = await runYoutubeInterestDigest(ctx.store, {
      dryRun: ctx.dryRun,
      weekKey: ctx.weekKey,
      limitRecords: ctx.limit ?? 500,
      force: ctx.force,
    });
    return {
      adapter: this.id,
      dryRun: result.dryRun,
      scanned: result.scanned,
      written: result.written,
      skipped: result.skipped,
      distillates: result.distillate ? [result.distillate] : [],
    };
  },
};

// ─── reading-interest-v1 (Calibre) ───────────────────────────────────────────

const READING_INTEREST_COMPILER = "reading-interest-v1";

function ebookTitle(r: RecordHit): string {
  return String(r.payload.title ?? r.sourceRecordId).trim();
}

function ebookAuthors(r: RecordHit): string[] {
  const a = r.payload.authors;
  if (Array.isArray(a)) {
    return a
      .map((x) => (typeof x === "string" ? x : String(x)))
      .filter((s) => s.trim().length > 0);
  }
  if (typeof a === "string" && a.trim()) return [a.trim()];
  return [];
}

function ebookTags(r: RecordHit): string[] {
  const t = r.payload.tags;
  if (!Array.isArray(t)) return [];
  return t
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const readingInterestAdapter: SourceAdapter = {
  id: "reading-interest",
  kind: "reading_interest_digest",
  domainDefault: "interest",
  grain: "one digest per ISO week (ebooks touched / added)",
  cadence: "weekly",
  evaluationQuestions: [
    "What reading themes recur outside active coding projects?",
  ],
  async run(ctx) {
    const weekKey = ctx.weekKey ?? isoWeekKey();
    const { start, end } = weekRange(weekKey);
    const limit = Math.max(20, Math.min(ctx.limit ?? 100, 300));
    // Prefer week-scoped; fall back to recent library slice for sparse Calibre dates.
    let items = await ctx.store.listRecordsByTypeInRange(
      "ebook",
      start,
      end,
      limit,
    );
    items = items.filter((r) => inWeek(r.occurredAt, start, end));
    if (items.length === 0) {
      const recent = await ctx.store.listRecordsByType("ebook", limit);
      items = recent.filter((r) => inWeek(r.occurredAt, start, end));
    }
    if (items.length === 0) {
      return {
        adapter: this.id,
        dryRun: Boolean(ctx.dryRun),
        scanned: 0,
        written: 0,
        skipped: 1,
        distillates: [],
      };
    }

    const fingerprint = sourceFingerprint(items);
    const subjectId = stableSubjectUuid("reading-week", weekKey);
    const existing = ctx.force
      ? new Map()
      : await loadExistingBySubject(
          ctx.store,
          "reading_interest_digest",
          READING_INTEREST_COMPILER,
          40,
        );
    if (shouldSkipSubject(existing, subjectId, fingerprint, ctx.force)) {
      return {
        adapter: this.id,
        dryRun: Boolean(ctx.dryRun),
        scanned: items.length,
        written: 0,
        skipped: 1,
        distillates: [],
      };
    }

    const titles = items.map(ebookTitle);
    const tags = items.flatMap(ebookTags);
    const authors = items.flatMap(ebookAuthors);
    const topicSeeds = [...tags, ...titles.map((t) => t.split(/[:\-–]/)[0] ?? t)]
      .map((t) => normalizeTopic(t))
      .filter(Boolean);
    const topicCounts = new Map<string, number>();
    for (const t of topicSeeds) {
      topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
    }
    const recurring = [...topicCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([t]) => t)
      .slice(0, 10);
    let topics = (
      recurring.length
        ? recurring
        : [...topicCounts.keys()].slice(0, 8)
    ).slice(0, 8);

    const fallbackContent =
      `Reading week ${weekKey}: ${items.length} ebook(s). Titles: ${titles.slice(0, 8).join("; ")}${authors.length ? `. Authors: ${[...new Set(authors)].slice(0, 6).join(", ")}` : ""}`.slice(
        0,
        1200,
      );

    let content = fallbackContent;
    let model = "cortex-reading-digest-stub";
    let confidence = 0.55;
    let recurringOut = recurring;
    let themes = tags.slice(0, 8);

    if (openaiConfigured()) {
      try {
        const { text, model: m } = await chatJsonCompletion({
          system: `You distill a week of ebook library activity into reflective interest JSON.
Return ONLY JSON: {
  "summary": string,
  "themes": string[],
  "recurring": string[],
  "topics": string[],
  "confidence": number
}
Rules:
- Reading ≠ identity. Prefer themes over title dumps. summary under 400 chars.`,
          user: `Week ${weekKey}\nTitles:\n${titles.slice(0, 30).join("\n")}\nTags: ${tags.slice(0, 20).join(", ")}\nAuthors: ${[...new Set(authors)].slice(0, 15).join(", ")}`.slice(
            0,
            6000,
          ),
          model: distillateModel(),
        });
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(text) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
        const summary =
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim()
            : fallbackContent;
        themes = asStrings(parsed.themes).slice(0, 10);
        recurringOut = asStrings(parsed.recurring).slice(0, 10);
        const llmTopics = asStrings(parsed.topics)
          .map((t) => normalizeTopic(t))
          .filter(Boolean)
          .slice(0, 8);
        if (llmTopics.length) topics = llmTopics;
        confidence =
          typeof parsed.confidence === "number" ? parsed.confidence : 0.6;
        content = [
          summary,
          themes.length ? `Themes: ${themes.join("; ")}` : "",
          recurringOut.length ? `Recurring: ${recurringOut.join("; ")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 1600);
        model = m;
      } catch (err) {
        console.warn(
          "[reading-interest] LLM failed; stub:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    const row = await upsertDigest({
      store: ctx.store,
      dryRun: Boolean(ctx.dryRun),
      subjectType: "week",
      subjectId,
      kind: "reading_interest_digest",
      content,
      domains: ["interest", "reference"],
      sourceType: "calibre",
      topics,
      evidenceRefs: items.slice(0, 40).map((r) => ({
        type: "record",
        id: r.id,
        recordType: r.recordType,
        sourceRecordId: r.sourceRecordId,
      })),
      compilerVersion: READING_INTEREST_COMPILER,
      sourceFingerprint: fingerprint,
      model,
      confidence,
      extraMeta: {
        weekKey,
        periodStart: start,
        periodEnd: end,
        itemCount: items.length,
        recurring: recurringOut,
        themes,
      },
    });

    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: items.length,
      written: ctx.dryRun ? 0 : 1,
      skipped: 0,
      distillates: [row],
    };
  },
};

export const SOURCE_ADAPTERS: SourceAdapter[] = [
  emailThreadAdapter,
  githubOutcomeAdapter,
  calendarEventAdapter,
  driveFileAdapter,
  browserInterestAdapter,
  spotifyInterestAdapter,
  readingInterestAdapter,
  youtubeInterestAdapter,
];

/** Adapters that may run on the nightly twin-pipeline leg. */
export const NIGHTLY_ADAPTER_IDS = [
  "email-thread",
  "github-outcome",
  "calendar-event",
  "drive-file",
] as const;

/** Adapters that may run on the weekly twin-pipeline leg. */
export const WEEKLY_ADAPTER_IDS = [
  "browser-interest",
  "spotify-interest",
  "reading-interest",
] as const;

/**
 * Parse CORTEX_SOURCE_ADAPTERS enablement list.
 * Default: accepted post-gate adapters (email → github → calendar → drive →
 * browser → spotify → reading). Override with env; set "none" to disable all.
 */
export function enabledSourceAdapters(): string[] {
  const raw = process.env.CORTEX_SOURCE_ADAPTERS;
  if (raw === undefined) {
    return [
      "email-thread",
      "github-outcome",
      "calendar-event",
      "drive-file",
      "browser-interest",
      "spotify-interest",
      "reading-interest",
    ];
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return [];
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runSourceAdapter(
  store: CortexStore,
  adapterId: string,
  options: {
    dryRun?: boolean;
    limit?: number;
    force?: boolean;
    weekKey?: string;
  } = {},
): Promise<SourceAdapterResult> {
  const adapter = SOURCE_ADAPTERS.find((a) => a.id === adapterId);
  if (!adapter) {
    throw new Error(
      `Unknown adapter ${adapterId}. Known: ${SOURCE_ADAPTERS.map((a) => a.id).join(", ")}`,
    );
  }
  return adapter.run({
    store,
    dryRun: options.dryRun,
    limit: options.limit,
    force: options.force,
    weekKey: options.weekKey,
  });
}

/** Optional LLM polish for adapters that want it later. */
export async function polishDigestWithLlm(
  system: string,
  user: string,
): Promise<{ text: string; model: string } | null> {
  if (!openaiConfigured()) return null;
  try {
    return await chatJsonCompletion({
      system,
      user,
      model: distillateModel(),
    });
  } catch {
    return null;
  }
}

export type { RecordHit };
