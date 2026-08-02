import { createFileRoute, Link } from "@tanstack/react-router";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { BrainField } from "@/components/dataverse/BrainField";
import { ParticleField } from "@/components/dataverse/ParticleField";
import { InsightField } from "@/components/dataverse/InsightField";
import { TextStream } from "@/components/dataverse/TextStream";
import { useDensity } from "@/hooks/use-density";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const scan = useDensity("scan");
  const particle = useDensity("particle");
  const cross = useDensity("cross");
  const text = useDensity("text");

  const CARDS = [
    {
      to: "/scan" as const,
      id: "01",
      label: "SCAN / ENCEPHALON",
      meta: `PTS ${scan.points.length} / SLICES ${scan.slices?.length ?? 0}`,
      view: <BrainField density={scan} annotations={false} caption="" spin={0.2} />,
    },
    {
      to: "/particles" as const,
      id: "02",
      label: "PARTICLE / ORBITAL",
      meta: `PTS ${particle.points.length} / ORBITS ${particle.orbits?.length ?? 0}`,
      view: <ParticleField density={particle} />,
    },
    {
      to: "/insights" as const,
      id: "03",
      label: "CROSS-PLATFORM INSIGHT",
      meta: `SOURCES ${cross.channelBars?.length ?? 0} / NODES ${cross.points.length}`,
      view: <InsightField density={cross} />,
    },
    {
      to: "/streams" as const,
      id: "04",
      label: "TEXT / STRUCTURE",
      meta: `ROWS ${text.streamRows?.length ?? 0}`,
      view: <TextStream density={text} />,
    },
    {
      to: "/ledger" as const,
      id: "05",
      label: "LEDGER / MIRROR",
      meta: "INSIGHT CARDS / VIR / SELF",
      view: (
        <div className="dv-micro flex h-full items-center justify-center text-dv-faint">
          LEDGER INSTRUMENT
        </div>
      ),
    },
  ];

  return (
    <DvFrame title="data-verse — index of views">
      <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-4 py-2 text-dv-faint">
        <span>INDEX / 05 VIEWS / DENSITY + LEDGER</span>
        <span className="hidden sm:inline">SELECT MODE TO ENTER</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-5 md:grid-cols-3 md:grid-rows-2">
        {CARDS.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="group relative min-h-0 overflow-hidden border-b border-r border-dv-hair"
          >
            <div className="absolute inset-0 opacity-70 transition-opacity group-hover:opacity-100">
              {c.view}
            </div>
            <div className="dv-micro pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-3 py-2 text-dv-dim">
              <span className="text-dv-fg">
                {c.id} / {c.label}
              </span>
              <span className="opacity-0 transition-opacity group-hover:opacity-100">ENTER →</span>
            </div>
            <div className="dv-micro pointer-events-none absolute inset-x-0 bottom-0 px-3 py-2 tabular-nums text-dv-faint">
              {c.meta}
            </div>
          </Link>
        ))}
      </div>
    </DvFrame>
  );
}
