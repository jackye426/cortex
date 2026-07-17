/**
 * Weekly Mirror — five insight cards (energy, attention, avoidance, decisions, emerging interests).
 */
import { isoWeekKey } from "../week-helpers.js";
import { stableSubjectUuid } from "../stable-id.js";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import { requestExperimentResults } from "./experiments.js";
import {
  assertInsightCardComplete,
  cardFromHypothesis,
  serializeInsightCard,
} from "./insight-card.js";
import type { EvidenceRef, InsightCard, SourceFamily } from "./types.js";

const THEMES = [
  "energy",
  "attention",
  "avoidance",
  "decisions",
  "emerging_interests",
] as const;

export type WeeklyMirrorTheme = (typeof THEMES)[number];

export interface WeeklyMirrorPayload {
  weekKey: string;
  generatedAt: string;
  cards: InsightCard[];
  notes: string[];
}

export interface RefreshWeeklyMirrorResult {
  dryRun: boolean;
  weekKey: string;
  written: boolean;
  distillate: DistillateRow | null;
  mirror: WeeklyMirrorPayload;
}

function ev(
  family: SourceFamily,
  excerpt: string,
  weight = 0.5,
): EvidenceRef {
  return {
    sourceFamily: family,
    evidenceType: "observation",
    supportKind: "inferred_proxy",
    independenceGroup: family,
    excerpt,
    weight,
  };
}

function pickHypothesisCard(
  hyps: Awaited<ReturnType<CortexStore["listHypotheses"]>>,
  theme: WeeklyMirrorTheme,
  domainHints: string[],
): InsightCard | null {
  const match = hyps.find(
    (h) =>
      h.state !== "retired" &&
      !h.metadata.userRejected &&
      (domainHints.some((d) => h.domains.includes(d)) ||
        domainHints.some((d) => h.claim.toLowerCase().includes(d))),
  );
  return match ? cardFromHypothesis(match, theme) : null;
}

