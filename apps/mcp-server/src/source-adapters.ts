/**
 * Shared source-adapter contract for post-quality-gate distillate compilers.
 * V1 ships YouTube fully; other adapters are implemented behind the same interface.
 */
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

export type SourceDomain = "work" | "interest" | "personal" | "reference";

export interface SourceAdapterContext {
  store: CortexStore;
  dryRun?: boolean;
  force?: boolean;
  limit?: number;
}

export interface SourceAdapterResult {
  adapter: string;
  dryRun: boolean;
  scanned: number;
  written: number;
  skipped: number;
  distillates: DistillateRow[];
}

export interface SourceAdapter {
  id: string;
  kind: string;
  domainDefault: SourceDomain;
  grain: string;
  evaluationQuestions: string[];
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

function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
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
  extraMeta?: Record<string, unknown>;
  model: string;
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
      confidence: 0.65,
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
  // App/product notification shells (not conversational threads)
  if (
    /unread messages waiting|you have \d+\s+(new\s+)?messages|new notification/i.test(
      subject,
    )
  ) {
    return true;
  }
  // Pure marketing / jobs blasts without conversation
  if (
    labels.includes("CATEGORY_UPDATES") &&
    !labels.includes("IMPORTANT") &&
    !labels.includes("STARRED")
  ) {
    return true;
  }
  return false;
}

function latestOccurredAt(msgs: RecordHit[]): string {
  let best = "";
  for (const m of msgs) {
    const t = m.occurredAt ?? "";
    if (t > best) best = t;
  }
  return best;
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
    const asStrings = (v: unknown): string[] =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            .map((s) => s.trim())
        : [];
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

/** Email thread digest adapter — multi-message threads only. */
export const emailThreadAdapter: SourceAdapter = {
  id: "email-thread",
  kind: "email_thread_digest",
  domainDefault: "work",
  grain: "gmail thread (≥2 messages): commitments + open loops",
  evaluationQuestions: [
    "What commitments did email create this week?",
    "Which email threads relate to active Cortex or DocMap work?",
    "What open loops am I carrying in email?",
  ],
  async run(ctx) {
    const maxThreads = Math.max(1, Math.min(ctx.limit ?? 8, 20));
    // Pull recent messages (store caps at 100) then group into threads.
    const records = await ctx.store.listRecordsByType("email_message", 100);
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
      }))
      .filter((t) => t.msgs.length >= 2)
      .sort((a, b) => b.latest.localeCompare(a.latest))
      .slice(0, maxThreads);

    const existing = ctx.force
      ? []
      : await ctx.store.listDistillates({
          limit: 80,
          kinds: ["email_thread_digest"],
        });
    const existingBySubject = new Set(
      existing
        .filter((d) => d.metadata.compilerVersion === EMAIL_THREAD_COMPILER)
        .map((d) => d.subjectId),
    );

    const distillates: DistillateRow[] = [];
    let written = 0;
    let skipped = 0;

    for (const { threadId, msgs } of threads) {
      const subjectId = stableSubjectUuid("email-thread", threadId);
      if (!ctx.force && existingBySubject.has(subjectId)) {
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

/** Calendar work-unit adapter with noise exclusions. */
export const calendarEventAdapter: SourceAdapter = {
  id: "calendar-event",
  kind: "calendar_event_digest",
  domainDefault: "work",
  grain: "non-noisy calendar event",
  evaluationQuestions: [
    "Which meetings this week relate to Cortex?",
    "Where did calendar time diverge from session effort?",
  ],
  async run(ctx) {
    const records = await ctx.store.listRecordsByType("calendar_event", ctx.limit ?? 60);
    const noisy =
      /\b(gym|workout|focus|block|reminder|lunch|commute|personal care)\b/i;
    const kept = records.filter((r) => {
      const summary = String(r.payload.summary ?? r.payload.title ?? "");
      if (noisy.test(summary)) return false;
      if (r.payload.recurringEventId && !/1:1|sync|review|interview/i.test(summary)) {
        return false;
      }
      return Boolean(summary.trim());
    });
    const distillates: DistillateRow[] = [];
    let written = 0;
    for (const r of kept.slice(0, 20)) {
      const summary = String(r.payload.summary ?? r.payload.title ?? r.sourceRecordId);
      const content = `Calendar: ${summary}. start=${r.payload.start ?? r.occurredAt ?? ""} end=${r.payload.end ?? ""}`;
      const row = await upsertDigest({
        store: ctx.store,
        dryRun: Boolean(ctx.dryRun),
        subjectType: "calendar_event",
        subjectId: r.id,
        kind: this.kind,
        content,
        domains: ["work"],
        sourceType: "calendar",
        topics: [normalizeTopic(summary.split(/\s+/).slice(0, 4).join(" "))].filter(Boolean),
        evidenceRefs: [{ type: "record", id: r.id }],
        compilerVersion: "calendar-event-v1",
        model: "cortex-calendar-digest-stub",
      });
      distillates.push(row);
      written += ctx.dryRun ? 0 : 1;
    }
    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: records.length,
      written,
      skipped: records.length - kept.length,
      distillates,
    };
  },
};

/** GitHub outcome adapter. */
export const githubOutcomeAdapter: SourceAdapter = {
  id: "github-outcome",
  kind: "github_outcome_digest",
  domainDefault: "work",
  grain: "PR/issue or weekly repo rollup",
  evaluationQuestions: [
    "Which session next-actions later shipped on GitHub?",
    "What PRs stalled this month?",
  ],
  async run(ctx) {
    const [prs, issues] = await Promise.all([
      ctx.store.listRecordsByType("github_pr", ctx.limit ?? 40),
      ctx.store.listRecordsByType("github_issue", ctx.limit ?? 40),
    ]);
    const items = [...prs, ...issues].filter((r) => {
      const user = String(r.payload.userLogin ?? "");
      if (/bot|dependabot|renovate/i.test(user)) return false;
      return true;
    });
    const distillates: DistillateRow[] = [];
    let written = 0;
    for (const r of items.slice(0, 20)) {
      const title = String(r.payload.title ?? r.sourceRecordId);
      const state = String(r.payload.state ?? "unknown");
      const repo = String(r.payload.repoFullName ?? "");
      const outcome =
        state === "closed" || r.payload.mergedAt ? "shipped_or_closed" : "open";
      const content = `GitHub ${r.recordType} ${repo}#${r.payload.number ?? ""}: ${title} [${state}/${outcome}]`;
      const row = await upsertDigest({
        store: ctx.store,
        dryRun: Boolean(ctx.dryRun),
        subjectType: "github",
        subjectId: r.id,
        kind: this.kind,
        content,
        domains: ["work"],
        sourceType: "github",
        topics: [normalizeTopic(repo), normalizeTopic(title.split(/\s+/).slice(0, 3).join(" "))]
          .filter(Boolean),
        evidenceRefs: [{ type: "record", id: r.id }],
        compilerVersion: "github-outcome-v1",
        model: "cortex-github-digest-stub",
        extraMeta: { outcome, state, repo },
      });
      distillates.push(row);
      written += ctx.dryRun ? 0 : 1;
    }
    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: items.length,
      written,
      skipped: 0,
      distillates,
    };
  },
};

