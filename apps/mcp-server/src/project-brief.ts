/**
 * B3 project_brief + D1–D5 twin foundations.
 *
 * - seedEntitiesFromDistillates: D1 from metadata.projects[]
 * - runProjectBriefJob: roll up session summaries → project_brief
 * - runPriorityVsActual: week attribution distillate
 * - refreshSelfModel: hypotheses from D2/D3
 * - getAllocatorContext: 3h/3w/3y prompt seed (not a product)
 */
import { randomUUID } from "node:crypto";
import {
  chatJsonCompletion,
  embedTexts,
  openaiConfigured,
  distillateModel,
  embeddingModel,
} from "./llm.js";
import {
  projectKeysFromMetadata,
  slugifyKey,
} from "./store/search-helpers.js";
import type { CortexStore } from "./store/index.js";
import type { DistillateRow, EntityRow } from "./store/types.js";

export interface ProjectBriefRunOptions {
  limitSessions?: number;
  dryRun?: boolean;
  /** Project keys to force; otherwise inferred from distillate metadata.projects */
  projectKeys?: string[];
}

export interface ProjectBriefRunResult {
  mode: CortexStore["mode"];
  dryRun: boolean;
  projects: string[];
  written: number;
  briefs: DistillateRow[];
}

async function maybeEmbedContent(
  content: string,
): Promise<{ embedding: number[] | null; embeddingRef: string | null }> {
  if (!openaiConfigured() || !content.trim()) {
    return { embedding: null, embeddingRef: null };
  }
  try {
    const [vec] = await embedTexts([content]);
    if (!vec?.length) return { embedding: null, embeddingRef: null };
    return {
      embedding: vec,
      embeddingRef: `openai:${embeddingModel()}`,
    };
  } catch {
    return { embedding: null, embeddingRef: null };
  }
}

