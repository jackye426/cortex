/**
 * B3 project_brief job scaffolding + D2–D5 twin extension points.
 *
 * project_brief: roll up session distillates (+ optional github/email mentions)
 * into kind=project_brief on subject_type=entity (or synthetic note).
 *
 * D2–D5 are intentionally light: real code paths + docs, not full product.
 */
import { randomUUID } from "node:crypto";
import {
  chatJsonCompletion,
  embedTexts,
  openaiConfigured,
  distillateModel,
} from "./llm.js";
import type { CortexStore } from "./store/index.js";
import type { DistillateRow } from "./store/types.js";

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

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

/**
 * Scaffolding job: aggregate session summary distillates into project_brief rows.
 */
export async function runProjectBriefJob(
  store: CortexStore,
  options: ProjectBriefRunOptions = {},
): Promise<ProjectBriefRunResult> {
  const dryRun = Boolean(options.dryRun);
  const summaries = await store.searchDistillates("", options.limitSessions ?? 40, [
    "summary",
  ]);

  const byProject = new Map<string, DistillateRow[]>();
  for (const d of summaries) {
    const projects = Array.isArray(d.metadata.projects)
      ? (d.metadata.projects as unknown[]).filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        )
      : [];
    const keys =
      options.projectKeys?.length
        ? options.projectKeys
        : projects.length
          ? projects
          : [];
    for (const raw of keys) {
      const key = slugify(raw);
      if (!key) continue;
      const list = byProject.get(key) ?? [];
      list.push(d);
      byProject.set(key, list);
    }
  }

  // If nothing inferred, still scaffold one "uncategorized" brief from recent summaries
  if (byProject.size === 0 && summaries.length > 0) {
    byProject.set("uncategorized", summaries.slice(0, 10));
  }

  const briefs: DistillateRow[] = [];
  let written = 0;

  for (const [projectKey, rows] of byProject) {
    const entity = await store.upsertEntity({
      entityType: "project",
      canonicalKey: projectKey,
      displayName: projectKey,
      metadata: { twin: "D1", briefJob: true },
    });

    const evidence = rows
      .map((r) => `- ${r.content?.slice(0, 240) ?? ""}`)
      .join("\n")
      .slice(0, 12000);

    let content: string;
    let model: string;
    if (openaiConfigured() && !dryRun) {
      try {
        const { text, model: m } = await chatJsonCompletion({
          system:
            "Summarize project evidence into JSON: { summary, nextActions[], risks[], commercialVsTech }. Be concise.",
          user: `Project: ${projectKey}\n\nSession distillates:\n${evidence}`,
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
            parsed.nextActions?.length
              ? `Next: ${parsed.nextActions.join("; ")}`
              : "",
            parsed.risks?.length ? `Risks: ${parsed.risks.join("; ")}` : "",
            parsed.commercialVsTech
              ? `Lens: ${parsed.commercialVsTech}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        } catch {
          content = text.slice(0, 4000);
        }
      } catch {
        content = `Project ${projectKey} (${rows.length} session distillates).\n${evidence.slice(0, 1500)}`;
        model = "cortex-project-brief-stub";
      }
    } else {
      content = `Project ${projectKey} (${rows.length} session distillates).\n${evidence.slice(0, 1500)}`;
      model = "cortex-project-brief-stub";
    }

    let embedding: number[] | null = null;
    let embeddingRef: string | null = null;
    if (!dryRun && openaiConfigured() && content.trim()) {
      try {
        const [vec] = await embedTexts([content]);
        embedding = vec ?? null;
        embeddingRef = embedding
          ? `openai:${process.env.CORTEX_EMBEDDING_MODEL?.trim() || "text-embedding-3-small"}`
          : null;
      } catch {
        // ignore embed failures on brief job
      }
    }

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

/**
 * D2 stub: priority vs actual — placeholder week attribution from session spans.
 * Real implementation will weigh session duration vs stated ambition entities.
 */
export async function stubPriorityVsActual(
  store: CortexStore,
): Promise<Record<string, unknown>> {
  const ambitions = await store.listEntities("ambition", 20);
  const priorities = await store.listEntities("priority", 20);
  const sessions = await store.listRecentWork({
    kinds: ["session"],
    limit: 30,
    workMode: true,
  });
  return {
    extension: "D2",
    status: "scaffold",
    note: "Attribute session time to ambition/priority entities once goals are curated.",
    ambitionCount: ambitions.length,
    priorityCount: priorities.length,
    recentSessionCount: sessions.length,
    sample: sessions.slice(0, 5).map((s) => ({
      id: s.id,
      title: s.title,
      occurredAt: s.occurredAt,
    })),
  };
}

/**
 * D4 stub: theory-of-self distillate kind=self_model on a synthetic subject.
 */
export async function stubSelfModelRefresh(
  store: CortexStore,
  options: { dryRun?: boolean } = {},
): Promise<DistillateRow> {
  const d2 = await stubPriorityVsActual(store);
  const content = [
    "Self-model scaffold (D4).",
    "Update hypotheses from priority-vs-actual (D2) and decision/outcome captures (D3).",
    `Recent sessions observed: ${String((d2 as { recentSessionCount?: number }).recentSessionCount ?? 0)}.`,
  ].join(" ");

  const subjectId = "00000000-0000-4000-8000-0000000000d4";
  const draft = {
    subjectType: "self",
    subjectId,
    kind: "self_model",
    content,
    embeddingRef: null as string | null,
    embedding: null as number[] | null,
    model: "cortex-self-model-stub",
    metadata: { twin: "D4", from: d2 },
  };

  if (options.dryRun) {
    const now = new Date().toISOString();
    return { id: "dry-run", ...draft, createdAt: now, updatedAt: now };
  }
  return store.upsertDistillate(draft);
}

/**
 * D5 stub: capital allocator prompt context — not a product, just grounding pack.
 */
export async function stubAllocatorContext(
  store: CortexStore,
): Promise<Record<string, unknown>> {
  const [projects, briefs, selfModels] = await Promise.all([
    store.listEntities("project", 20),
    store.searchDistillates("", 10, ["project_brief"]),
    store.searchDistillates("", 3, ["self_model"]),
  ]);
  return {
    extension: "D5",
    status: "scaffold",
    horizons: ["3h", "3w", "3y"],
    note: "Reason over D1–D4 via MCP; do not ship a separate allocator product.",
    projectCount: projects.length,
    briefCount: briefs.length,
    selfModel: selfModels[0]?.content?.slice(0, 400) ?? null,
    promptSeed: {
      id: randomUUID(),
      ask: "Given stated priorities vs recent session distillates, what is highest-leverage next 3h / 3w / 3y?",
    },
  };
}
