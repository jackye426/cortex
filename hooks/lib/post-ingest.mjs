/**
 * Shared best-effort ingest POST with light retry for Cortex hooks.
 * Dependency-free (hooks must not require workspace packages).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load repo-root .env into process.env if keys are unset. */
export function loadHookEnv() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(__dirname, "../../.env"),
    resolve(__dirname, "../../../.env"),
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST RawEnvelope to /v1/ingest with exponential backoff on 429/5xx/network.
 * Always resolves; never throws (hooks must exit 0).
 */
export async function postIngest(envelope, options = {}) {
  loadHookEnv();
  const base = (
    options.url ??
    process.env.CORTEX_INGEST_URL ??
    "http://localhost:8787"
  ).replace(/\/$/, "");
  const token = options.token ?? process.env.CORTEX_INGEST_TOKEN ?? "";
  const maxAttempts = options.maxAttempts ?? 4;

  if (!token) {
    console.error("[cortex-hook] CORTEX_INGEST_TOKEN is not set; skipping");
    return { ok: false, status: 0, error: "missing token" };
  }

  let last = { ok: false, status: 0, error: "no attempt" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${base}/v1/ingest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(envelope),
      });
      if (res.ok) {
        return { ok: true, status: res.status };
      }
      const text = await res.text();
      last = {
        ok: false,
        status: res.status,
        error: text.slice(0, 200),
      };
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        console.error(
          `[cortex-hook] ingest failed ${res.status}: ${last.error}`,
        );
        return last;
      }
    } catch (err) {
      last = {
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      if (attempt === maxAttempts) {
        console.error("[cortex-hook] ingest error", last.error);
        return last;
      }
    }
    const delay = Math.min(8_000, 400 * 2 ** (attempt - 1));
    await sleep(delay);
  }
  return last;
}
