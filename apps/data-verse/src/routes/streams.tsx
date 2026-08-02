import { createFileRoute } from "@tanstack/react-router";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { TextStream } from "@/components/dataverse/TextStream";
import { NumericMatrix } from "@/components/dataverse/NumericMatrix";
import { useDensity } from "@/hooks/use-density";

export const Route = createFileRoute("/streams")({
  component: StreamsPage,
});

function StreamsPage() {
  const density = useDensity("text");
  return (
    <DvFrame title="text / structure record streams">
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden min-h-0 overflow-auto md:block md:border-r md:border-dv-line">
          <NumericMatrix title="MATRIX / KEYS" seed={5150} rows={14} />
          <NumericMatrix title="MATRIX / HASH" seed={6161} rows={14} />
        </div>
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-3 py-2 text-dv-faint">
            <span>RECORD STREAM / THROUGHPUT WALL</span>
            <span className="hidden sm:inline">CHATS / DIGESTS / OBSERVATIONS</span>
          </div>
          <div className="min-h-0 flex-1">
            <TextStream density={density} />
          </div>
          <div className="dv-micro grid grid-cols-2 gap-x-6 gap-y-1 border-t border-dv-hair px-3 py-2 tabular-nums text-dv-faint xl:grid-cols-4">
            <span>CHANNELS {density.streamRows?.length ?? 0}</span>
            <span>METERS {(density.meters ?? []).length}</span>
            <span>KIND TEXTURE</span>
            <span>NOT A READER</span>
          </div>
        </section>
      </div>
    </DvFrame>
  );
}
