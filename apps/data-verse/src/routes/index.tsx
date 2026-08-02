import { createFileRoute, Link } from "@tanstack/react-router";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { BrainField } from "@/components/dataverse/BrainField";
import { ParticleField } from "@/components/dataverse/ParticleField";
import { InsightField } from "@/components/dataverse/InsightField";
import { TextStream } from "@/components/dataverse/TextStream";
import { PrimaryField } from "@/components/dataverse/PrimaryField";

const title = "data-verse 02 — index of views";
const description =
  "A monochrome computational data system: volumetric brain scans, orbital particle fields, cross-platform insight webs and typographic data streams.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
  }),
  component: Index,
});

const CARDS = [
  {
    to: "/scan" as const,
    id: "01",
    label: "SCAN / ENCEPHALON",
    meta: "9.00E3 PTS / 32 SLICES / PERSP f=3.40",
    view: <BrainField annotations={false} caption="" spin={0.2} />,
  },
  {
    to: "/particles" as const,
    id: "02",
    label: "PARTICLE / ORBITAL",
    meta: "5.20E3 PTS / 22 ORBITS / DRIFT 0.09",
    view: <ParticleField count={1400} orbits={10} />,
  },
  {
    to: "/insights" as const,
    id: "03",
    label: "CROSS-PLATFORM INSIGHT",
    meta: "8 CHANNELS / MIRRORED FILAMENTS",
    view: <InsightField nodeCount={1400} />,
  },
  {
    to: "/streams" as const,
    id: "04",
    label: "TEXT / STRUCTURE",
    meta: "WALL / 180 CHANNELS",
    view: <TextStream cols={600} />,
  },
  {
    to: "/ledger" as const,
    id: "05",
    label: "LEDGER / MIRROR",
    meta: "VIR / READABLE INSTRUMENT",
    view: <PrimaryField label="LEDGER / FIELD" />,
  },
];

function Index() {
  return (
    <DvFrame title="data-verse 02 — index of views">
      <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-4 py-2 text-dv-faint">
        <span>INDEX / 05 VIEWS / ONE DATA WORLD</span>
        <span className="hidden sm:inline">SELECT MODE TO ENTER</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-5 md:grid-cols-3 md:grid-rows-2">
        {CARDS.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className={`group relative min-h-0 overflow-hidden border-b border-r border-dv-hair ${
              c.id === "05" ? "md:col-span-1" : ""
            }`}
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
