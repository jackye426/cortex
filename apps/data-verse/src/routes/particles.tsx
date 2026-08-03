import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { ParticleField } from "@/components/dataverse/ParticleField";
import { ReadoutColumn } from "@/components/dataverse/ReadoutColumn";
import { SourceStrip } from "@/components/dataverse/SourceStrip";
import { useDensity } from "@/hooks/use-density";
import { panelMeters, particleLabelTexts, sourceLabel } from "@/lib/overlays";

const title = "particle / orbital — data-verse 02";
const description =
  "A three-dimensional particle cloud crossed by hundreds of orbital trajectories, annotated with drifting coordinates and hexadecimal samples.";

export const Route = createFileRoute("/particles")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
  }),
  component: ParticlePage,
});

function ParticlePage() {
  const { data, degraded } = useDensity("particle");
  const labels = useMemo(() => particleLabelTexts(data), [data]);
  const meters = useMemo(() => panelMeters(data), [data]);

  return (
    <DvFrame title="particle / orbital spatial dataset">
      <SourceStrip source={sourceLabel(data)} degraded={degraded} />
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px]">
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-3 py-2 text-dv-faint">
            <span>SPATIAL FIELD / ORBITAL TRAJECTORIES</span>
            <span className="hidden sm:inline">FRAME BARYCENTRIC / EPOCH J2000</span>
          </div>
          <div className="min-h-0 flex-1">
            <ParticleField count={5200} orbits={22} labelTexts={labels} />
          </div>
          <div className="dv-micro grid grid-cols-2 gap-x-6 gap-y-1 border-t border-dv-hair px-3 py-2 tabular-nums text-dv-faint xl:grid-cols-4">
            <span>PTS 5.20E3</span>
            <span>ORBITS 022</span>
            <span>PRECESSION 0.050 RAD/S</span>
            <span>ACCENT CHANNELS 002</span>
          </div>
        </section>
        <div className="hidden min-h-0 overflow-hidden md:flex md:flex-col md:border-l md:border-dv-line">
          <ReadoutColumn meters={meters} title="READOUT / ATTR" />
        </div>
      </div>
    </DvFrame>
  );
}
