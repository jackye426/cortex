/** Client for viz API — same-origin /api/viz on Railway; fixtures offline. */
import type {
  VizDensity,
  VizLedger,
  VizLedgerChannel,
  VizVerdictRequest,
  VizVerdictResponse,
  VizView,
} from "@cortex/viz-contracts";
import { fixtureDensity, fixtureLedger } from "./fixtures";

function useFixtures(): boolean {
  if (import.meta.env.VITE_VIZ_FIXTURES === "1") return true;
  if (import.meta.env.VITE_VIZ_API_URL) return false;
  if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return false;
  }
  return import.meta.env.DEV && !import.meta.env.VITE_VIZ_API_URL;
}

function apiPrefix(): string {
  const remote = (import.meta.env.VITE_VIZ_API_URL as string | undefined)?.replace(/\/$/, "");
  if (remote) return remote;
  return "";
}

function bearer(): string {
  return (import.meta.env.VITE_VIZ_BEARER as string | undefined)?.trim() ?? "";
}

async function vizFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const base = apiPrefix();
  const url = base
    ? `${base}${path}`
    : `/api/viz${path.replace(/^\/v1\/viz/, "")}`;
  const token = bearer();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function markDegraded(d: VizDensity, reason: string): VizDensity {
  return {
    ...d,
    meta: {
      ...d.meta,
      shellDriven: true,
      source: "degraded",
      degraded: true,
      error: reason,
    },
  };
}

function markFixture(d: VizDensity): VizDensity {
  return {
    ...d,
    meta: {
      ...d.meta,
      shellDriven: true,
      source: "fixture",
    },
  };
}

export type DensityLoadResult = {
  data: VizDensity;
  /** True when live fetch failed and fixtures were used as last resort. */
  degraded: boolean;
};

export async function loadDensity(view: VizView): Promise<DensityLoadResult> {
  if (useFixtures()) {
    return { data: markFixture(fixtureDensity(view)), degraded: false };
  }
  try {
    const data = await vizFetch<VizDensity>(`/v1/viz/density?view=${view}`);
    if (
      data &&
      (data.annotations?.length ||
        data.meters?.length ||
        data.channelBars?.length ||
        data.streamRows?.length ||
        data.points?.length ||
        data.meta)
    ) {
      return {
        data: {
          ...data,
          meta: {
            ...data.meta,
            shellDriven: true,
            source: data.meta?.source ?? "live",
          },
        },
        degraded: Boolean(data.meta?.degraded),
      };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "fetch_failed";
    return { data: markDegraded(fixtureDensity(view), reason), degraded: true };
  }
  return {
    data: markDegraded(fixtureDensity(view), "empty_response"),
    degraded: true,
  };
}

export async function loadLedger(channel: VizLedgerChannel): Promise<{
  data: VizLedger;
  degraded: boolean;
}> {
  if (useFixtures()) {
    return { data: fixtureLedger(channel), degraded: false };
  }
  try {
    const data = await vizFetch<VizLedger>(`/v1/viz/ledger?channel=${channel}`);
    if (data?.rows) return { data, degraded: false };
  } catch {
    /* fall through */
  }
  return { data: fixtureLedger(channel), degraded: true };
}

export async function postVerdict(
  body: VizVerdictRequest,
): Promise<VizVerdictResponse> {
  if (useFixtures()) {
    return { ok: true, insightId: body.insightId, verdict: body.verdict };
  }
  const data = await vizFetch<VizVerdictResponse>("/v1/viz/verdict", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!data) {
    return {
      ok: false,
      insightId: body.insightId,
      verdict: body.verdict,
      error: "request_failed",
    };
  }
  return data;
}
