#!/usr/bin/env node
/**
 * Loop session distillate backfill against a running Cortex MCP.
 *
 *   CORTEX_MCP_TOKEN=... CORTEX_MCP_URL=https://... \
 *     node scripts/backfill-session-distillates.mjs
 *
 * Keeps posting /v1/distillate with small batches (Railway ~5m timeout).
 */
const url = (
  process.env.CORTEX_MCP_URL?.trim() ||
  "https://cortexmcp-server-production-1c59.up.railway.app"
).replace(/\/$/, "");
const token =
  process.env.CORTEX_MCP_TOKEN?.trim() ||
  process.env.CORTEX_INGEST_TOKEN?.trim();
if (!token) {
  console.error("CORTEX_MCP_TOKEN required");
  process.exit(1);
}

const limit = Number(process.env.CORTEX_DISTILL_BATCH || 10);
const maxRounds = Number(process.env.CORTEX_DISTILL_ROUNDS || 120);
const timeoutMs = Number(process.env.CORTEX_DISTILL_TIMEOUT_MS || 280_000);

let totalWritten = 0;
let totalProcessed = 0;

for (let round = 1; round <= maxRounds; round++) {
  const started = Date.now();
  process.stderr.write(`round ${round}/${maxRounds} limit=${limit}… `);
  let res;
  try {
    res = await fetch(`${url}/v1/distillate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit, dryRun: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    console.error(`error ${err instanceof Error ? err.message : err}`);
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`non-json ${res.status} ${text.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }
  if (!res.ok || body.ok === false) {
    console.error(`http ${res.status}`, body.error || text.slice(0, 200));
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }
  const written = Number(body.written ?? 0);
  const processed = Number(body.processed ?? 0);
  totalWritten += written;
  totalProcessed += processed;
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `processed=${processed} written=${written} totalWritten=${totalWritten} (${sec}s)`,
  );
  if (processed === 0 || written === 0) {
    console.log("no more undigested sessions");
    break;
  }
  await new Promise((r) => setTimeout(r, 1500));
}

console.log(
  JSON.stringify({ ok: true, totalProcessed, totalWritten }, null, 2),
);
