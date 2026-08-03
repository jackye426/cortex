/** Deterministic fixtures for offline AC2 — SSR-safe seeds. */
import {
  VIZ_SOURCE_FAMILIES,
  type VizDensity,
  type VizLedger,
  type VizLedgerChannel,
  type VizPoint3,
  type VizStreamRow,
} from "@cortex/viz-contracts";

export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function pad(n: number, width = 3) {
  return Math.abs(Math.floor(n)).toString().padStart(width, "0");
}

export function hex(n: number, width = 4) {
  return Math.floor(n).toString(16).toUpperCase().padStart(width, "0");
}

const FACETS = [
  "strengths",
  "limitations",
  "motives",
  "tensions",
  "identity",
] as const;

const REGION_CENTERS: Record<(typeof FACETS)[number], { x: number; y: number; z: number }> = {
  strengths: { x: 0.7, y: 0.25, z: 0.25 },
  limitations: { x: -0.65, y: 0.2, z: -0.3 },
  motives: { x: 0.15, y: 0.55, z: -0.4 },
  tensions: { x: 0.05, y: -0.1, z: 0.55 },
  identity: { x: -0.2, y: -0.45, z: 0.05 },
};

function fixturePoints(count: number, seed: number): VizPoint3[] {
  const rnd = seeded(seed);
  const pts: VizPoint3[] = [];
  for (let i = 0; i < count; i++) {
    const region = FACETS[i % FACETS.length]!;
    const c = REGION_CENTERS[region];
    pts.push({
      id: `p${i}`,
      x: c.x + (rnd() - 0.5) * 0.55,
      y: c.y + (rnd() - 0.5) * 0.45,
      z: c.z + (rnd() - 0.5) * 0.45,
      a: 0.3 + rnd() * 0.7,
      s: rnd() < 0.08 ? 1.7 : 1,
      region,
      confidence: 0.4 + rnd() * 0.55,
      evidenceFamilies: 1 + Math.floor(rnd() * 4),
    });
  }
  return pts;
}

export function fixtureScan(): VizDensity {
  const points = fixturePoints(2400, 4412219);
  const slices = Array.from({ length: 32 }, (_, i) => ({
    pos: 1.15 - (i / 31) * 2.3,
  }));
  return {
    view: "scan",
    generatedAt: "2026-08-02T00:00:00.000Z",
    points,
    annotations: [
      { id: "N01", label: "TENSION/AVOIDANCE", x: 0.1, y: -0.05, z: 0.5 },
      { id: "N02", label: "STRENGTH/SYSTEMS", x: 0.72, y: 0.28, z: 0.22 },
      { id: "N03", label: "MOTIVE/BUILD", x: 0.12, y: 0.52, z: -0.38 },
    ],
    meters: [
      { id: "01", label: "ENERGY", value: 0.62 },
      { id: "02", label: "VALENCE", value: 0.48 },
      { id: "03", label: "FRICTION", value: 0.71 },
      { id: "04", label: "FLOW", value: 0.39 },
      { id: "05", label: "VIR30", value: 0.44 },
      { id: "06", label: "PROV", value: 0.81 },
    ],
    slices,
    meta: { regions: FACETS.length, fixture: true },
  };
}

export function fixtureParticle(): VizDensity {
  const rnd = seeded(66123);
  const points = Array.from({ length: 3200 }, (_, i) => {
    const u = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const rad = 0.35 + Math.pow(rnd(), 2.4) * 0.55;
    return {
      id: `pt${i}`,
      x: r * Math.cos(t) * rad,
      y: u * rad * 0.82,
      z: r * Math.sin(t) * rad,
      a: 0.25 + rnd() * 0.75,
    };
  });
  const orbits = Array.from({ length: 12 }, (_, i) => ({
    tilt: rnd() * Math.PI,
    yaw: rnd() * Math.PI * 2,
    r: 0.9 + rnd() * 1.8,
    ecc: 0.35 + rnd() * 0.6,
    accent: i === 3 || i === 7,
    id: i < 4 ? `priority-${i}` : `cycle-${i}`,
    label: i < 4 ? `PRIORITY/${i}` : `CYCLE/${i}`,
  }));
  return {
    view: "particle",
    generatedAt: "2026-08-02T00:00:00.000Z",
    points,
    orbits,
    annotations: [
      { id: "L01", label: "cortex", x: 0.4, y: 0.1, z: -0.2 },
      { id: "L02", label: "mirror", x: -0.5, y: 0.2, z: 0.3 },
    ],
    meters: [
      { id: "01", label: "AX/HOURS", value: 0.55 },
      { id: "02", label: "AY/SESS", value: 0.42 },
      { id: "03", label: "AZ/PRIO", value: 0.78 },
      { id: "04", label: "BX/DRIFT", value: 0.33 },
    ],
    meta: { fixture: true },
  };
}