/** Spotify weekly interest digest. */
export const spotifyInterestAdapter: SourceAdapter = {
  id: "spotify-interest",
  kind: "spotify_interest_digest",
  domainDefault: "interest",
  grain: "weekly artist/show cluster",
  evaluationQuestions: [
    "What listening themes recur alongside my coding interests?",
  ],
  async run(ctx) {
    const weekKey = isoWeekKey();
    const [plays, episodes] = await Promise.all([
      ctx.store.listRecordsByType("spotify_play", ctx.limit ?? 80),
      ctx.store.listRecordsByType("spotify_episode", ctx.limit ?? 40),
    ]);
    const items = [...plays, ...episodes];
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
      const list = Array.isArray(r.payload.artists)
        ? r.payload.artists.map(String)
        : [String(r.payload.name ?? "unknown")];
      for (const a of list) artists.set(a, (artists.get(a) ?? 0) + 1);
    }
    const recurring = [...artists.entries()].filter(([, n]) => n > 1).map(([a]) => a);
    const content = `Spotify week ${weekKey}: ${items.length} plays/episodes. Recurring: ${recurring.slice(0, 8).join(", ") || "none"}.`;
    const topics = recurring.slice(0, 8).map(normalizeTopic).filter(Boolean);
    const row = await upsertDigest({
      store: ctx.store,
      dryRun: Boolean(ctx.dryRun),
      subjectType: "week",
      subjectId: stableSubjectUuid("spotify-week", weekKey),
      kind: this.kind,
      content,
      domains: ["interest"],
      sourceType: "spotify",
      topics,
      evidenceRefs: items.slice(0, 40).map((r) => ({ type: "record", id: r.id })),
      compilerVersion: "spotify-interest-v1",
      model: "cortex-spotify-digest-stub",
      extraMeta: { weekKey, itemCount: items.length, recurring },
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

/** Drive reference card adapter. */
export const driveFileAdapter: SourceAdapter = {
  id: "drive-file",
  kind: "drive_file_digest",
  domainDefault: "work",
  grain: "high-signal drive file",
  evaluationQuestions: [
    "What docs did I revise while working on Cortex?",
  ],
  async run(ctx) {
    const records = await ctx.store.listRecordsByType("drive_file", ctx.limit ?? 40);
    const kept = records.filter((r) => {
      const name = String(r.payload.name ?? "");
      if (!name || /\.tmp$|copy of /i.test(name)) return false;
      return true;
    });
    const distillates: DistillateRow[] = [];
    let written = 0;
    for (const r of kept.slice(0, 15)) {
      const name = String(r.payload.name ?? r.sourceRecordId);
      const preview = String(r.payload.textPreview ?? "").slice(0, 240);
      const content = `Drive file: ${name}. ${preview}`;
      const row = await upsertDigest({
        store: ctx.store,
        dryRun: Boolean(ctx.dryRun),
        subjectType: "drive_file",
        subjectId: r.id,
        kind: this.kind,
        content,
        domains: ["work", "reference"],
        sourceType: "drive",
        topics: [normalizeTopic(name.split(/[.\s]+/).slice(0, 4).join(" "))].filter(Boolean),
        evidenceRefs: [{ type: "record", id: r.id }],
        compilerVersion: "drive-file-v1",
        model: "cortex-drive-digest-stub",
      });
      distillates.push(row);
      written += ctx.dryRun ? 0 : 1;
    }
    return {
      adapter: this.id,
      dryRun: Boolean(ctx.dryRun),
      scanned: records.length,
      written,
      skipped: records.length - kept.length,
      distillates,
    };
  },
};

/** Browser weekly theme digest (bookmarks + search queries only). */
export const browserInterestAdapter: SourceAdapter = {
  id: "browser-interest",
  kind: "browser_interest_digest",
  domainDefault: "interest",
  grain: "weekly bookmark/search theme cluster",
  evaluationQuestions: [
    "What research themes appear in my browser searches that never became coding sessions?",
  ],
  async run(ctx) {
    const weekKey = isoWeekKey();
    const [bookmarks, searches] = await Promise.all([
      ctx.store.listRecordsByType("bookmark", ctx.limit ?? 60),
      ctx.store.listRecordsByType("search_query", ctx.limit ?? 60),
    ]);
    const items = [...bookmarks, ...searches];
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
      .map((r) =>
        String(r.payload.normalizedTerm ?? r.payload.name ?? r.payload.title ?? ""),
      )
      .filter((t) => t && !/^(facebook|gmail|youtube|login|maps)$/i.test(t));
    const content = `Browser week ${weekKey}: ${items.length} bookmarks/searches. Themes: ${terms.slice(0, 12).join("; ")}`;
    const topics = terms
      .slice(0, 8)
      .map((t) => normalizeTopic(t.split(/\s+/).slice(0, 3).join(" ")))
      .filter(Boolean);
    const row = await upsertDigest({
      store: ctx.store,
      dryRun: Boolean(ctx.dryRun),
      subjectType: "week",
      subjectId: stableSubjectUuid("browser-week", weekKey),
      kind: this.kind,
      content,
      domains: ["interest", "reference"],
      sourceType: "browser",
      topics,
      evidenceRefs: items.slice(0, 40).map((r) => ({ type: "record", id: r.id })),
      compilerVersion: "browser-interest-v1",
      model: "cortex-browser-digest-stub",
      extraMeta: { weekKey, itemCount: items.length },
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
  calendarEventAdapter,
  githubOutcomeAdapter,
  spotifyInterestAdapter,
  driveFileAdapter,
  browserInterestAdapter,
];

export async function runSourceAdapter(
  store: CortexStore,
  adapterId: string,
  options: { dryRun?: boolean; limit?: number; force?: boolean } = {},
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
