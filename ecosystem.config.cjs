/**
 * Root PM2 ecosystem — Cortex API + MCP + collector on Windows.
 *
 * Prerequisites:
 *   pnpm build
 *   Ensure repo-root .env has CORTEX_INGEST_TOKEN, SUPABASE_*, etc.
 *
 * Usage (from repo root):
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup   # follow printed instructions for Windows logon start
 *
 * See docs/ops-windows.md
 */
const path = require("node:path");

const root = __dirname;
const envFile = path.join(root, ".env");

function loadEnvFile(filePath) {
  const out = {};
  try {
    const fs = require("node:fs");
    if (!fs.existsSync(filePath)) return out;
    for (const raw of fs.readFileSync(filePath, "utf8").split(/\n/)) {
      const line = raw.replace(/\r$/, "").trim();
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
      out[key] = value;
    }
  } catch {
    /* ignore */
  }
  return out;
}

const fileEnv = loadEnvFile(envFile);

module.exports = {
  apps: [
    {
      name: "cortex-api",
      script: "dist/index.js",
      cwd: path.join(root, "apps/api"),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        PORT: fileEnv.PORT || "8787",
      },
    },
    {
      name: "cortex-mcp",
      script: "dist/index.js",
      cwd: path.join(root, "apps/mcp-server"),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        // Prefer MCP_PORT; never inherit API PORT=8787 from root .env
        MCP_PORT: fileEnv.MCP_PORT || "8790",
        PORT: fileEnv.MCP_PORT || "8790",
      },
    },
    {
      name: "cortex-collector",
      script: "dist/index.js",
      cwd: path.join(root, "apps/collector"),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        CORTEX_INGEST_URL:
          fileEnv.CORTEX_INGEST_URL || "http://localhost:8787",
        CORTEX_COLLECTOR_INTERVAL_MS:
          fileEnv.CORTEX_COLLECTOR_INTERVAL_MS || "300000",
        CORTEX_SYNC_GMAIL: fileEnv.CORTEX_SYNC_GMAIL || "1",
        CORTEX_SYNC_CALENDAR: fileEnv.CORTEX_SYNC_CALENDAR || "1",
        CORTEX_SYNC_DRIVE: fileEnv.CORTEX_SYNC_DRIVE || "1",
      },
    },
  ],
};