export function fixtureCross(): VizDensity {
  const rnd = seeded(313377);
  const cores = VIZ_SOURCE_FAMILIES.slice(0, 8).map((label) => ({
    id: label,
    label,
    x: (rnd() - 0.5) * 1.7,
    y: (rnd() - 0.5) * 0.9,
    z: (rnd() - 0.5) * 1.2,
  }));
  const points: VizPoint3[] = [];
  const edges: VizDensity["edges"] = [];
  for (let s = 0; s < 40; s++) {
    const c = cores[s % cores.length]!;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    let prev = -1;
    for (let i = 0; i < 18; i++) {
      x += (rnd() - 0.5) * 0.08;
      y += (rnd() - 0.5) * 0.06;
      z += (rnd() - 0.5) * 0.08;
      const idx = points.length;
      points.push({ x, y, z, a: 0.4 + rnd() * 0.5, id: `n${idx}` });
      if (prev >= 0) {
        edges!.push({
          a: prev,
          b: idx,
          weight: 0.35 + rnd() * 0.65,
          polarity: rnd() > 0.85 ? "contradicts" : "supports",
        });
      }
      prev = idx;
    }
  }
  return {
    view: "cross",
    generatedAt: "2026-08-02T00:00:00.000Z",
    points,
    edges,
    cores,
    channelBars: VIZ_SOURCE_FAMILIES.slice(0, 8).map((label, i) => ({
      id: pad(i + 1, 2),
      label,
      value: 0.2 + ((i * 17) % 70) / 100,
    })),
    meters: [
      { id: "01", label: "CROSS", value: 0.66 },
      { id: "02", label: "DROWN", value: 0.28 },
      { id: "03", label: "EMBED", value: 0.74 },
    ],
    meta: { fixture: true, sources: 8 },
  };
}

export function fixtureText(): VizDensity {
  const rnd = seeded(778811);
  const samples = [
    "session cursor distillate summary next-actions friction",
    "observation energy dip after calendar cluster Tue",
    "digest youtube interest map systems design lane",
    "ask_mirror cited synthesis provenance families=3",
    "turn user: ship the viz projection job tonight",
    "portrait v12 supersedes identity tension around depth",
  ];
  const streamRows: VizStreamRow[] = Array.from({ length: 180 }, (_, r) => {
    const base = samples[r % samples.length]!;
    let text = "";
    while (text.length < 200) {
      text += base.replace(/\s/g, "").toUpperCase().slice(0, 12 + Math.floor(rnd() * 20));
      text += " ";
      if (rnd() < 0.2) text += hex(rnd() * 65535) + " ";
    }
    text = text.slice(0, 200);
    const invert: Array<[number, number]> = [];
    if (rnd() < 0.45) {
      const a = Math.floor(rnd() * 160);
      invert.push([a, a + 8 + Math.floor(rnd() * 24)]);
    }
    return {
      text,
      speed: (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 120),
      phase: rnd() * 200,
      alpha: 0.22 + rnd() * 0.78,
      invert,
      accent: rnd() > 0.985,
      kind: (["session", "observation", "digest"] as const)[r % 3],
    };
  });
  return {
    view: "text",
    generatedAt: "2026-08-02T00:00:00.000Z",
    points: [],
    streamRows,
    meters: [
      { id: "01", label: "RATE", value: 0.54 },
      { id: "02", label: "SESS", value: 0.61 },
      { id: "03", label: "OBS", value: 0.37 },
    ],
    meta: { fixture: true },
  };
}

export function fixtureDensity(view: VizDensity["view"]): VizDensity {
  switch (view) {
    case "scan":
      return fixtureScan();
    case "particle":
      return fixtureParticle();
    case "cross":
      return fixtureCross();
    case "text":
      return fixtureText();
  }
}

