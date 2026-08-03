import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { BrainField } from "@/components/dataverse/BrainField";
import { ScanSlices } from "@/components/dataverse/ScanSlices";
import { IndexColumn } from "@/components/dataverse/IndexColumn";
import { NumericMatrix } from "@/components/dataverse/NumericMatrix";
import { SourceStrip } from "@/components/dataverse/SourceStrip";
import { useDensity } from "@/hooks/use-density";
import {
  brainDataPoints,
  brainOverlays,
  panelMeters,
  scanReadouts,
  scanSliceOverlays,
  sourceLabel,
} from "@/lib/overlays";

const title = "scan / encephalon — data-verse 02";
const description =
  "A rotating volumetric brain scan with cortical folds, cerebellum and stem, sectioned into a sagittal slice matrix with hairline annotations.";

export const Route = createFileRoute("/scan")({
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
  component: ScanPage,
});

function ScanPage() {
  const { data, degraded } = useDensity("scan");
  const nodes = useMemo(() => brainOverlays(data), [data]);
  const meters = useMemo(() => panelMeters(data), [data]);
  const dataPoints = useMemo(() => brainDataPoints(data), [data]);
  const sliceOverlays = useMemo(() => scanSliceOverlays(data), [data]);
  const readouts = useMemo(() => scanReadouts(data), [data]);

  return (
    <DvFrame title="scan / encephalon volumetric dataset">
      <SourceStrip source={sourceLabel(data)} degraded={degraded} />
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden min-h-0 overflow-hidden md:flex md:flex-col md:border-r md:border-dv-line">
          <div className="min-h-0 flex-1 overflow-hidden">
            <IndexColumn title={readouts.sidebarTitle} meters={meters} />
          </div>
          <NumericMatrix title="MATRIX / SCAN" seed={9131} rows={4} />
        </div>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-3 py-2 text-dv-faint">
            <span>VOLUME FIELD / ENCEPHALON</span>
            <span className="hidden truncate sm:inline">{readouts.split}</span>
          </div>
          <div className="min-h-0 flex-[3]">
            <BrainField
              nodeOverlays={nodes}
              dataPoints={dataPoints}
              caption={readouts.caption}
            />
          </div>
          <div className="dv-micro flex items-center justify-between border-y border-dv-hair px-3 py-2 text-dv-faint">
            <span>SECTION MATRIX / SESSION SERIES</span>
            <span className="hidden sm:inline">{readouts.slab}</span>
          </div>
          <div className="min-h-0 flex-[2]">
            <ScanSlices overlays={sliceOverlays} />
          </div>
        </section>
      </div>
    </DvFrame>
  );
}
