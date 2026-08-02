import { createFileRoute } from "@tanstack/react-router";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { InsightField } from "@/components/dataverse/InsightField";
import { NumericMatrix } from "@/components/dataverse/NumericMatrix";
import { useDensity } from "@/hooks/use-density";

export const Route = createFileRoute("/insights")({
  component: InsightPage,
});

function InsightPage() {
  const density = useDensity("cross");
  return (
    <DvFrame title="cross-platform insight correlation field">
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px]">
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-3 py-2 text-dv-faint">
            <span>INSIGHT FIELD / SOURCE FILAMENTS</span>
            <span className="hidden sm:inline">CORTEX SOURCE FAMILIES</span>
          </div>
          <div className="min-h-0 flex-1">
            <InsightField density={density} />
          </div>
          <div className="dv-micro grid grid-cols-2 gap-x-6 gap-y-1 border-t border-dv-hair px-3 py-2 tabular-nums text-dv-faint xl:grid-cols-4">
            <span>SOURCES {(density.channelBars ?? []).length}</span>
            <span>NODES {density.points.length}</span>
            <span>LINKS {(density.edges ?? []).length}</span>
            <span>CORES {(density.cores ?? []).length}</span>
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