export async function buildWeeklyMirror(
  store: CortexStore,
  weekKey?: string,
): Promise<WeeklyMirrorPayload> {
  const key = weekKey ?? isoWeekKey();
  const [hyps, interests, affect, decisions, dueExperiments, observations] =
    await Promise.all([
      store.listHypotheses({ limit: 40 }),
      store.listInterests({ limit: 40 }),
      store.listAffectSignals({ limit: 30 }),
      store.listDecisionsTable({ limit: 20 }),
      requestExperimentResults(store),
      store.listObservations({ limit: 40 }),
    ]);

  const cards: InsightCard[] = [];
  const notes: string[] = [];
  const rejectedClaims = new Set(
    hyps
      .filter((h) => h.state === "retired" || h.state === "disputed" || h.metadata.userRejected)
      .map((h) => h.claim.trim().toLowerCase()),
  );

  // 1 Energy
  const energyAffect = affect.filter((a) => a.signalType === "energy");
  const energyCard =
    pickHypothesisCard(hyps, "energy", ["energy"]) ??
    serializeInsightCard({
      id: `wm-${key}-energy`,
      theme: "energy",
      notice:
        energyAffect.length > 0
          ? `Recent energy signals average ${(
              energyAffect.reduce((s, a) => s + a.value, 0) /
              energyAffect.length
            ).toFixed(2)} across ${energyAffect.length} samples.`
          : "Energy pattern is still under-observed this week.",
      why: "Energy swings often predict follow-through quality.",
      evidence:
        energyAffect.length > 0
          ? energyAffect.slice(0, 3).map((a) =>
              ev(a.sourceFamily, `energy=${a.value}`, Math.abs(a.value)),
            )
          : [ev("reflections", "No energy affect rows yet")],
      confidence: energyAffect.length >= 3 ? 0.55 : 0.35,
      contradictions: [
        "Calendar overload or sleep debt could explain the same signal.",
      ],
      rival: "Short-term workload spike rather than a durable energy trait.",
      test: "Log energy before/after two deep-work blocks this week.",
      provisional: true,
    });
  cards.push(energyCard);

  // 2 Attention
  const attentionCard =
    pickHypothesisCard(hyps, "attention", ["attention", "focus"]) ??
    serializeInsightCard({
      id: `wm-${key}-attention`,
      theme: "attention",
      notice:
        observations.filter((o) => /focus|attention|distract/i.test(o.statement))
          .length > 0
          ? "Attention-related observations appear in recent factual atoms."
          : "Attention theme lacks multi-source evidence this week.",
      why: "Where attention sticks without deadlines often marks terminal interest.",
      evidence: [
        ev("ai_sessions", "Session topics as attention proxy"),
        ev("browser", "Browse trails as voluntary attention proxy"),
      ],
      confidence: 0.4,
      contradictions: ["Work deadlines can force attention without desire."],
      rival: "Instrumental project pressure masquerading as interest.",
      test: "Spend 45 minutes on a non-work topic; note if you return voluntarily.",
      provisional: true,
    });
  cards.push(attentionCard);

  // 3 Avoidance
  const avoidCard =
    pickHypothesisCard(hyps, "avoidance", ["avoidance", "friction"]) ??
    serializeInsightCard({
      id: `wm-${key}-avoidance`,
      theme: "avoidance",
      notice:
        affect.filter((a) => a.signalType === "friction").length >= 2
          ? "Friction signals cluster — possible avoidance under ambiguity."
          : "No strong avoidance cluster detected; still watching for deferral loops.",
      why: "Avoidance loops burn weeks without feeling like a decision.",
      evidence: [
        ev("ai_sessions", "Friction/exploration metadata"),
        ev("reflections", "Cycle detector / hypothesis ledger"),
      ],
      confidence: 0.42,
      contradictions: ["Busy calendar can look like avoidance."],
      rival: "Capacity limits rather than motivational avoidance.",
      test: dueExperiments[0]
        ? `Complete due experiment: ${dueExperiments[0].title}`
        : "Pick one deferred task and do a 25-minute smallest step.",
      provisional: true,
    });
  cards.push(avoidCard);

  // 4 Decisions
  const openDecisions = decisions.slice(0, 5);
  const decisionCard =
    pickHypothesisCard(hyps, "decisions", ["decision", "motive"]) ??
    serializeInsightCard({
      id: `wm-${key}-decisions`,
      theme: "decisions",
      notice:
        openDecisions.length > 0
          ? `Recent decisions captured: ${openDecisions
              .map((d) => d.title)
              .slice(0, 3)
              .join("; ")}.`
          : "Few first-class decisions logged — open loops may be invisible.",
      why: "Expected vs actual outcomes calibrate self-trust.",
      evidence:
        openDecisions.length > 0
          ? openDecisions.slice(0, 2).map((d) =>
              ev("decisions", d.title.slice(0, 120)),
            )
          : [ev("decisions", "No decision rows yet")],
      confidence: openDecisions.length ? 0.5 : 0.3,
      contradictions: ["Distillate-only decisions may duplicate table rows."],
      rival: "Noise from capture habits rather than decision quality.",
      test: "Capture one decision with an expected outcome and revisit in 7 days.",
      provisional: true,
    });
  cards.push(decisionCard);

  // 5 Emerging interests
  const emerging = interests
    .filter(
      (i) =>
        i.status === "active" &&
        (i.class === "aspirational" ||
          i.class === "terminal" ||
          (i.recurrenceScore ?? 0) > 0.4),
    )
    .sort((a, b) => b.confidence - a.confidence);
  const interestNotice = emerging[0]
    ? `Emerging interest signal: ${emerging[0].displayName} (${emerging[0].class}, conf ${emerging[0].confidence.toFixed(2)}).`
    : "No strong emerging interest yet — mine digests / refresh interest map.";
  const interestCard =
    pickHypothesisCard(hyps, "emerging_interests", ["interest"]) ??
    serializeInsightCard({
      id: `wm-${key}-emerging_interests`,
      theme: "emerging_interests",
      notice: interestNotice,
      why: "Interests that recur outside projects often become identity bets.",
      evidence: emerging[0]
        ? [
            ev(
              "media_youtube",
              emerging[0].summary || emerging[0].displayName,
              emerging[0].confidence,
            ),
            ev("browser", "Cross-source recurrence candidate"),
          ]
        : [ev("reflections", "Interest map empty")],
      confidence: emerging[0]?.confidence ?? 0.3,
      contradictions: ["Situational project topics can look terminal early."],
      rival: "Instrumental learning for a current work deliverable.",
      test: "Pursue the interest with no utility for one session; note pull.",
      provisional: !emerging[0],
    });
  cards.push(interestCard);

  // Filter rejected reappearance
  const filtered = cards
    .filter((c) => !rejectedClaims.has(c.notice.trim().toLowerCase()))
    .slice(0, 5);

  // Ensure exactly theme coverage ≤5 and full contract
  while (filtered.length < 5) {
    const theme = THEMES[filtered.length]!;
    filtered.push(
      serializeInsightCard({
        id: `wm-${key}-pad-${theme}`,
        theme,
        notice: `Placeholder ${theme} card — awaiting more independent evidence.`,
        why: "Kept so Weekly Mirror always exposes the five themes.",
        evidence: [ev("reflections", "Insufficient evidence")],
        confidence: 0.25,
        contradictions: ["none_found"],
        rival: "Insufficient data rather than a real pattern.",
        test: "Gather two independent source families before trusting this theme.",
        provisional: true,
      }),
    );
  }

  for (const card of filtered) {
    const missing = assertInsightCardComplete(card);
    if (missing.length) {
      notes.push(`Card ${card.id} filled defaults for: ${missing.join(",")}`);
    }
  }

  if (dueExperiments.length) {
    notes.push(`${dueExperiments.length} experiment(s) due for results.`);
  }

  return {
    weekKey: key,
    generatedAt: new Date().toISOString(),
    cards: filtered.slice(0, 5),
    notes,
  };
}