export function fixtureLedger(channel: VizLedgerChannel): VizLedger {
  const generatedAt = "2026-08-02T00:00:00.000Z";
  const meters = [
    { id: "VIR7", label: "VIR7", value: 0.5 },
    { id: "VIR30", label: "VIR30", value: 0.44 },
    { id: "VIR90", label: "VIR90", value: 0.38 },
    { id: "PROV", label: "PROVENANCE", value: 0.81 },
    { id: "MFAM", label: "MULTI_FAM", value: 0.62 },
    { id: "OUT", label: "DEC_OUT", value: 0.55 },
  ];
  const ticker = [
    "PIPELINE weekly ok",
    "OBS +12",
    "VERDICT confirm H-8821",
    hex(0x4a2f),
  ];

  const byChannel: Record<VizLedgerChannel, VizLedger> = {
    mirror: {
      channel: "mirror",
      generatedAt,
      meters,
      ticker,
      rows: [
        {
          id: "wm-energy",
          channel: "mirror",
          title: "ENERGY / DIP",
          subtitle: "theme=energy",
          confidence: 0.72,
          x: 0.3,
          y: 0.7,
          detail: {
            kind: "mirror",
            theme: "energy",
            notice: "Energy dips cluster after dense calendar mornings.",
            why: "Affect energy signals align with calendar load peaks.",
            evidenceCount: 4,
            confidence: 0.72,
            rival: "Sleep debt alone explains the dip.",
            test: "Log energy mid-day for 5 calendar-heavy days.",
            contradictions: ["One high-energy exception on Wed"],
            hypothesisId: "hyp-energy-1",
            controls: { confirm: true, reject: true, refine: true },
          },
        },
        {
          id: "wm-attention",
          channel: "mirror",
          title: "ATTENTION / DEPTH",
          subtitle: "theme=attention",
          confidence: 0.68,
          x: 0.55,
          y: 0.6,
          detail: {
            kind: "mirror",
            theme: "attention",
            notice: "Long Cursor sessions concentrate on cortex viz work.",
            why: "Session distillates show repeated project keys.",
            evidenceCount: 5,
            confidence: 0.68,
            rival: "Novelty bias from a new UI repo.",
            test: "Compare next week session mix without viz tasks.",
            contradictions: [],
            hypothesisId: "hyp-attn-1",
            controls: { confirm: true, reject: true, refine: true },
          },
        },
      ],
    },
    questions: {
      channel: "questions",
      generatedAt,
      meters,
      ticker,
      rows: [
        {
          id: "q1",
          channel: "questions",
          title: "AVOIDANCE / REVIEW",
          subtitle: "score=0.81",
          score: 0.81,
          confidence: 0.42,
          x: 0.42,
          y: 0.81,
          detail: {
            kind: "questions",
            statement: "Code review is deferred when calendar density is high.",
            missingEvidence: ["email", "people_feedback"],
            score: 0.81,
            reasons: ["high_uncertainty", "source_gap"],
            hypothesisId: "hyp-avoid-1",
          },
        },
      ],
    },
    self: {
      channel: "self",
      generatedAt,
      meters,
      ticker,
      rows: [
        {
          id: "self-s1",
          channel: "self",
          title: "STRENGTH / SYSTEMS",
          subtitle: "facet=strengths",
          confidence: 0.77,
          x: 0.77,
          y: 0.4,
          detail: {
            kind: "self",
            facet: "strengths",
            statement: "Builds durable multi-source memory substrates.",
            confidence: 0.77,
            evidenceCount: 6,
          },
        },
        {
          id: "self-t1",
          channel: "self",
          title: "TENSION / DEPTH",
          subtitle: "facet=tensions",
          confidence: 0.64,
          x: 0.64,
          y: 0.7,
          detail: {
            kind: "self",
            facet: "tensions",
            statement: "Depth work competes with cross-platform breadth.",
            confidence: 0.64,
            evidenceCount: 3,
          },
        },
      ],
    },
    interests: {
      channel: "interests",
      generatedAt,
      meters,
      ticker,
      rows: [
        {
          id: "int-1",
          channel: "interests",
          title: "TERMINAL / COMPUTATIONAL ART",
          subtitle: "class=terminal",
          confidence: 0.7,
          x: 0.8,
          y: 0.65,
          detail: {
            kind: "interests",
            class: "terminal",
            summary: "Sustained return to monochrome data aesthetics.",
            recurrence: 0.82,
            voluntaryReturn: 0.76,
            energyDelta: 0.2,
          },
        },
      ],
    },
    attr: {
      channel: "attr",
      generatedAt,
      meters,
      ticker,
      rows: [
        {
          id: "attr-cortex",
          channel: "attr",
          title: "CORTEX",
          subtitle: "pct=0.48",
          x: 0.48,
          y: 0.5,
          detail: {
            kind: "attr",
            projectKey: "cortex",
            claimedHours: 20,
            actualHours: 14.5,
            pct: 0.48,
            sessions: 22,
          },
        },
      ],
    },
    diff: {
      channel: "diff",
      generatedAt,
      meters,
      ticker,
      rows: [
        {
          id: "diff-e1",
          channel: "diff",
          title: "EMERGING / VIZ",
          subtitle: "bucket=emerging",
          x: 0.6,
          y: 0.3,
          detail: {
            kind: "diff",
            bucket: "emerging",
            statement: "Visualization as primary mirror surface.",
            eventAnchors: ["data-verse-render", "weekly-mirror"],
          },
        },
        {
          id: "diff-f1",
          channel: "diff",
          title: "FADING / DASHBOARD",
          subtitle: "bucket=fading",
          x: 0.3,
          y: 0.55,
          detail: {
            kind: "diff",
            bucket: "fading",
            statement: "Consumer dashboard chrome as product UI.",
            eventAnchors: ["mirror-web-deferred"],
          },
        },
      ],
    },
  };

  return byChannel[channel];
}
