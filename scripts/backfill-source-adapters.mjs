#!/usr/bin/env node
/**
 * Run source adapters with elevated limits against Cortex MCP.
 *
 *   CORTEX_MCP_TOKEN=... node scripts/backfill-source-adapters.mjs
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

const adapters = (
  process.env.CORTEX_ADAPTERS ||
  "email-thread,github-outcome,calendar-event,drive-file,browser-interest,spotify-interest,youtube-interest"
).split(",").map((s) => s.trim()).filter(Boolean);

const limit = Number(process.env.CORTEX_ADAPTER_LIMIT || 80);
const rounds = Number(process.env.CORTEX_ADAPTER_ROUNDS || 8);
const timeoutMs = Number(process.env.CORTEX_DISTILL_TIMEOUT_MS || 280_000);

for (const adapter of adapters) {
  for (let round = 1; round <= rounds; round++) {
    process.stderr.write(`${adapter} round ${round}/${rounds}… `);
    let res;
    try {
      res = await fetch(`${url}/v1/source-adapter`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ adapter, limit, dryRun: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      console.error(`error ${err instanceof Error ? err.message : err}`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`http ${res.status}`, body.error || body);
      if (String(body.error || "").includes("Unknown adapter")) break;
      continue;
    }
    console.log(
      `scanned=${body.scanned ?? 0} written=${body.written ?? 0} skipped=${body.skipped ?? 0} sensitive=${body.skippedSensitive ?? 0}`,
    );
    if ((body.written ?? 0) === 0) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
}
console.log("adapters done");
