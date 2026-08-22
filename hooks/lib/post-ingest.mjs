/**
 * Shared best-effort hook sink. Default: write a GBrain L1 delta page.
 * Legacy Cortex POST /v1/ingest is behind the dead flag CORTEX_HOOK_INGEST=1.
 * Always resolves; never throws (hooks must exit 0).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { redactText, redactValue } from "./redact.mjs";

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

function truthy(v) {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

export function writeGbrainDelta(envelope) {
  const brainDir = process.env.CORTEX_GBRAIN_DIR?.trim();
  if (!brainDir) {
    console.error(
      "[cortex-hook] set CORTEX_GBRAIN_DIR to write L1 pages (or CORTEX_HOOK_INGEST=1 for legacy POST)",
    );
    return { ok: false, status: 0, error: "missing CORTEX_GBRAIN_DIR" };
  }
  const harness = envelope?.source ?? "unknown";
  const id = String(envelope?.sourceRecordId ?? "hook").replace(
    /[<>:"|?*\\]/g,
    "_",
  );
  const rel = join("hooks", harness, `hook-${id}.md`);
  const abs = join(brainDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const redacted = redactValue(envelope ?? {});
  const body = JSON.stringify(redacted.value?.body ?? {}, null, 2).slice(
    0,
    80_000,
  );
  const md = redactText(
    [
      "---",
      "cortex_schema: session-hook-delta-v1",
      `harness: ${harness}`,
      `source_session_id: ${JSON.stringify(id)}`,
      "---",
      "",
      "## Turns",
      "",
      "_Hook delta — collector backfill writes the full session-v1 page._",
      "",
      "## Tools",
      "",
      "```text",
      body,
      "```",
      "",
    ].join("\n"),
  ).text;
  writeFileSync(abs, md, "utf8");
  console.info(
    `[cortex-hook] wrote ${rel} redactionHits=${redacted.hitCount}`,
  );
  return {
    ok: true,
    status: 0,
    path: rel,
    redactionHits: redacted.hitCount,
  };
}

/**
 * Default: write a GBrain page. Legacy ingest only when CORTEX_HOOK_INGEST=1.
 */
export async function postIngest(envelope, options = {}) {
  loadHookEnv();

  if (!truthy(process.env.CORTEX_HOOK_INGEST) && !options.forceIngest) {
    return writeGbrainDelta(envelope);
  }

  const base = (
    options.url ??
    process.env.CORTEX_INGEST_URL ??
    "http://localhost:8787"
  ).replace(/\/$/, "");
  const token = options.token ?? process.env.CORTEX_INGEST_TOKEN ?? "";
  const maxAttempts = options.maxAttempts ?? 4;

  if (!token) {
    console.error("[cortex-hook] CORTEX_INGEST_TOKEN is not set; skipping legacy ingest");
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
