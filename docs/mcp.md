# Cortex remote MCP

Remote **streamable HTTP** MCP so Cursor, Claude Code, Codex, and ChatGPT can query your vault with bearer auth.

**Production (Railway-primary):**  
- **Mirror (default agents):** `https://cortexmcp-server-production-1c59.up.railway.app/mcp`  
- **Ops (maintenance):** `https://cortexmcp-server-production-1c59.up.railway.app/mcp/ops`  

Collectors stay on Windows; MCP + ingest API deploy on Railway. See [deploy.md](deploy.md) / [ops-windows.md](ops-windows.md). Privilege model: [mirror-privilege-plan.md](mirror-privilege-plan.md).

## Run locally

```powershell
# From repo root — token required (MCP or ingest)
# .env: CORTEX_MCP_TOKEN=local-dev-token   # or reuse CORTEX_INGEST_TOKEN
# .env: CORTEX_OPS_MCP_TOKEN=local-ops-token  # optional; falls back to MCP token

pnpm install
pnpm --filter @cortex/mcp-server dev
```

Defaults:

| Item | Value |
|------|--------|
| Mirror URL | `http://localhost:8790/mcp` |
| Ops URL | `http://localhost:8790/mcp/ops` |
| Health | `http://localhost:8790/health` |
| Port | `MCP_PORT` or `PORT` (default **8790**) |
| Mirror auth | `Authorization: Bearer <CORTEX_MCP_TOKEN \|\| CORTEX_INGEST_TOKEN>` |
| Ops auth | `Authorization: Bearer <CORTEX_OPS_MCP_TOKEN \|\| CORTEX_MCP_TOKEN>` |
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

## Retrieval playbook (Mirror)

Call `cortex_help` from the Mirror endpoint, or follow:

1. **What am I building?** → `list_recent_work`, then `search_memory` (`mode=operational`). Session **message bodies** are broker-only.
2. **Schedule structure** → `get_calendar_range` (sanitised: summary/start/end/attendee_count). Descriptions/attachments → evidence broker.
3. **Semantic / insight** → `search_memory` (`operational|reflective|both`).
4. **Cited synthesis** → `ask_mirror` (ephemeral; distillates only — no silent raw expansion).
5. **Raw excerpts** → `request_evidence_capability` (sensitive) then `retrieve_supporting_evidence`. Policy decides; restricted needs Ops `issue_restricted_capability`.
6. **Ops vault tools** (`search_records`, `get_session`, `get_email_thread`, …) live only on `/mcp/ops`.

## Tools

| Tool | Purpose |
|------|---------|
| `cortex_help` | Retrieval playbook |
| `search_records` | Keyword search over payload + distillates; filters `recordTypes` / `sources` / `excludeTypes` / `since` / `until` |
| `search_memory` | Hybrid distillate + record memory search with operational/reflective lenses |
| `ask_mirror` | Citation-required Analyst synthesis (ephemeral) |
| `get_session` | Session + messages + tool summaries + distillate |
| `list_recent_work` | Work-biased recent sessions/records (`kinds`, `horizonDays`, `workMode`) |
| `get_email_thread` | Gmail thread by `threadId` |
| `get_calendar_range` | Calendar events in an ISO range (**the** schedule tool) |
| `get_file_summary` | Drive/file summary by id |
| `list_entities` / `upsert_entity` / `link_entity` / `get_entity_links` / `seed_entities` | Project/topic graph (twin D1) |
| `capture_decision` / `list_decisions` | Decision/outcome capture + list (D3) |
| `priority_vs_actual` | Week effort attribution distillate (D2) |
| `refresh_self_model` | Theory-of-self distillate (D4) |
| `get_portrait` / `list_portrait_versions` / `refresh_portrait` | Versioned portrait snapshots |
| `allocator_context` | 3h/3w/3y prompt seed over D1–D4 (D5) |

Fixture mode includes sample sessions (with embeddings), a decision distillate, a Gmail thread (`thread-alpha`), a calendar event, and a Drive file so tools work without a linked Supabase project.

## Distillate worker + RAG

LLM session distillates when `OPENAI_API_KEY` is set (optional `OPENAI_BASE_URL`, `CORTEX_DISTILLATE_MODEL`). Falls back to heuristic stub otherwise. Embeddings on write use `CORTEX_EMBEDDING_MODEL` (default `text-embedding-3-small`) into `distillates.embedding` — **not** full raw records.

