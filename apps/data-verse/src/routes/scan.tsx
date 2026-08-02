import { createFileRoute } from "@tanstack/react-router";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { BrainField } from "@/components/dataverse/BrainField";
import { ScanSlices } from "@/components/dataverse/ScanSlices";
import { IndexColumn } from "@/components/dataverse/IndexColumn";
import { NumericMatrix } from "@/components/dataverse/NumericMatrix";
import { useDensity } from "@/hooks/use-density";

export const Route = createFileRoute("/scan")({
  component: ScanPage,
});

function ScanPage() {
  const density = useDensity("scan");
  return (
    <DvFrame title="scan / encephalon volumetric dataset">
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden min-h-0 overflow-hidden md:flex md:flex-col md:border-r md:border-dv-line">
          <div className="min-h-0 flex-1 overflow-hidden">
            <IndexColumn meters={density.meters ?? []} title="INDEX / INTRAPERSONAL" />
          </div>
          <NumericMatrix title="MATRIX / SCAN" seed={9131} rows={4} />
        </div>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-3 py-2 text-dv-faint">
            <span>VOLUME FIELD / SELF-MODEL REGIONS</span>
            <span className="hidden sm:inline">FACETS + INTERESTS</span>
          </div>
          <div className="min-h-0 flex-[3]">
            <BrainField density={density} />
          </div>
          <div className="dv-micro flex items-center justify-between border-y border-dv-hair px-3 py-2 text-dv-faint">
            <span>SECTION MATRIX / DIFF SLICES</span>
            <span className="hidden sm:inline">SLABS {density.slices?.length ?? 0}</span>
          </div>
          <div className="min-h-0 flex-[2]">
            <ScanSlices density={density} />
          </div>
        </section>
      </div>
    </DvFrame>
  );
}
