/**
 * Shared ingest client for collector backfill + hooks.
 * Applies client-side redaction before POST; API redacts again.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawEnvelope } from "@cortex/core";
import { redactValue } from "@cortex/redaction";
import {
  isRetryableIngestResult,
  withBackoff,
  type BackoffOptions,
} from "./retry.js";

export interface IngestConfig {
  url: string;
  token: string;
  /** Optional backoff overrides for failed POSTs. */
  backoff?: BackoffOptions;
}

export interface IngestResult {
  ok: boolean;
  status: number;
  key?: string;
  contentHash?: string;
  redactionHits?: number;
  recordType?: string;
  error?: string;
}

/** Load KEY=VALUE from nearest `.env` without overriding existing env. */
export function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(here, "../../../.env"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\n/)) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function getIngestConfig(): IngestConfig {
  const url = (process.env.CORTEX_INGEST_URL ?? "http://localhost:8787").replace(
    /\/$/,
    "",
  );
  const token = process.env.CORTEX_INGEST_TOKEN ?? "";
  return { url, token };
}

async function postEnvelopeOnce(
  envelope: RawEnvelope,
  config: IngestConfig,
): Promise<IngestResult> {
  if (!config.token) {
    return {
      ok: false,
      status: 0,
      error: "CORTEX_INGEST_TOKEN is not set",
    };
  }

  const { value: redactedBody, hits } = redactValue(envelope.body);
  const payload = { ...envelope, body: redactedBody };

  let res: Response;
  try {
    res = await fetch(`${config.url}/v1/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: typeof obj.error === "string" ? obj.error : `HTTP ${res.status}`,
    };
  }

  const record =
    obj.record && typeof obj.record === "object"
      ? (obj.record as Record<string, unknown>)
      : undefined;

  return {
    ok: true,
    status: res.status,
    key: typeof obj.key === "string" ? obj.key : undefined,
    contentHash: typeof obj.contentHash === "string" ? obj.contentHash : undefined,
    redactionHits:
      typeof obj.redactionHits === "number"
        ? obj.redactionHits
        : Array.isArray(obj.redactionHits)
          ? obj.redactionHits.length
          : hits.length,
    recordType: typeof record?.recordType === "string" ? record.recordType : undefined,
  };
}

/**
 * POST envelope with exponential backoff on transient failures (429 / 5xx / network).
 */
export async function postEnvelope(
  envelope: RawEnvelope,
  config: IngestConfig,
): Promise<IngestResult> {
  return withBackoff(
    () => postEnvelopeOnce(envelope, config),
    (r) => r.ok,
    {
      maxAttempts: 5,
      initialDelayMs: 500,
      maxDelayMs: 30_000,
      factor: 2,
      shouldRetry: (err) => {
        if (err && typeof err === "object" && "ok" in err) {
          return isRetryableIngestResult(err as IngestResult);
        }
        return true;
      },
      onRetry: ({ attempt, delayMs, error }) => {
        const status =
          error && typeof error === "object" && "status" in error
            ? Number((error as { status: unknown }).status)
            : undefined;
        const msg =
          error && typeof error === "object" && "error" in error
            ? String((error as { error?: unknown }).error ?? "")
            : String(error);
        console.warn(
          `[ingest] retry attempt=${attempt} delayMs=${delayMs} status=${status ?? "?"} ${msg}`,
        );
      },
      ...config.backoff,
    },
  );
}
