/**
 * PM2 ecosystem for Windows-native Cortex collector only.
 * Prefer root ecosystem.config.cjs (API + MCP + collector).
 *
 * Usage: pnpm --filter @cortex/collector build && pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "cortex-collector",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        CORTEX_INGEST_URL: "http://localhost:8787",
        CORTEX_COLLECTOR_INTERVAL_MS: "300000",
        CORTEX_SYNC_GMAIL: "1",
        CORTEX_SYNC_CALENDAR: "1",
        CORTEX_SYNC_DRIVE: "1",
      },
    },
  ],
};
