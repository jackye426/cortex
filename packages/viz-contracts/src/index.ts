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
}

export interface VizOrbit {
  tilt: number;
  yaw: number;
  r: number;
  ecc: number;
  accent: boolean;
  id?: string;
  label?: string;
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
  meta?: Record<string, unknown>;
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
    meta: { empty: true },
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
