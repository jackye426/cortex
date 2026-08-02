/**
 * Production server for @cortex/data-verse on Railway.
 * Serves the Vite build and proxies /api/viz/* → MCP with server-side bearer.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(__dirname, "dist");
const PORT = Number(process.env.PORT ?? 5180);
const MCP =
  (process.env.VIZ_API_URL ?? process.env.CORTEX_MCP_URL ?? "")
    .replace(/\/$/, "")
    .replace(/\/mcp$/, "") ||
  "https://cortexmcp-server-production-1c59.up.railway.app";
const TOKEN =
  process.env.CORTEX_MCP_TOKEN?.trim() ||
  process.env.VIZ_BEARER?.trim() ||
  "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

async function proxyViz(req, res, pathWithQuery) {
  if (!TOKEN) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "CORTEX_MCP_TOKEN not configured" }));
    return;
  }
  const upstream = `${MCP}${pathWithQuery}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
  let body;
  if (req.method === "POST" || req.method === "PUT") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }
  try {
    const out = await fetch(upstream, {
      method: req.method,
      headers,
      body,
    });
    const buf = Buffer.from(await out.arrayBuffer());
    res.writeHead(out.status, {
      "content-type": out.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    });
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "upstream_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0] || "/");
  if (rel === "/") rel = "/index.html";
  const filePath = normalize(join(DIST, rel));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  let target = filePath;
  if (!existsSync(target) || statSync(target).isDirectory()) {
    // SPA fallback
    target = join(DIST, "index.html");
  }
  if (!existsSync(target)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const ext = extname(target);
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control":
      ext === ".html" ? "no-cache" : "public, max-age=86400, immutable",
  });
  res.end(readFileSync(target));
}

const server = createServer(async (req, res) => {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  if (url.pathname.startsWith("/api/viz/")) {
    const upstreamPath = url.pathname.replace(/^\/api\/viz/, "/v1/viz") + url.search;
    await proxyViz(req, res, upstreamPath);
    return;
  }
  serveStatic(req, res, url.pathname + url.search);
});

server.listen(PORT, () => {
  console.info(
    `[data-verse] http://localhost:${PORT} → MCP ${MCP} token=${TOKEN ? "set" : "MISSING"}`,
  );
});
