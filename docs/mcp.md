# Cortex remote MCP

Phase 6 exposes a **streamable HTTP** MCP endpoint so Cursor, Claude Code, Codex, and ChatGPT can query your vault with bearer auth.

## Run locally

```powershell
# From repo root — token required (MCP or ingest)
# .env: CORTEX_MCP_TOKEN=local-dev-token   # or reuse CORTEX_INGEST_TOKEN

pnpm install
pnpm --filter @cortex/mcp-server dev
```

Defaults:

| Item | Value |
|------|--------|
| URL | `http://localhost:8790/mcp` |
| Health | `http://localhost:8790/health` |
| Port | `MCP_PORT` or `PORT` (default **8790**) |
| Auth | `Authorization: Bearer <CORTEX_MCP_TOKEN \|\| CORTEX_INGEST_TOKEN>` |
| Store | Supabase when `SUPABASE_URL` + key set; else **fixture** mode |

Smoke (tools/list):

```powershell
curl -Method POST http://localhost:8790/mcp `
  -Headers @{
    Authorization = "Bearer local-dev-token"
    "Content-Type" = "application/json"
    Accept = "application/json, text/event-stream"
  } `
  -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tools

| Tool | Purpose |
|------|---------|
| `search_records` | Keyword search over canonical records |
| `get_session` | Session + messages + tool summaries + distillate |
| `list_recent_work` | Recent sessions/records across sources |
| `get_email_thread` | Gmail thread by `threadId` |
| `get_calendar_range` | Calendar events in an ISO range |
| `get_file_summary` | Drive/file summary by id |

Fixture mode includes sample sessions, a Gmail thread (`thread-alpha`), a calendar event, and a Drive file so tools work without a linked Supabase project.

## Distillate worker stub

Summarizes session envelopes into `distillates`-shaped rows (heuristic stub — no LLM yet).

```powershell
pnpm --filter @cortex/mcp-server distillate -- --dry-run --limit=5
pnpm --filter @cortex/mcp-server distillate -- --limit=10
```

Or HTTP (same bearer):

```powershell
curl -Method POST http://localhost:8790/v1/distillate `
  -Headers @{ Authorization = "Bearer local-dev-token"; "Content-Type" = "application/json" } `
  -Body '{"limit":5,"dryRun":true}'
```

Writes upsert into `public.distillates` when Supabase is configured; fixture mode keeps rows in memory.

---

## Client configuration

Replace `YOUR_TOKEN` with the same value as `CORTEX_MCP_TOKEN` (or `CORTEX_INGEST_TOKEN`). For production, use your HTTPS MCP URL (e.g. Railway/Vercel) instead of localhost.

### Cursor

Cursor Settings → MCP → Add server, or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "url": "http://localhost:8790/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

Some Cursor builds use `mcp.servers` in `settings.json` with the same `url` + `headers` shape.

### Claude Code

User or project MCP config (e.g. `~/.claude.json` / project `.mcp.json`):

```json
{
  "mcpServers": {
    "cortex": {
      "type": "http",
      "url": "http://localhost:8790/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

If your Claude Code build only supports stdio, put a thin proxy in front or wait for remote HTTP MCP support; Cortex ships HTTP-native.

### Codex

Codex MCP (config.toml / app settings — names vary by build):

```toml
[mcp_servers.cortex]
url = "http://localhost:8790/mcp"
http_headers = { Authorization = "Bearer YOUR_TOKEN" }
```

Or JSON-style:

```json
{
  "mcpServers": {
    "cortex": {
      "url": "http://localhost:8790/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

### ChatGPT (Custom GPT / Actions / connectors)

1. Deploy Cortex MCP behind **HTTPS** (localhost is not reachable from OpenAI).
2. In ChatGPT connector / custom action settings, point at `https://your-host/mcp`.
3. Add header `Authorization: Bearer YOUR_TOKEN`.
4. Prefer streamable HTTP; if the product still expects SSE-only legacy MCP, put a compatible gateway in front (Phase 7 hardening may document deploy options).

Never paste production tokens into shared GPT configs you publish.

---

## Security notes

- Bearer tokens only over HTTPS in production.
- Do not commit `.env` or client configs that embed real tokens.
- Fixture mode is for local tool wiring; link EU Supabase before relying on real vault data (`docs/supabase.md`).