function displayNameFromKey(key: string): string {
  return key
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * D1: upsert project entities from session distillate metadata.projects[].
 */
export async function seedEntitiesFromDistillates(
  store: CortexStore,
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<{
  mode: CortexStore["mode"];
  dryRun: boolean;
  scanned: number;
  upserted: EntityRow[];
  linked: number;
}> {
  const dryRun = Boolean(options.dryRun);
  const summaries = await store.listDistillates({
    limit: options.limit ?? 80,
    kinds: ["summary"],
  });
  const byKey = new Map<
    string,
    { displayName: string; sessionIds: string[]; distillateIds: string[] }
  >();

  for (const d of summaries) {
    for (const raw of projectKeysFromMetadata(d.metadata)) {
      const key = slugifyKey(raw);
      if (!key) continue;
      const entry = byKey.get(key) ?? {
        displayName: raw.trim(),
        sessionIds: [],
        distillateIds: [],
      };
      entry.distillateIds.push(d.id);
      if (d.subjectType === "session") entry.sessionIds.push(d.subjectId);
      byKey.set(key, entry);
    }
  }

  const upserted: EntityRow[] = [];
  let linked = 0;

  for (const [key, info] of byKey) {
    if (dryRun) {
      upserted.push({
        id: "dry-run",
        entityType: "project",
        canonicalKey: key,
        displayName: info.displayName || displayNameFromKey(key),
        metadata: { twin: "D1", seeded: true, dryRun: true },
        createdAt: new Date().toISOString(),
      });
      continue;
    }
    const entity = await store.upsertEntity({
      entityType: "project",
      canonicalKey: key,
      displayName: info.displayName || displayNameFromKey(key),
      metadata: {
        twin: "D1",
        seeded: true,
        fromDistillates: info.distillateIds.slice(0, 20),
      },
    });
    upserted.push(entity);
    for (const sid of [...new Set(info.sessionIds)].slice(0, 30)) {
      await store.linkEntity({
        entityId: entity.id,
        linkedType: "session",
        linkedId: sid,
        relation: "mentions",
      });
      linked += 1;
    }
  }

  return {
    mode: store.mode,
    dryRun,
    scanned: summaries.length,
    upserted,
    linked,
  };
}

/**
 * B3: aggregate session summary distillates into project_brief rows.
 */
export async function runProjectBriefJob(
  store: CortexStore,
  options: ProjectBriefRunOptions = {},
): Promise<ProjectBriefRunResult> {
  const dryRun = Boolean(options.dryRun);
  const summaries = await store.listDistillates({
    limit: options.limitSessions ?? 40,
    kinds: ["summary"],
  });

  // Optional github/email keyword hits to enrich briefs
  const mentionHits = await store.searchRecords("project", {
    limit: 30,
    recordTypes: ["github_pr", "github_issue", "github_commit", "email_message"],
  });

  const byProject = new Map<string, DistillateRow[]>();
  for (const d of summaries) {
    const projects = projectKeysFromMetadata(d.metadata);
    const keys =
      options.projectKeys?.length
        ? options.projectKeys
        : projects.length
          ? projects
          : [];
    for (const raw of keys) {
      const key = slugifyKey(raw);
      if (!key) continue;
      const list = byProject.get(key) ?? [];
      list.push(d);
      byProject.set(key, list);
    }
  }

  if (byProject.size === 0 && summaries.length > 0) {
    byProject.set("uncategorized", summaries.slice(0, 10));
  }

  const briefs: DistillateRow[] = [];
  let written = 0;

  for (const [projectKey, rows] of byProject) {
    const entity = dryRun
      ? {
          id: "dry-run-entity",
          entityType: "project",
          canonicalKey: projectKey,
          displayName: displayNameFromKey(projectKey),
          metadata: {},
          createdAt: new Date().toISOString(),
        }
      : await store.upsertEntity({
          entityType: "project",
          canonicalKey: projectKey,
          displayName: displayNameFromKey(projectKey),
          metadata: { twin: "D1", briefJob: true },
        });

    const relatedMentions = mentionHits.hits
      .filter((h) => {
        const blob = JSON.stringify(h.payload).toLowerCase();
        return (
          blob.includes(projectKey) ||
          blob.includes(projectKey.replace(/-/g, " "))
        );
      })
      .slice(0, 8);

    const nextActions = [
      ...new Set(
        rows.flatMap((r) => {
          const a = r.metadata.nextActions;
          return Array.isArray(a)
            ? a.filter((x): x is string => typeof x === "string")
            : [];
        }),
      ),
    ].slice(0, 8);

    const evidence = rows
      .map((r) => `- ${r.content?.slice(0, 240) ?? ""}`)
      .join("\n")
      .slice(0, 10000);
    const mentionBlock = relatedMentions
      .map(
        (h) =>
          `- ${h.recordType}: ${
            (typeof h.payload.title === "string" && h.payload.title) ||
            (typeof h.payload.subject === "string" && h.payload.subject) ||
            h.sourceRecordId
          }`,
      )
      .join("\n");

    let content: string;
    let model: string;
    if (openaiConfigured() && !dryRun) {
      try {
        const { text, model: m } = await chatJsonCompletion({
          system:
            "Summarize project evidence into JSON: { summary, nextActions[], risks[], commercialVsTech }. Be concise.",
          user: `Project: ${projectKey}\n\nSession distillates:\n${evidence}\n\nRelated records:\n${mentionBlock || "(none)"}`,
          model: distillateModel(),
        });
        model = m;
        try {
          const parsed = JSON.parse(text) as {
            summary?: string;
            nextActions?: string[];
            risks?: string[];
            commercialVsTech?: string;
          };
          content = [
            parsed.summary ?? `Project brief for ${projectKey}.`,
            (parsed.nextActions?.length ? parsed.nextActions : nextActions)
              .length
              ? `Next: ${(parsed.nextActions?.length ? parsed.nextActions : nextActions).join("; ")}`
              : "",
            parsed.risks?.length ? `Risks: ${parsed.risks.join("; ")}` : "",
            parsed.commercialVsTech
              ? `Lens: ${parsed.commercialVsTech}`
              : "",
            mentionBlock ? `Signals:\n${mentionBlock}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        } catch {
          content = text.slice(0, 4000);
        }
      } catch {
        content = [
          `Project ${displayNameFromKey(projectKey)} (${rows.length} session distillates).`,
          nextActions.length ? `Next: ${nextActions.join("; ")}` : "",
          evidence.slice(0, 1500),
          mentionBlock ? `Signals:\n${mentionBlock}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        model = "cortex-project-brief-stub";
      }
    } else {
      content = [
        `Project ${displayNameFromKey(projectKey)} (${rows.length} session distillates).`,
        nextActions.length ? `Next: ${nextActions.join("; ")}` : "",
        evidence.slice(0, 1500),
        mentionBlock ? `Signals:\n${mentionBlock}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      model = "cortex-project-brief-stub";
    }

    const { embedding, embeddingRef } =
      !dryRun && openaiConfigured()
        ? await maybeEmbedContent(content)
        : { embedding: null, embeddingRef: null };

    const draft = {
      subjectType: "entity",
      subjectId: entity.id,
      kind: "project_brief",
      content,
      embeddingRef,
      embedding,
      model,
      metadata: {
        projectKey,
        sessionDistillateIds: rows.map((r) => r.id),
        relatedRecordIds: relatedMentions.map((h) => h.id),
        nextActions,
        twin: "B3",
      },
    };

    if (dryRun) {
      const now = new Date().toISOString();
      briefs.push({
        id: "dry-run",
        ...draft,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    const row = await store.upsertDistillate(draft);
    briefs.push(row);
    written += 1;

    for (const r of rows.slice(0, 20)) {
      if (r.subjectType === "session") {
        await store.linkEntity({
          entityId: entity.id,
          linkedType: "session",
          linkedId: r.subjectId,
          relation: "distilled_from",
        });
      }
    }
  }

  return {
    mode: store.mode,
    dryRun,
    projects: [...byProject.keys()],
    written,
    briefs,
  };
}

function sessionDurationHours(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): number {
  if (!startedAt) return 1;
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : start + 60 * 60 * 1000;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 1;
  return Math.max(0.25, (end - start) / (1000 * 60 * 60));
}

export interface PriorityVsActualResult {
  mode: CortexStore["mode"];
  dryRun: boolean;
  weekKey: string;
  attribution: Array<{
    projectKey: string;
    hours: number;
    pct: number;
    sessions: number;
  }>;
  stated: { ambitions: EntityRow[]; priorities: EntityRow[] };
  distillate: DistillateRow | null;
}

/**
 * D2: heuristic week attribution of session hours to projects vs stated goals.
 */
export async function runPriorityVsActual(
  store: CortexStore,
  options: { dryRun?: boolean; weekOf?: string } = {},
): Promise<PriorityVsActualResult> {
  const dryRun = Boolean(options.dryRun);
  const weekAnchor = options.weekOf ? new Date(options.weekOf) : new Date();
  if (Number.isNaN(weekAnchor.getTime())) {
    weekAnchor.setTime(Date.now());
  }
  // ISO week Monday UTC
  const day = weekAnchor.getUTCDay();
  const monday = new Date(weekAnchor);
  monday.setUTCDate(weekAnchor.getUTCDate() - ((day + 6) % 7));
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 7);
  const weekKey = monday.toISOString().slice(0, 10);

  const [ambitions, priorities, sessions, summaries] = await Promise.all([
    store.listEntities("ambition", 20),
    store.listEntities("priority", 20),
    store.listRecentWork({
      kinds: ["session"],
      limit: 80,
      workMode: false,
      horizonDays: null,
    }),
    store.listDistillates({ limit: 80, kinds: ["summary"] }),
  ]);

  const summaryBySession = new Map(
    summaries
      .filter((d) => d.subjectType === "session")
      .map((d) => [d.subjectId, d]),
  );

  const hoursByProject = new Map<string, { hours: number; sessions: number }>();
  let totalHours = 0;

  for (const s of sessions) {
    const at = s.occurredAt;
    if (!at || at < monday.toISOString() || at >= sunday.toISOString()) {
      continue;
    }
    const detail = await store.getSession(s.id);
    const hours = sessionDurationHours(
      detail?.startedAt ?? s.occurredAt,
      detail?.endedAt ?? null,
    );
    totalHours += hours;
    const dist = summaryBySession.get(s.id);
    const projects = dist
      ? projectKeysFromMetadata(dist.metadata).map(slugifyKey).filter(Boolean)
      : [];
    const keys = projects.length ? projects : ["uncategorized"];
    const share = hours / keys.length;
    for (const key of keys) {
      const prev = hoursByProject.get(key) ?? { hours: 0, sessions: 0 };
      prev.hours += share;
      prev.sessions += 1;
      hoursByProject.set(key, prev);
    }
  }

  const attribution = [...hoursByProject.entries()]
    .map(([projectKey, v]) => ({
      projectKey,
      hours: Math.round(v.hours * 100) / 100,
      pct:
        totalHours > 0
          ? Math.round((v.hours / totalHours) * 1000) / 10
          : 0,
      sessions: v.sessions,
    }))
    .sort((a, b) => b.hours - a.hours);

  const statedLines = [
    ...ambitions.map((a) => `ambition:${a.canonicalKey}`),
    ...priorities.map((p) => `priority:${p.canonicalKey}`),
  ];
  const content = [
    `Priority vs actual — week of ${weekKey} (UTC).`,
    `Session hours observed: ${Math.round(totalHours * 10) / 10}.`,
    attribution.length
      ? attribution
          .map((a) => `${a.pct}% → ${a.projectKey} (${a.hours}h, ${a.sessions} sessions)`)
          .join("; ")
      : "No sessions attributed in this week window.",
    statedLines.length
      ? `Stated goals: ${statedLines.join(", ")}.`
      : "No ambition/priority entities curated yet.",
  ].join(" ");

  const subjectId = `00000000-0000-4000-8000-${weekKey.replace(/-/g, "").slice(0, 12).padEnd(12, "0")}`;
  let distillate: DistillateRow | null = null;

  if (!dryRun) {
    const { embedding, embeddingRef } = await maybeEmbedContent(content);
    distillate = await store.upsertDistillate({
      subjectType: "week",
      subjectId,
      kind: "priority_vs_actual",
      content,
      embeddingRef,
      embedding,
      model: "cortex-priority-vs-actual",
      metadata: {
        twin: "D2",
        weekKey,
        weekStart: monday.toISOString(),
        weekEnd: sunday.toISOString(),
        totalHours,
        attribution,
        ambitionIds: ambitions.map((a) => a.id),
        priorityIds: priorities.map((p) => p.id),
      },
    });
  } else {
    const now = new Date().toISOString();
    distillate = {
      id: "dry-run",
      subjectType: "week",
      subjectId,
      kind: "priority_vs_actual",
      content,
      embeddingRef: null,
      embedding: null,
      model: "cortex-priority-vs-actual",
      metadata: { twin: "D2", weekKey, attribution, dryRun: true },
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    mode: store.mode,
    dryRun,
    weekKey,
    attribution,
    stated: { ambitions, priorities },
    distillate,
  };
}

/** @deprecated use runPriorityVsActual */
export async function stubPriorityVsActual(
  store: CortexStore,
): Promise<Record<string, unknown>> {
  const result = await runPriorityVsActual(store, { dryRun: true });
  return {
    extension: "D2",
    status: "ok",
    weekKey: result.weekKey,
    attribution: result.attribution,
    ambitionCount: result.stated.ambitions.length,
    priorityCount: result.stated.priorities.length,
  };
}

/**
 * D4: theory-of-self distillate from D2/D3 evidence.
 */
export async function refreshSelfModel(
  store: CortexStore,
  options: { dryRun?: boolean } = {},
): Promise<DistillateRow> {
  const dryRun = Boolean(options.dryRun);
  const [d2rows, decisions, outcomes, briefs] = await Promise.all([
    store.listDistillates({ limit: 3, kinds: ["priority_vs_actual"] }),
    store.listDistillates({ limit: 15, kinds: ["decision"] }),
    store.listDistillates({ limit: 15, kinds: ["outcome"] }),
    store.listDistillates({ limit: 8, kinds: ["project_brief"] }),
  ]);

  const d2 = d2rows[0];
  const decisionLines = [...decisions, ...outcomes]
    .slice(0, 10)
    .map((d) => `- [${d.kind}] ${(d.content ?? "").slice(0, 160)}`);
  const briefLines = briefs
    .slice(0, 5)
    .map(
      (b) =>
        `- ${String(b.metadata.projectKey ?? b.subjectId)}: ${(b.content ?? "").slice(0, 120)}`,
    );

  let content: string;
  let model: string;

  const evidence = [
    d2?.content ? `D2: ${d2.content}` : "D2: no priority_vs_actual yet.",
    decisionLines.length
      ? `D3:\n${decisionLines.join("\n")}`
      : "D3: no decisions/outcomes captured.",
    briefLines.length
      ? `Briefs:\n${briefLines.join("\n")}`
      : "Briefs: none yet.",
  ].join("\n\n");

  if (openaiConfigured() && !dryRun) {
    try {
      const { text, model: m } = await chatJsonCompletion({
        system:
          "Write a concise theory-of-self JSON: { hypotheses: string[], failureModes: string[], leverageBets: string[] }. Ground only in evidence.",
        user: evidence.slice(0, 12000),
        model: distillateModel(),
      });
      model = m;
      try {
        const parsed = JSON.parse(text) as {
          hypotheses?: string[];
          failureModes?: string[];
          leverageBets?: string[];
        };
        content = [
          "Self-model (D4).",
          parsed.hypotheses?.length
            ? `Hypotheses: ${parsed.hypotheses.join("; ")}`
            : "",
          parsed.failureModes?.length
            ? `Failure modes: ${parsed.failureModes.join("; ")}`
            : "",
          parsed.leverageBets?.length
            ? `Leverage: ${parsed.leverageBets.join("; ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
      } catch {
        content = text.slice(0, 4000);
      }
    } catch {
      content = `Self-model (D4) heuristic. ${evidence.slice(0, 2000)}`;
      model = "cortex-self-model-stub";
    }
  } else {
    content = [
      "Self-model (D4) heuristic.",
      d2?.content ?? "No week attribution yet — run priority_vs_actual.",
      decisionLines.length
        ? `Recent decisions/outcomes (${decisionLines.length}).`
        : "No decision captures yet.",
      briefLines.length
        ? `Active briefs: ${briefs
            .map((b) => String(b.metadata.projectKey ?? ""))
            .filter(Boolean)
            .join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    model = "cortex-self-model-stub";
  }

  const subjectId = "00000000-0000-4000-8000-0000000000d4";
  const { embedding, embeddingRef } =
    !dryRun && openaiConfigured()
      ? await maybeEmbedContent(content)
      : { embedding: null, embeddingRef: null };

  const draft = {
    subjectType: "self",
    subjectId,
    kind: "self_model",
    content,
    embeddingRef,
    embedding,
    model,
    metadata: {
      twin: "D4",
      fromPriorityVsActualId: d2?.id ?? null,
      decisionIds: decisions.map((d) => d.id),
      outcomeIds: outcomes.map((d) => d.id),
      briefIds: briefs.map((b) => b.id),
    },
  };

  if (dryRun) {
    const now = new Date().toISOString();
    return { id: "dry-run", ...draft, createdAt: now, updatedAt: now };
  }
  return store.upsertDistillate(draft);
}

/** @deprecated use refreshSelfModel */
export async function stubSelfModelRefresh(
  store: CortexStore,
  options: { dryRun?: boolean } = {},
): Promise<DistillateRow> {
  return refreshSelfModel(store, options);
}

/**
 * D5: capital allocator prompt context over D1–D4 (no separate product).
 */
export async function getAllocatorContext(
  store: CortexStore,
): Promise<Record<string, unknown>> {
  const [projects, briefs, selfModels, d2, decisions] = await Promise.all([
    store.listEntities("project", 25),
    store.listDistillates({ limit: 12, kinds: ["project_brief"] }),
    store.listDistillates({ limit: 2, kinds: ["self_model"] }),
    store.listDistillates({ limit: 1, kinds: ["priority_vs_actual"] }),
    store.listDistillates({ limit: 8, kinds: ["decision", "outcome"] }),
  ]);

  const topBriefs = briefs.map((b) => ({
    projectKey: b.metadata.projectKey ?? null,
    snippet: (b.content ?? "").slice(0, 220),
  }));

  return {
    extension: "D5",
    status: "ok",
    horizons: ["3h", "3w", "3y"],
    note: "Reason over D1–D4 via MCP; do not ship a separate allocator product.",
    projectCount: projects.length,
    projects: projects.slice(0, 15).map((p) => ({
      key: p.canonicalKey,
      name: p.displayName,
    })),
    briefs: topBriefs,
    priorityVsActual: d2[0]?.content?.slice(0, 400) ?? null,
    recentDecisions: decisions.map((d) => ({
      kind: d.kind,
      snippet: (d.content ?? "").slice(0, 160),
    })),
    selfModel: selfModels[0]?.content?.slice(0, 500) ?? null,
    promptSeed: {
      id: randomUUID(),
      ask: "Given stated priorities vs recent session distillates, what is highest-leverage next 3h / 3w / 3y?",
      contextKeys: [
        "projects",
        "briefs",
        "priorityVsActual",
        "recentDecisions",
        "selfModel",
      ],
    },
  };
}

/** @deprecated use getAllocatorContext */
export async function stubAllocatorContext(
  store: CortexStore,
): Promise<Record<string, unknown>> {
  return getAllocatorContext(store);
}

/**
 * Track C: embed existing distillate content without re-running the LLM.
 */
export async function runEmbedBackfill(
  store: CortexStore,
  options: { limit?: number; dryRun?: boolean; force?: boolean } = {},
): Promise<{
  mode: CortexStore["mode"];
  dryRun: boolean;
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
}> {
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit ?? 50;
  const rows = options.force
    ? await store.listDistillates({ limit })
    : await store.listDistillates({ limit, missingEmbedding: true });

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  if (!openaiConfigured()) {
    return {
      mode: store.mode,
      dryRun,
      scanned: rows.length,
      updated: 0,
      skipped: rows.length,
      errors: 0,
    };
  }

  for (const row of rows) {
    if (!row.content?.trim()) {
      skipped += 1;
      continue;
    }
    if (!options.force && row.embedding?.length) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      updated += 1;
      continue;
    }
    try {
      const { embedding, embeddingRef } = await maybeEmbedContent(row.content);
      if (!embedding?.length) {
        errors += 1;
        continue;
      }
      await store.upsertDistillate({
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        kind: row.kind,
        content: row.content,
        embeddingRef,
        embedding,
        model: row.model,
        metadata: {
          ...row.metadata,
          embedBackfill: true,
          embedBackfillAt: new Date().toISOString(),
        },
      });
      updated += 1;
    } catch {
      errors += 1;
    }
  }

  return {
    mode: store.mode,
    dryRun,
    scanned: rows.length,
    updated,
    skipped,
    errors,
  };
}
