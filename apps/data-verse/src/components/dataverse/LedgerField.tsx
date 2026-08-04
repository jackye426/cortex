import { useMemo, useState } from "react";
import type { VizLedgerChannel, VizLedgerRow } from "@cortex/viz-contracts";
import { useLedger } from "@/hooks/use-ledger";
import { postVerdict } from "@/lib/viz-api";
import { IndexColumn } from "./IndexColumn";
import { ReadoutColumn } from "./ReadoutColumn";
import { PrimaryField } from "./PrimaryField";
import { SourceStrip } from "./SourceStrip";
import { NumericMatrix } from "./NumericMatrix";

const CHANNELS: Array<{ id: VizLedgerChannel; label: string }> = [
  { id: "mirror", label: "MIRROR" },
  { id: "questions", label: "QUESTIONS" },
  { id: "self", label: "SELF" },
  { id: "interests", label: "INTERESTS" },
  { id: "attr", label: "ATTR" },
  { id: "diff", label: "DIFF" },
];

function DetailPane({ row }: { row: VizLedgerRow | undefined }) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");

  if (!row) {
    return (
      <div className="dv-micro flex h-full items-center justify-center text-dv-faint">
        SELECT A ROW
      </div>
    );
  }

  const d = row.detail;

  async function verdict(v: "confirm" | "reject" | "refine") {
    if (!row) return;
    const insightId =
      d.kind === "mirror"
        ? d.hypothesisId
        : d.kind === "questions"
          ? d.hypothesisId
          : row.id;
    if (!insightId) {
      setStatus("NO_HYPOTHESIS_ID");
      return;
    }
    const res = await postVerdict({
      insightId,
      verdict: v,
      ...(note ? { note } : {}),
      ...(v === "refine" && note ? { claim: note } : {}),
    });
    setStatus(res.ok ? `OK/${v.toUpperCase()}` : `ERR/${res.error ?? "fail"}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="dv-micro border-b border-dv-hair px-3 py-2 text-dv-faint">
        DETAIL / {row.channel.toUpperCase()} / {row.id}
      </div>
      <div className="space-y-3 px-3 py-3 font-mono text-[11px] leading-relaxed text-dv-dim">
        <div className="text-dv-fg">{row.title}</div>
        {row.subtitle ? <div className="text-dv-faint">{row.subtitle}</div> : null}

        {d.kind === "mirror" && (
          <>
            {/* The claim leads. Everything under it exists to let you judge it. */}
            <div className="border-b border-dv-hair pb-3 text-[15px] leading-snug text-dv-fg">
              {d.notice}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Block label="WHY IT MATTERS" body={d.why} />
              <Block label="RIVAL EXPLANATION" body={d.rival} />
            </div>
            <div className="border border-dv-line p-2">
              <div className="dv-micro text-dv-faint">TEST</div>
              <div className="mt-1 text-dv-fg">{d.test}</div>
            </div>
            <div className="dv-micro flex flex-wrap gap-x-6 gap-y-1 tabular-nums text-dv-faint">
              <span>
                CONF <span className="text-dv-fg">{d.confidence.toFixed(3)}</span>
              </span>
              <span>
                EVIDENCE <span className="text-dv-fg">{d.evidenceCount}</span>
              </span>
              <span>
                CONTRA <span className="text-dv-fg">{d.contradictions.length}</span>
              </span>
              {d.theme ? <span>THEME {d.theme.toUpperCase()}</span> : null}
            </div>
            {d.contradictions.length > 0 && (
              <Block label="CONTRADICTIONS" body={d.contradictions.join(" | ")} />
            )}
          </>
        )}

        {d.kind === "questions" && (
          <>
            <Block label="STATEMENT" body={d.statement} />
            <Block label="SCORE" body={d.score.toFixed(4)} />
            <Block label="MISSING" body={d.missingEvidence.join(", ") || "—"} />
            <Block label="REASONS" body={d.reasons.join(", ")} />
          </>
        )}

        {d.kind === "self" && (
          <>
            <Block label="FACET" body={String(d.facet)} />
            <Block label="STATEMENT" body={d.statement} />
            <Meter label="CONF" value={d.confidence} />
            <Block label="EVIDENCE" body={`N=${d.evidenceCount}`} />
          </>
        )}

        {d.kind === "interests" && (
          <>
            <Block label="CLASS" body={String(d.class)} />
            <Block label="SUMMARY" body={d.summary} />
            <Meter label="RECURRENCE" value={d.recurrence} />
            <Meter label="VOLUNTARY" value={d.voluntaryReturn} />
            <Block
              label="ENERGY_DELTA"
              body={d.energyDelta == null ? "—" : d.energyDelta.toFixed(3)}
            />
          </>
        )}

        {d.kind === "attr" && (
          <>
            <Block label="PROJECT" body={d.projectKey} />
            <Meter label="PCT" value={d.pct} />
            <Block
              label="HOURS"
              body={`claimed=${d.claimedHours} actual=${d.actualHours} sessions=${d.sessions}`}
            />
          </>
        )}

        {d.kind === "diff" && (
          <>
            <Block label="BUCKET" body={d.bucket} />
            <Block label="STATEMENT" body={d.statement} />
            <Block label="ANCHORS" body={d.eventAnchors.join(", ") || "—"} />
          </>
        )}

        {/*
          Always present, whatever the channel. The verdict loop is the point of
          this index and it was previously reachable only inside mirror rows —
          which is why validated-insight-rate has never moved off zero.
        */}
        <div className="space-y-2 border border-dv-line p-2">
          <div className="dv-micro flex items-center justify-between text-dv-faint">
            <span>VERDICT</span>
            <span className="tabular-nums">{row.id.slice(0, 18)}</span>
          </div>
          <input
            className="w-full border border-dv-hair bg-transparent px-2 py-1 text-dv-fg outline-none placeholder:text-dv-faint"
            placeholder="NOTE / REFINED CLAIM"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {(["confirm", "reject", "refine"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className="border border-dv-line px-3 py-1 text-dv-fg transition-colors hover:bg-dv-fg hover:text-dv-bg"
                onClick={() => void verdict(v)}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
          {status ? <div className="dv-micro text-dv-accent">{status}</div> : null}
        </div>
      </div>
    </div>
  );
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="dv-micro text-dv-faint">{label}</div>
      <div className="mt-1 text-dv-fg">{body}</div>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="dv-micro flex justify-between text-dv-faint">
        <span>{label}</span>
        <span>{value.toFixed(4)}</span>
      </div>
      <div className="mt-1 h-[3px] w-full bg-dv-hair">
        <div
          className="h-full bg-dv-fg"
          style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }}
        />
      </div>
    </div>
  );
}

/** Index 05 — dense Ikeda instrument (readable + instrument panels). */
export function LedgerField() {
  const [channel, setChannel] = useState<VizLedgerChannel>("mirror");
  const { data: ledger, degraded } = useLedger(channel);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  // A worklist, not a browser: the claims worth judging first are the ones
  // carrying both confidence and evidence behind them.
  const rows = useMemo(() => {
    const weight = (r: VizLedgerRow): number => {
      const conf = r.confidence ?? r.score ?? 0;
      const evidence =
        r.detail.kind === "mirror"
          ? r.detail.evidenceCount
          : r.detail.kind === "self"
            ? r.detail.evidenceCount
            : 1;
      return conf * Math.min(evidence, 5);
    };
    return [...ledger.rows].sort((a, b) => weight(b) - weight(a));
  }, [ledger.rows]);

  const selected = useMemo(
    () => rows.find((r) => r.id === (activeId ?? rows[0]?.id)),
    [rows, activeId],
  );

  const indexMeters = rows.map((r) => ({
    id: r.id,
    label: r.title,
    value: r.confidence ?? r.score ?? r.x ?? 0.5,
  }));

  /** Axis meaning differs per channel; unlabelled they were unreadable. */
  const axes: Record<VizLedgerChannel, { x: string; y: string }> = {
    mirror: { x: "CONFIDENCE", y: "EVIDENCE" },
    questions: { x: "CONFIDENCE", y: "PRIORITY" },
    self: { x: "CONFIDENCE", y: "EVIDENCE" },
    interests: { x: "RECURRENCE", y: "VOLUNTARY RETURN" },
    attr: { x: "SHARE", y: "HOURS" },
    diff: { x: "CONFIDENCE", y: "MOVEMENT" },
  };

  // The plot area is wide and short, and the viewBox is stretched to fill it,
  // so marks squash vertically. A ledger channel holds a handful of rows rather
  // than hundreds of samples, so they need to be drawn much larger to register.
  const swarm = rows.map((r) => ({
    x: r.x ?? 0.5,
    y: 1 - (r.y ?? 0.5),
    r: selected?.id === r.id ? 16 : 9,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SourceStrip source={degraded ? "DEGRADED" : "LIVE"} degraded={degraded} />
      <div className="dv-micro border-b border-dv-hair px-3 py-1 tabular-nums text-dv-faint">
        {(ledger.ticker ?? [`LEDGER/${channel.toUpperCase()}`]).join(" · ")}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)_220px]">
        <div className="flex min-h-0 flex-col border-r border-dv-line">
          <div className="dv-micro flex flex-wrap border-b border-dv-hair text-dv-faint">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setChannel(c.id);
                  setActiveId(undefined);
                }}
                className={`border-r border-dv-hair px-2 py-2 ${
                  channel === c.id ? "bg-dv-fg text-dv-bg" : "hover:text-dv-fg"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <IndexColumn
            title={`QUEUE / ${channel.toUpperCase()} / ${rows.length}`}
            meters={indexMeters}
            activeId={selected?.id}
            onSelect={setActiveId}
          />
          <NumericMatrix title="MATRIX / LEDGER" seed={4401} rows={6} />
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-h-0 border-b border-dv-hair">
            <PrimaryField
              swarm={swarm}
              label={`FIELD / ${channel.toUpperCase()}`}
              axes={axes[channel]}
            />
          </div>
          <DetailPane row={selected} />
        </div>

        <div className="hidden min-h-0 flex-col border-l border-dv-line md:flex">
          <ReadoutColumn meters={ledger.meters} title="METRICS / VIR" />
          <NumericMatrix title="MATRIX / VIR" seed={9902} rows={8} />
        </div>
      </div>
    </div>
  );
}
