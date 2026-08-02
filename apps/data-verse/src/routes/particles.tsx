import { createFileRoute } from "@tanstack/react-router";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { ParticleField } from "@/components/dataverse/ParticleField";
import { ReadoutColumn } from "@/components/dataverse/ReadoutColumn";
import { useDensity } from "@/hooks/use-density";

export const Route = createFileRoute("/particles")({
  component: ParticlePage,
});

function ParticlePage() {
  const density = useDensity("particle");
  return (
    <DvFrame title="particle / orbital spatial dataset">
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px]">
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-3 py-2 text-dv-faint">
            <span>SPATIAL FIELD / ATTENTION GEOMETRY</span>
            <span className="hidden sm:inline">EMBEDDING PROJECTION</span>
          </div>
          <div className="min-h-0 flex-1">
            <ParticleField density={density} />
          </div>
          <div className="dv-micro grid grid-cols-2 gap-x-6 gap-y-1 border-t border-dv-hair px-3 py-2 tabular-nums text-dv-faint xl:grid-cols-4">
            <span>PTS {density.points.length}</span>
            <span>ORBITS {(density.orbits ?? []).length}</span>
            <span>ACCENT {(density.orbits ?? []).filter((o) => o.accent).length}</span>
            <span>LABELS {(density.annotations ?? []).length}</span>
          </div>
        </section>
        <div className="hidden min-h-0 overflow-hidden md:flex md:flex-col md:border-l md:border-dv-line">
          <ReadoutColumn meters={density.meters ?? []} />
        </div>
      </div>
    </DvFrame>
  );
}
