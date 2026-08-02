import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { InsightField } from "@/components/dataverse/InsightField";
import { NumericMatrix } from "@/components/dataverse/NumericMatrix";
import { SourceStrip } from "@/components/dataverse/SourceStrip";
import { useDensity } from "@/hooks/use-density";
import { crossChannels, sourceLabel } from "@/lib/overlays";

const title = "cross-platform insight — data-verse 02";
const description =
  "Large-scale correlation between platforms rendered as mirrored filament webs: thousands of nodes, linked clusters and channel readouts.";

export const Route = createFileRoute("/insights")({
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
  component: InsightPage,
});

function InsightPage() {
  const { data, degraded } = useDensity("cross");
  const channels = useMemo(() => crossChannels(data), [data]);

  return (
    <DvFrame title="cross-platform insight correlation field">
      <SourceStrip source={sourceLabel(data)} degraded={degraded} />
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px]">
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-3 py-2 text-dv-faint">
            <span>INSIGHT FIELD / MIRRORED FILAMENTS</span>
            <span className="hidden sm:inline">OPS ▲ / REFL ▼</span>
          </div>
          <div className="min-h-0 flex-1">
            <InsightField
              nodeCount={4600}
              channels={channels}
              halfLabels={{ top: "OPS", bottom: "REFL" }}
            />
          </div>
          <div className="dv-micro grid grid-cols-2 gap-x-6 gap-y-1 border-t border-dv-hair px-3 py-2 tabular-nums text-dv-faint xl:grid-cols-4">
            <span>SOURCES {String(channels?.length ?? 8).padStart(3, "0")}</span>
            <span>NODES 4.60E3</span>
            <span>ROT 0.075 RAD/S</span>
            <span>SPECTRUM THERMAL</span>
          </div>
        </section>
        <div className="hidden min-h-0 overflow-auto md:block md:border-l md:border-dv-line">
          <NumericMatrix title="MATRIX / SOURCES" seed={2211} rows={12} />
          <NumericMatrix title="MATRIX / DELTA" seed={7788} rows={12} />
        </div>
      </div>
    </DvFrame>
  );
}