**Embed backfill** (no re-LLM): for distillates written before embeddings were enabled, or after model changes:

```powershell
pnpm embed-backfill -- --dry-run --limit=50
pnpm embed-backfill -- --limit=50
pnpm embed-backfill -- --force --limit=10
```

**OpenRouter pinning:** when `OPENAI_BASE_URL` is OpenRouter, distillate chat defaults to `provider.only: ["Morph"]`, `zdr: true`, and `data_collection: "deny"` (override with `CORTEX_LLM_*`). Embeddings are not Morph-pinned.

**Where to put secrets:** repo `.env` for local `pnpm distillate` / collector. The **Railway MCP service** also needs `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and model ids — local `.env` is not deployed.

```powershell
pnpm --filter @cortex/mcp-server distillate -- --dry-run --limit=5
pnpm --filter @cortex/mcp-server distillate -- --limit=10
pnpm --filter @cortex/mcp-server distillate -- --project-brief --dry-run
pnpm --filter @cortex/mcp-server distillate -- --seed-entities --dry-run
pnpm --filter @cortex/mcp-server distillate -- --priority-vs-actual --dry-run
pnpm --filter @cortex/mcp-server distillate -- --self-model --dry-run
```

Or HTTP (same bearer):

```powershell
curl -Method POST http://localhost:8790/v1/distillate `
  -Headers @{ Authorization = "Bearer local-dev-token"; "Content-Type" = "application/json" } `
  -Body '{"limit":5,"dryRun":true}'

curl -Method POST http://localhost:8790/v1/project-brief `
  -Headers @{ Authorization = "Bearer local-dev-token"; "Content-Type" = "application/json" } `
  -Body '{"limitSessions":20,"dryRun":true}'

curl -Method POST http://localhost:8790/v1/embed-backfill `
  -Headers @{ Authorization = "Bearer local-dev-token"; "Content-Type" = "application/json" } `
  -Body '{"limit":50,"dryRun":true}'
```

Migration: `supabase/migrations/20260712200000_distillate_embeddings_search.sql` (`vector` extension + search RPCs). Apply with `npx supabase db push` when the project is linked. `search_memory` passes a query embedding into `cortex_search_memory` when `OPENAI_API_KEY` is set.

Twin extension points: [twin.md](twin.md).

---

## Client configuration

Replace `YOUR_TOKEN` with the same value as `CORTEX_MCP_TOKEN` (or `CORTEX_INGEST_TOKEN`). For production, use the Railway HTTPS MCP URL.

### Cursor

Project `.cursor/mcp.json` (gitignored; copy from `.cursor/mcp.json.example`):

```json
{
  "mcpServers": {
    "cortex": {
      "url": "https://cortexmcp-server-production-1c59.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_CORTEX_MCP_TOKEN"
      }
    }
  }
}
```

Reload MCP in Cursor after editing. Local `http://localhost:8790/mcp` remains valid for offline/dev.

### Claude Code

User or project MCP config (e.g. `~/.claude.json` / project `.mcp.json`):

```json
{
  "mcpServers": {
    "cortex": {
      "type": "http",
      "url": "https://cortexmcp-server-production-1c59.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_CORTEX_MCP_TOKEN"
      }
    }
  }
}
```

### Codex

```toml
[mcp_servers.cortex]
url = "https://cortexmcp-server-production-1c59.up.railway.app/mcp"
http_headers = { Authorization = "Bearer YOUR_CORTEX_MCP_TOKEN" }
```

### ChatGPT (Custom GPT / Actions / connectors)

1. Point at `https://cortexmcp-server-production-1c59.up.railway.app/mcp`.
2. Add header `Authorization: Bearer YOUR_CORTEX_MCP_TOKEN`.
3. Prefer streamable HTTP; if the product still expects SSE-only legacy MCP, put a compatible gateway in front.

Never paste production tokens into shared GPT configs you publish.

---

## Security notes

- Bearer tokens only over HTTPS in production.
- Do not commit `.env` or client configs that embed real tokens.
- Fixture mode is for local tool wiring; link EU Supabase before relying on real vault data (`docs/supabase.md`).