export async function refreshWeeklyMirror(
  store: CortexStore,
  options: { dryRun?: boolean; weekKey?: string } = {},
): Promise<RefreshWeeklyMirrorResult> {
  const dryRun = Boolean(options.dryRun);
  const mirror = await buildWeeklyMirror(store, options.weekKey);
  const content = [
    `Weekly mirror ${mirror.weekKey}.`,
    ...mirror.cards.map(
      (c, i) => `${i + 1}. [${c.theme}] ${c.notice.slice(0, 160)}`,
    ),
  ].join("\n");

  if (dryRun) {
    const now = new Date().toISOString();
    return {
      dryRun: true,
      weekKey: mirror.weekKey,
      written: false,
      distillate: {
        id: "dry-run",
        subjectType: "week",
        subjectId: stableSubjectUuid("weekly-mirror", mirror.weekKey),
        kind: "weekly_mirror",
        content,
        embeddingRef: null,
        embedding: null,
        model: "weekly-mirror-v1",
        metadata: { mirror, twin: "I6" },
        createdAt: now,
        updatedAt: now,
      },
      mirror,
    };
  }

  const distillate = await store.upsertDistillate({
    subjectType: "week",
    subjectId: stableSubjectUuid("weekly-mirror", mirror.weekKey),
    kind: "weekly_mirror",
    content: content.slice(0, 4000),
    embeddingRef: null,
    embedding: null,
    model: "weekly-mirror-v1",
    metadata: {
      twin: "I6",
      weekKey: mirror.weekKey,
      sensitivity: "reflective_sensitive",
      mirror,
      cardCount: mirror.cards.length,
    },
  });

  return {
    dryRun: false,
    weekKey: mirror.weekKey,
    written: true,
    distillate,
    mirror,
  };
}

export async function getLatestWeeklyMirror(store: CortexStore): Promise<{
  distillate: DistillateRow | null;
  mirror: WeeklyMirrorPayload | null;
}> {
  const rows = await store.listDistillates({
    limit: 5,
    kinds: ["weekly_mirror"],
  });
  const distillate = rows[0] ?? null;
  if (!distillate) {
    const mirror = await buildWeeklyMirror(store);
    return { distillate: null, mirror };
  }
  const raw = distillate.metadata.mirror;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { distillate, mirror: raw as WeeklyMirrorPayload };
  }
  return { distillate, mirror: await buildWeeklyMirror(store) };
}
