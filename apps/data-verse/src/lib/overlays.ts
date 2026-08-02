/** Map VizDensity overlays onto restored generative shells. */
import type { VizDensity, VizMeter } from "@cortex/viz-contracts";
import type { BrainNodeOverlay } from "@/components/dataverse/BrainField";
import type { ChannelOverlay } from "@/components/dataverse/InsightField";

export function brainOverlays(d: VizDensity): BrainNodeOverlay[] | undefined {
  if (!d.annotations?.length) return undefined;
  return d.annotations.slice(0, 6).map((a) => ({
    id: a.id,
    label: a.label.slice(0, 24).toUpperCase(),
    x: a.x,
    y: a.y,
    z: a.z,
  }));
}

export function particleLabelTexts(d: VizDensity): string[] | undefined {
  const fromAnno = d.annotations?.map((a) => a.label) ?? [];
  const fromMeters = d.meters?.map((m) => m.label) ?? [];
  const merged = [...fromAnno, ...fromMeters].filter(Boolean);
  return merged.length ? merged : undefined;
}

export function crossChannels(d: VizDensity): ChannelOverlay[] | undefined {
  if (!d.channelBars?.length) return undefined;
  return d.channelBars.map((b) => ({ label: b.label, value: b.value }));
}

export function textSeedTexts(d: VizDensity): string[] | undefined {
  const rows = d.streamRows?.map((r) => r.text).filter(Boolean) ?? [];
  return rows.length ? rows : undefined;
}

export function panelMeters(d: VizDensity): VizMeter[] | undefined {
  return d.meters?.length ? d.meters : undefined;
}

export function isDegraded(d: VizDensity): boolean {
  return Boolean(d.meta?.degraded || d.meta?.source === "degraded" || d.meta?.source === "fixture");
}

export function sourceLabel(d: VizDensity): string {
  const src = d.meta?.source;
  if (src === "live") return "LIVE";
  if (src === "fixture") return "FIXTURE";
  if (src === "degraded") return "DEGRADED";
  return d.meta?.empty ? "EMPTY" : "SHELL";
}
