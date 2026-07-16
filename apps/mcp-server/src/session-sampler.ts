/**
 * Deterministic stratified session sampler for distillate prompts.
 * first + middle + last + tool-heavy, deduped, order-preserving.
 */

export interface SampleTurn {
  index: number;
  role: string;
  content: string;
  toolHeavy?: boolean;
  messageId?: string;
}

export interface SampleStrategy {
  name: "first_mid_last_tool";
  firstN: number;
  lastN: number;
  middleN: number;
  toolHeavyN: number;
  maxTotal: number;
  excerptChars: number;
}

export interface SampleResult {
  turns: SampleTurn[];
  indices: number[];
  totalTurnCount: number;
  sampleStrategy: SampleStrategy;
  metadataOnly: boolean;
}

export const DEFAULT_SAMPLE_STRATEGY: SampleStrategy = {
  name: "first_mid_last_tool",
  firstN: 8,
  lastN: 8,
  middleN: 6,
  toolHeavyN: 12,
  maxTotal: 40,
  excerptChars: 500,
};

const TOOL_HEAVY_HINT =
  /\b(write|edit|apply|patch|shell|bash|run|git|test|build|deploy|search|grep|read|tool)\b/i;

function isToolHeavy(turn: SampleTurn): boolean {
  if (turn.toolHeavy) return true;
  if (turn.role === "tool") return true;
  return TOOL_HEAVY_HINT.test(turn.content);
}

function evenlySpacedIndices(length: number, count: number, exclude: Set<number>): number[] {
  if (length <= 0 || count <= 0) return [];
  const out: number[] = [];
  if (count === 1) {
    const mid = Math.floor((length - 1) / 2);
    if (!exclude.has(mid)) out.push(mid);
    return out;
  }
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (length - 1)) / (count - 1));
    if (!exclude.has(idx)) out.push(idx);
  }
  return out;
}

/**
 * Sample turns for distillate prompting.
 * Prefers user/assistant text; still includes tool-heavy markers.
 */
export function sampleSessionTurns(
  turns: SampleTurn[],
  strategy: SampleStrategy = DEFAULT_SAMPLE_STRATEGY,
): SampleResult {
  const totalTurnCount = turns.length;
  if (totalTurnCount === 0) {
    return {
      turns: [],
      indices: [],
      totalTurnCount: 0,
      sampleStrategy: strategy,
      metadataOnly: true,
    };
  }

  if (totalTurnCount <= strategy.maxTotal) {
    const all = turns.map((t, i) => ({
      ...t,
      index: t.index ?? i,
      content: t.content.slice(0, strategy.excerptChars),
    }));
    return {
      turns: all,
      indices: all.map((t) => t.index),
      totalTurnCount,
      sampleStrategy: strategy,
      metadataOnly: false,
    };
  }

  const selected = new Set<number>();
  const n = totalTurnCount;

  for (let i = 0; i < Math.min(strategy.firstN, n); i++) selected.add(i);
  for (let i = 0; i < Math.min(strategy.lastN, n); i++) {
    selected.add(n - 1 - i);
  }

  const middleCandidates = evenlySpacedIndices(n, strategy.middleN * 2, selected);
  for (const idx of middleCandidates) {
    if (selected.size >= strategy.maxTotal) break;
    // Prefer middle band (exclude extreme ends already covered)
    if (idx < strategy.firstN || idx >= n - strategy.lastN) continue;
    selected.add(idx);
    if ([...selected].filter((i) => i >= strategy.firstN && i < n - strategy.lastN).length >=
      strategy.middleN) {
      // enough middle picks
    }
  }
  // Ensure we have middleN middle picks when possible
  let middleAdded = [...selected].filter(
    (i) => i >= strategy.firstN && i < n - strategy.lastN,
  ).length;
  for (let i = strategy.firstN; i < n - strategy.lastN && middleAdded < strategy.middleN; i++) {
    if (selected.has(i)) continue;
    // take evenly: stride through middle
    const stride = Math.max(
      1,
      Math.floor((n - strategy.firstN - strategy.lastN) / Math.max(1, strategy.middleN)),
    );
    if ((i - strategy.firstN) % stride === 0) {
      selected.add(i);
      middleAdded += 1;
    }
  }

  const toolHeavy = turns
    .map((t, i) => ({ t: { ...t, index: t.index ?? i }, i: t.index ?? i }))
    .filter(({ t }) => isToolHeavy(t))
    .map(({ i }) => i);
  let toolAdded = 0;
  for (const i of toolHeavy) {
    if (toolAdded >= strategy.toolHeavyN) break;
    if (selected.has(i)) continue;
    if (selected.size >= strategy.maxTotal) break;
    selected.add(i);
    toolAdded += 1;
  }

  // If over cap, prefer keeping first/last/tool, drop extra middle
  if (selected.size > strategy.maxTotal) {
    const ordered = [...selected].sort((a, b) => a - b);
    const mustKeep = new Set<number>();
    for (let i = 0; i < Math.min(strategy.firstN, n); i++) mustKeep.add(i);
    for (let i = 0; i < Math.min(strategy.lastN, n); i++) mustKeep.add(n - 1 - i);
    for (const i of toolHeavy.slice(0, strategy.toolHeavyN)) mustKeep.add(i);
    const rest = ordered.filter((i) => !mustKeep.has(i));
    const keepRest = rest.slice(0, Math.max(0, strategy.maxTotal - mustKeep.size));
    selected.clear();
    for (const i of mustKeep) selected.add(i);
    for (const i of keepRest) selected.add(i);
  }

  const indices = [...selected].sort((a, b) => a - b);
  const sampled = indices.map((i) => {
    const t = turns[i]!;
    return {
      ...t,
      index: t.index ?? i,
      content: t.content.slice(0, strategy.excerptChars),
      toolHeavy: isToolHeavy(t),
    };
  });

  return {
    turns: sampled,
    indices,
    totalTurnCount,
    sampleStrategy: strategy,
    metadataOnly: false,
  };
}

export function turnsToExcerpts(turns: SampleTurn[]): string[] {
  return turns.map((t) => {
    const role = t.role || "msg";
    return `[#${t.index}] ${role}: ${t.content}`;
  });
}
