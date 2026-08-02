import { useEffect, useState } from "react";
import type { VizDensity, VizView } from "@cortex/viz-contracts";
import { loadDensity } from "@/lib/viz-api";
import { fixtureDensity } from "@/lib/fixtures";

export function useDensity(view: VizView): VizDensity {
  const [data, setData] = useState<VizDensity>(() => fixtureDensity(view));
  useEffect(() => {
    let cancelled = false;
    void loadDensity(view).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [view]);
  return data;
}
