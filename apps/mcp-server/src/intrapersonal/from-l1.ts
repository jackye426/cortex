/**
 * Weekly-mirror compiler over GBrain L1 pages (sessions + email/calendar).
 * EvidenceRef excerpts name L1 slugs. Dream/weekly pages are assistant_derived
 * with confidence capped at ASSISTANT_ONLY_CONFIDENCE_CAP (0.4).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listMarkdownPages } from "@cortex/gbrain-session-page";
import { inWeek, isoWeekKey, weekRange } from "../week-helpers.js";
import {
  analyzeClaimCircularity,
  enforceClaimEvidencePolicy,
} from "./circular-evidence.js";
import {
  assertInsightCardComplete,
  serializeInsightCard,
} from "./insight-card.js";
import type {
  AnnotatedMemoryHit,
  EvidenceRef,
  InsightCard,
  ProvenanceClaim,
  SourceFamily,
} from "./types.js";
import { ASSISTANT_ONLY_CONFIDENCE_CAP } from "./types.js";

export interface L1PageHit {
  slug: string;
  schema: string;
  family: SourceFamily;
  supportKind: EvidenceRef["supportKind"];
  title: string;
  excerpt: string;
  occurredAt: string | null;
  weekKey: string | null;
}

export interface CompileWeeklyMirrorFromL1Options {
  pagesDir: string;
  outDir?: string;
  weekKey?: string;
  dryRun?: boolean;
}

export interface CompileWeeklyMirrorFromL1Result {
  dryRun: boolean;
  weekKey: string;
  cards: InsightCard[];
  writtenPath: string | null;
  circularIssues: string[];
  completeness: Record<string, string[]>;
}

function schemaOf(markdown: string): string {
  const m = markdown.match(/^cortex_schema:\s*(\S+)/m);
  return m?.[1] ?? "";
}

function titleOf(markdown: string, fallback: string): string {
  const fm = markdown.match(/^title:\s*(.+)$/m);
  if (fm) return fm[1]!.replace(/^["']|["']$/g, "").trim();
  const h = markdown.match(/^#\s+(.+)$/m);
  return h?.[1]!.trim() ?? fallback;
}

function yamlScalar(markdown: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const m = markdown.match(re);
  if (!m) return null;
  const raw = m[1]!.trim();
  if (raw === "null" || raw === "~" || raw === "") return null;
  return raw.replace(/^["']|["']$/g, "");
}

function weekFromSlug(slug: string): string | null {
  const m = slug.match(/(\d{4}-W\d{2})/);
  return m?.[1] ?? null;
}

function classifyPage(relativePath: string, markdown: string): L1PageHit | null {
  const slug = relativePath.replace(/\.md$/, "");
  const schema = schemaOf(markdown);
  const occurredAt =
    yamlScalar(markdown, "occurred_at") ??
    yamlScalar(markdown, "started_at") ??
    yamlScalar(markdown, "ended_at");
  const weekKey =
    yamlScalar(markdown, "week_key") ?? weekFromSlug(slug);

  if (schema.includes("hook-delta")) {
    return null;
  }

  const isWeekly =
    slug.startsWith("self/weekly") ||
    schema.includes("weekly-mirror") ||
    schema.includes("dream") ||
    schema.includes("reflection");
  if (isWeekly) {
    return {
      slug,
      schema: schema || "dream-reflection",
      family: "reflections",
      supportKind: "assistant_derived",
      title: titleOf(markdown, slug),
      excerpt: slug,
      occurredAt,
      weekKey,
    };
  }
  if (schema === "session-v1") {
    return {
      slug,
      schema,
      family: "ai_sessions",
      supportKind: "direct_observation",
      title: titleOf(markdown, slug),
      excerpt: slug,
      occurredAt,
      weekKey,
    };
  }
  if (
    schema.includes("gmail") ||
    schema.includes("email") ||
    relativePath.startsWith("mail/")
  ) {
    return {
      slug,
      schema: schema || "gmail-v1",
      family: "email",
      supportKind: "direct_observation",
      title: titleOf(markdown, slug),
      excerpt: slug,
      occurredAt,
      weekKey,
    };
  }
  if (schema.includes("calendar") || relativePath.startsWith("calendar/")) {
    return {
      slug,
      schema: schema || "calendar-v1",
      family: "calendar",
      supportKind: "direct_observation",
      title: titleOf(markdown, slug),
      excerpt: slug,
      occurredAt,
      weekKey,
    };
  }
  return null;
}

function evFromHit(hit: L1PageHit, weight = 0.6): EvidenceRef {
  return {
    sourceFamily: hit.family,
    evidenceType: hit.supportKind === "assistant_derived" ? "interpretation" : "observation",
    supportKind: hit.supportKind,
    independenceGroup: hit.family,
    excerpt: hit.excerpt,
    weight: hit.supportKind === "assistant_derived" ? 0.25 : weight,
  };
}

function hitToAnnotated(hit: L1PageHit): AnnotatedMemoryHit {
  return {
    id: hit.slug,
    kind: hit.schema,
    distillateKind: hit.schema,
    title: hit.title,
    snippet: hit.excerpt,
    score: 1,
    evidenceStrength: "keyword_only",
    sourceFamily: hit.family,
    independenceGroup: hit.family,
    supportKind: hit.supportKind,
  };
}

export function pageInWeek(hit: L1PageHit, weekKey: string): boolean {
  if (hit.weekKey) return hit.weekKey === weekKey;
  const { start, end } = weekRange(weekKey);
  return inWeek(hit.occurredAt, start, end);
}

export function listL1Evidence(pagesDir: string, weekKey?: string): L1PageHit[] {
  const hits = listMarkdownPages(pagesDir)
    .map((p) => classifyPage(p.relativePath, p.markdown))
    .filter((h): h is L1PageHit => Boolean(h));
  if (!weekKey) return hits;
  return hits.filter((h) => pageInWeek(h, weekKey));
}

export function compileWeeklyMirrorFromL1(
  options: CompileWeeklyMirrorFromL1Options,
): CompileWeeklyMirrorFromL1Result {
  const weekKey = options.weekKey ?? isoWeekKey();
  const dryRun = Boolean(options.dryRun);
  const outDir = options.outDir ?? options.pagesDir;
  const hits = listL1Evidence(options.pagesDir, weekKey);
  const l1 = hits.filter((h) => h.supportKind !== "assistant_derived");
  const dream = hits.filter((h) => h.supportKind === "assistant_derived");

  const sessionHit = l1.find((h) => h.family === "ai_sessions");
  const emailHit = l1.find((h) => h.family === "email");
  const primary = [sessionHit, emailHit].filter((h): h is L1PageHit => Boolean(h));

  const evidence: EvidenceRef[] =
    primary.length > 0
      ? primary.map((h) => evFromHit(h))
      : dream.length > 0
        ? dream.slice(0, 1).map((h) => evFromHit(h))
        : [
            {
              sourceFamily: "reflections",
              evidenceType: "interpretation",
              supportKind: "assistant_derived",
              independenceGroup: "reflections",
              excerpt: `self/weekly-${weekKey}`,
              weight: 0.25,
            },
          ];

  const notice =
    primary.length >= 2
      ? `L1 week ${weekKey}: session ${sessionHit!.slug} and email ${emailHit!.slug} are the evidence base.`
      : primary.length === 1
        ? `L1 week ${weekKey} cites ${primary[0]!.slug}.`
        : `Week ${weekKey} has no L1 session/email pages — dream-only support is capped.`;

  const card = serializeInsightCard({
    id: `wm-${weekKey}-attention`,
    theme: "attention",
    notice,
    why: "Compilers must cite L1 slugs, never dream reflections, as the evidence base.",
    evidence,
    confidence: primary.length >= 2 ? 0.62 : dream.length && !primary.length ? 0.7 : 0.35,
    contradictions: ["Workload can force the same session/email pattern."],
    rival: "Instrumental project pressure rather than a durable attention trait.",
    test: "Add a second independent L1 family next week and re-score.",
    provisional: primary.length < 2,
  });

  const themes = [
    "energy",
    "attention",
    "avoidance",
    "decisions",
    "emerging_interests",
  ] as const;
  const cards: InsightCard[] = [];
  for (const theme of themes) {
    if (theme === "attention") {
      cards.push(card);
      continue;
    }
    cards.push(
      serializeInsightCard({
        id: `wm-${weekKey}-${theme}`,
        theme,
        notice: `${theme} from L1 slugs this week.`,
        why: "Weekly mirror themes stay complete even when one theme carries the L1 cites.",
        evidence:
          primary.length > 0
            ? primary.map((h) => evFromHit(h, 0.45))
            : evidence,
        confidence: primary.length > 0 ? 0.45 : ASSISTANT_ONLY_CONFIDENCE_CAP,
        contradictions: ["Single-week snapshot may not generalize."],
        rival: "Situational load rather than a stable pattern.",
        test: "Revisit after one more ISO week of L1 pages.",
        provisional: true,
      }),
    );
  }

  const completeness: Record<string, string[]> = {};
  for (const c of cards) {
    completeness[c.id] = assertInsightCardComplete(c);
  }

  const annotated = hits.map(hitToAnnotated);
  const claim: ProvenanceClaim = {
    text: card.notice,
    claimType: "observation",
    confidence: card.confidence,
    evidenceRefs: evidence.map((e) => e.excerpt ?? "unknown"),
  };
  const { issues, claims } = enforceClaimEvidencePolicy(
    [claim],
    annotated.length
      ? annotated
      : evidence.map((e) => ({
          id: e.excerpt ?? "unknown",
          kind: "weekly_mirror",
          distillateKind: "weekly_mirror",
          title: e.excerpt ?? "",
          snippet: e.excerpt ?? "",
          score: 1,
          evidenceStrength: "distillate" as const,
          sourceFamily: e.sourceFamily,
          independenceGroup: e.independenceGroup,
          supportKind: e.supportKind,
        })),
  );
  if (claims[0]) {
    cards[1] = { ...card, confidence: claims[0].confidence };
  }

  const circularIssues = issues.map((i) => i.code);
  const rel = `self/weekly-${weekKey}.md`;
  if (!dryRun) {
    const abs = join(outDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(
      abs,
      [
        "---",
        "cortex_schema: weekly-mirror-v1",
        `week_key: ${weekKey}`,
        "visibility: private",
        "holder: cortex",
        "---",
        "",
        `# Weekly mirror ${weekKey}`,
        "",
        "L3 compiler output. Do not cite this page as L1 evidence.",
        "",
        "```json",
        JSON.stringify({ weekKey, cards, circularIssues }, null, 2),
        "```",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  return {
    dryRun,
    weekKey,
    cards,
    writtenPath: dryRun ? null : rel,
    circularIssues,
    completeness,
  };
}

/** Explicit circular-evidence helper used by tests when only a weekly page is cited. */
export function analyzeWeeklyOnlyCite(weeklySlug: string) {
  return analyzeClaimCircularity(
    {
      text: "Pattern from last week's mirror",
      claimType: "observation",
      confidence: 0.9,
      evidenceRefs: [weeklySlug],
    },
    new Map([
      [
        weeklySlug,
        {
          id: weeklySlug,
          kind: "weekly_mirror",
          distillateKind: "weekly_mirror",
          title: "weekly",
          snippet: weeklySlug,
          score: 1,
          evidenceStrength: "distillate",
          sourceFamily: "reflections",
          independenceGroup: "reflections",
          supportKind: "assistant_derived",
        } satisfies AnnotatedMemoryHit,
      ],
    ]),
  );
}
