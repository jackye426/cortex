import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { TextStream } from "@/components/dataverse/TextStream";
import { NumericMatrix } from "@/components/dataverse/NumericMatrix";
import { SourceStrip } from "@/components/dataverse/SourceStrip";
import { useDensity } from "@/hooks/use-density";
import { sourceLabel, textSeedTexts } from "@/lib/overlays";

const title = "text / structure — data-verse 02";
const description =
  "Structured records rendered typographically: scrolling bands of glyph blocks, connectors and hexadecimal keys across a black field.";

export const Route = createFileRoute("/streams")({
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
  component: StreamsPage,
});

function StreamsPage() {
  const { data, degraded } = useDensity("text");
  const seeds = useMemo(() => textSeedTexts(data), [data]);

  return (
    <DvFrame title="text / structure record streams">
      <SourceStrip source={sourceLabel(data)} degraded={degraded} />
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden min-h-0 overflow-auto md:block md:border-r md:border-dv-line">
          <NumericMatrix title="MATRIX / KEYS" seed={5150} rows={14} />
          <NumericMatrix title="MATRIX / HASH" seed={6161} rows={14} />
        </div>
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-3 py-2 text-dv-faint">
            <span>RECORD STREAM / STRUCTURED TEXT</span>
            <span className="hidden sm:inline">ENCODING HEX / LINKED KEYS</span>
          </div>
          <div className="min-h-0 flex-1">
            <TextStream cols={900} seedTexts={seeds} />
          </div>
          <div className="dv-micro grid grid-cols-2 gap-x-6 gap-y-1 border-t border-dv-hair px-3 py-2 tabular-nums text-dv-faint xl:grid-cols-4">
            <span>CHANNELS 180</span>
            <span>GLYPHS 1.62E5</span>
            <span>RATE 5-43 CH/S</span>
            <span>INVERSION SPARSE</span>
          </div>
        </section>
      </div>
    </DvFrame>
  );
}
