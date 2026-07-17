# Cortex remote MCP

Remote **streamable HTTP** MCP for OpenAI (primary), Claude Code, Codex, and ChatGPT. Cursor is optional and not required for day-to-day Mirror use.

**Production (Railway-primary):**  
- **Mirror (default agents):** `https://cortexmcp-server-production-1c59.up.railway.app/mcp`  
- **Ops (maintenance):** `https://cortexmcp-server-production-1c59.up.railway.app/mcp/ops`  

Collectors stay on Windows; MCP + ingest API deploy on Railway. See [deploy.md](deploy.md) / [ops-windows.md](ops-windows.md). Privilege model: [mirror-privilege-plan.md](mirror-privilege-plan.md).

## OpenAI local app (recommended)

Local Agents SDK client that talks to Mirror MCP (your process holds the bearer token; OpenAI never needs Ops):

```powershell
# Terminal A — local MCP (or skip and point at Railway)
pnpm --filter @cortex/mcp-server dev

# Terminal B — list tools / ask
pnpm --filter @cortex/openai-mirror tools
pnpm --filter @cortex/openai-mirror start -- "what was I working on this week?"
```

Env (repo `.env`):

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | OpenAI key for the Agents SDK / Responses API |
| `CORTEX_MCP_TOKEN` | Bearer for Mirror `/mcp` |
| `CORTEX_MIRROR_MCP_URL` | Default `http://localhost:8790/mcp`; set Railway URL for remote |
| `CORTEX_MCP_MODE` | `local` (default) or `hosted` (OpenAI calls public Mirror URL) |

`hosted` mode uses OpenAI **hosted MCP tools** (`authorization` = Mirror bearer). The Mirror URL must be publicly reachable (Railway), not localhost.

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

### Mirror (`/mcp`) — everyday agent

| Tool | Purpose |
|------|---------|
| `cortex_help` | Retrieval playbook (call first) |
| `search_memory` | Hybrid distillate search (`operational` / `reflective` / `both`) |
| `ask_mirror` | Citation-required synthesis (ephemeral; distillates only) |
| `list_recent_work` | Recent work from distillates (no raw session bodies) |
| `get_calendar_range` | Sanitised schedule (summary/start/end/attendee_count) |
| `request_evidence_capability` | Mint short-lived sensitive capability |
| `retrieve_supporting_evidence` | Policy-gated raw excerpts (needs capability when sensitive) |
| `list_entities` / `upsert_entity` / `link_entity` / `get_entity_links` / `seed_entities` | Project/topic graph |
| `capture_decision` / `list_decisions` | Decision/outcome capture |
| `priority_vs_actual` / `refresh_self_model` / `allocator_context` | Twin D2/D4/D5 helpers |
| `get_portrait` / `list_portrait_versions` / `refresh_portrait` | Versioned portraits (`reflective_sensitive`) |

### Ops (`/mcp/ops`) — maintenance only

| Tool | Purpose |
|------|---------|
| `search_records` | Keyword search over raw payloads |
| `get_session` | Full session + messages |
| `get_email_thread` / `get_file_summary` | Raw thread / Drive summary |
| `issue_restricted_capability` | Restricted broker grants |
| Plus Mirror tools and raw list helpers (ebook/spotify/youtube/…) | |

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

Replace `YOUR_TOKEN` with the same value as `CORTEX_MCP_TOKEN` (or `CORTEX_INGEST_TOKEN`). For production, use the Railway HTTPS MCP URL. Prefer the OpenAI local app above for Mirror work.

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
