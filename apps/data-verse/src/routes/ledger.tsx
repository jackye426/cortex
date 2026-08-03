import { createFileRoute } from "@tanstack/react-router";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { LedgerField } from "@/components/dataverse/LedgerField";

const title = "ledger / mirror — data-verse 05";
const description =
  "The readable insight instrument: mirror cards, open questions, self-model facets, interests, priority-vs-actual and VIR controls.";

export const Route = createFileRoute("/ledger")({
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
  component: LedgerPage,
});

function LedgerPage() {
  return (
    <DvFrame title="ledger / mirror insight instrument">
      <div className="dv-micro flex items-center justify-between border-b border-dv-hair px-3 py-2 text-dv-faint">
        <span>LEDGER / READABLE PRODUCT SURFACE</span>
        <span className="hidden sm:inline">ONLY INDEX WITH VIR CONTROLS</span>
      </div>
      <LedgerField />
    </DvFrame>
  );
}
