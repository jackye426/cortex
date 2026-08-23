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

const bunBin = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".bun/bin",
);
const brainRepo =
  fileEnv.CORTEX_GBRAIN_DIR ||
  path.join(root, "..", "brain");

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
        // Session ingest is GBrain dir (writers). HTTP ingest is leftover-only.
        CORTEX_GBRAIN_DIR: fileEnv.CORTEX_GBRAIN_DIR || "",
        CORTEX_COLLECTOR_INTERVAL_MS:
          fileEnv.CORTEX_COLLECTOR_INTERVAL_MS || "300000",
        CORTEX_SYNC_GMAIL: fileEnv.CORTEX_SYNC_GMAIL || "1",
        CORTEX_SYNC_CALENDAR: fileEnv.CORTEX_SYNC_CALENDAR || "1",
        CORTEX_SYNC_DRIVE: fileEnv.CORTEX_SYNC_DRIVE || "1",
      },
    },
    {
      // GBrain indexes commits, not the working tree, and no gbrain command
      // stages the collector's output — so this is the one step autopilot
      // cannot do for us. Sync/embed deliberately live in gbrain-autopilot;
      // running them here too just contends for the same locks.
      name: "gbrain-commit",
      script: path.join(root, "scripts/gbrain-commit.mjs"),
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      env: {
        ...fileEnv,
        PATH: `${bunBin};${process.env.PATH || ""}`,
      },
    },
    {
      // Owns every phase downstream of the commit: lint, backlinks, sync,
      // extract, synthesize, patterns, embed, orphans. Replaces the manual
      // `gbrain dream` run. `gbrain autopilot --install` only targets
      // launchd/systemd/cron, so on Windows pm2 is the supervisor.
      name: "gbrain-autopilot",
      script: path.join(bunBin, "gbrain.exe"),
      interpreter: "none",
      args: ["autopilot", "--repo", brainRepo, "--interval", "300"],
      cwd: brainRepo,
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      // The daemon self-limits crash restarts; back off so a Supabase outage
      // cannot thrash the queue.
      restart_delay: 10_000,
      env: {
        ...fileEnv,
        PATH: `${bunBin};${process.env.PATH || ""}`,
      },
    },
    // Compilers (coding-ops / weekly-mirror / llm-ops) remain manual:
    //   node apps/mcp-server coding-ops | weekly-mirror | llm-ops
    // Default agent MCP is `gbrain serve`, not cortex-mcp.
  ],
};
