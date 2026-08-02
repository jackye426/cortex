import { createFileRoute } from "@tanstack/react-router";
import { DvFrame } from "@/components/dataverse/DvFrame";
import { LedgerField } from "@/components/dataverse/LedgerField";

export const Route = createFileRoute("/ledger")({
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
