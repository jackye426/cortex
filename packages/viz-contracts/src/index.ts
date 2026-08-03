/** Shared DTOs for data-verse density (01–04) and ledger (05). */

export type VizView = "scan" | "particle" | "cross" | "text";

export type VizLedgerChannel =
  | "mirror"
  | "questions"
  | "self"
  | "interests"
  | "attr"
  | "diff";

export type SelfFacet =
  | "strengths"
  | "limitations"
  | "motives"
  | "tensions"
  | "identity";

export type InterestClassTag =
  | "terminal"
  | "instrumental"
  | "aspirational"
  | "situational"
  | "dormant";

/** Cortex source families for cross-platform bars (not toy WEB/MOBILE labels). */
export const VIZ_SOURCE_FAMILIES = [
  "ai_sessions",
  "github",
  "email",
  "calendar",
  "media_youtube",
  "media_spotify",
  "browser",
  "reading",
  "drive",
  "decisions",
  "reflections",
] as const;

export type VizSourceFamily = (typeof VIZ_SOURCE_FAMILIES)[number];

export interface VizPoint3 {
  x: number;
  y: number;
  z: number;
  /** Alpha 0–1 */
  a?: number;
  /** Size multiplier */
  s?: number;
  region?: SelfFacet | InterestClassTag | string;
  confidence?: number;
  evidenceFamilies?: number;
  id?: string;
  label?: string;
  /** Normalized position in the view's time window (0–1) — the scan's 4th axis. */
  t?: number;
}

export interface VizOrbit {
  tilt: number;
  yaw: number;
  r: number;
  ecc: number;
  accent: boolean;
  id?: string;
  label?: string;
  /** Mean days between returns; null/absent for one-off impulses. */
  periodDays?: number | null;
  daysSinceLast?: number;
  /** Distinct sittings (events clustered by day). */
  returns?: number;
  events?: number;
  /** Overdue-ness 0–1: 1 = on schedule, → 0 = long past due. */
  health?: number;
  /** No measurable rhythm, or coasting — the body stops moving. */
  stalled?: boolean;
  /** Deterministic starting angle 0–1 so bodies do not jump between refreshes. */
  phase?: number;
}

export interface VizEdge {
  /** Node index into points (or cores-expanded node list). */
  a: number;
  b: number;
  weight: number;
  polarity?: "supports" | "contradicts" | "neutral";
}

export interface VizCore {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface VizStreamRow {
  text: string;
  speed?: number;
  phase?: number;
  alpha?: number;
  invert?: Array<[number, number]>;
  accent?: boolean;
  kind?: "session" | "observation" | "digest" | "other";
}

export interface VizAnnotation {
  id: string;
  /** Short key ≤24 chars — no prose. */
  label: string;
  x: number;
  y: number;
  z: number;
  /** Second readout line: plain-language gloss + counts for evocative labels. */
  sub?: string;
}

export interface VizMeter {
  id: string;
  label: string;
  /** Normalized 0–1 */
  value: number;
}

export interface VizChannelBar {
  id: string;
  label: string;
  value: number;
}

export interface VizSlice {
  pos: number;
  region?: string;
  /** Optional subset of point indexes for this slab. */
  pointIndexes?: number[];
  /** Records falling in this slab — drives the section-matrix readout. */
  count?: number;
  /** Short slab label (e.g. session ordinal or family). */
  label?: string;
}

/** Visual density budgets — client shells own geometry at these counts. */
export const DENSITY_BUDGETS = {
  scan: { points: 9000, slices: 32, annotations: 6 },
  particle: { points: 5200, orbits: 22, labels: 26 },
  cross: { nodes: 4600, channels: 8 },
  text: { rows: 180, cols: 900 },
} as const;

export interface VizDensityMeta {
  /** Client generative shells own geometry; API supplies semantic overlays. */
  shellDriven?: boolean;
  source?: "live" | "fixture" | "degraded";
  degraded?: boolean;
  empty?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface VizDensity {
  view: VizView;
  generatedAt: string;
  points: VizPoint3[];
  orbits?: VizOrbit[];
  edges?: VizEdge[];
  cores?: VizCore[];
  streamRows?: VizStreamRow[];
  annotations?: VizAnnotation[];
  meters?: VizMeter[];
  channelBars?: VizChannelBar[];
  slices?: VizSlice[];
  meta?: VizDensityMeta;
}

export interface VizLedgerControls {
  confirm: boolean;
  reject: boolean;
  refine: boolean;
}

export type VizLedgerDetail =
  | {
      kind: "mirror";
      notice: string;
      why: string;
      evidenceCount: number;
      confidence: number;
      rival: string;
      test: string;
      contradictions: string[];
      hypothesisId?: string | null;
      theme?: string;
      controls: VizLedgerControls;
    }
  | {
      kind: "questions";
      statement: string;
      missingEvidence: string[];
      score: number;
      reasons: string[];
      hypothesisId?: string;
    }
  | {
      kind: "self";
      facet: SelfFacet | string;
      statement: string;
      confidence: number;
      evidenceCount: number;
    }
  | {
      kind: "interests";
      class: InterestClassTag | string;
      summary: string;
      recurrence: number;
      voluntaryReturn: number;
      energyDelta: number | null;
    }
  | {
      kind: "attr";
      projectKey: string;
      claimedHours: number;
      actualHours: number;
      pct: number;
      sessions: number;
    }
  | {
      kind: "diff";
      bucket: "emerging" | "fading" | "stable";
      statement: string;
      eventAnchors: string[];
    };

export interface VizLedgerRow {
  id: string;
  channel: VizLedgerChannel;
  title: string;
  subtitle?: string;
  score?: number;
  confidence?: number;
  /** PrimaryField plot coords 0–1 */
  x?: number;
  y?: number;
  detail: VizLedgerDetail;
}

export interface VizLedger {
  channel: VizLedgerChannel;
  generatedAt: string;
  rows: VizLedgerRow[];
  meters: VizMeter[];
  ticker?: string[];
}

export interface VizVerdictRequest {
  insightId: string;
  verdict: "confirm" | "reject" | "refine";
  note?: string;
  claim?: string;
  useful?: boolean;
  nonObvious?: boolean;
  retire?: boolean;
}

export interface VizVerdictResponse {
  ok: boolean;
  insightId: string;
  verdict: string;
  hypothesis?: Record<string, unknown>;
  error?: string;
}

/** Distillate kind for cached embedding→3D snapshots. */
export const VIZ_PROJECTION_KIND = "viz_projection" as const;

export interface VizProjectionSnapshot {
  version: number;
  generatedAt: string;
  pointLimit: number;
  points: Array<VizPoint3 & { distillateId?: string }>;
  orbits: VizOrbit[];
  labels: Array<{ id: string; label: string; x: number; y: number; z: number }>;
}

export function emptyDensity(view: VizView): VizDensity {
  return {
    view,
    generatedAt: new Date().toISOString(),
    points: [],
    orbits: [],
    edges: [],
    cores: [],
    streamRows: [],
    annotations: [],
    meters: [],
    channelBars: [],
    slices: [],
    meta: {
      empty: true,
      shellDriven: true,
      source: "degraded",
      degraded: true,
      budget: DENSITY_BUDGETS[view],
    },
  };
}

export function emptyLedger(channel: VizLedgerChannel): VizLedger {
  return {
    channel,
    generatedAt: new Date().toISOString(),
    rows: [],
    meters: [],
    ticker: [],
  };
}
