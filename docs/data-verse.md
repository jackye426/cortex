# Data-verse visualization

Ikeda-style computational frontend for Cortex. Source of truth: [`apps/data-verse`](../apps/data-verse).

## Live personal dashboard (Railway — preferred)

**URL:** https://cortexdata-verse-production.up.railway.app

Railway service `@cortex/data-verse` serves the Vite build via `server.mjs`, which proxies **`/api/viz/*`** to the MCP viz API. Your bearer token stays on the server (`CORTEX_MCP_TOKEN` on the data-verse service), not in the browser.

| Railway variable | Purpose |
|------------------|---------|
| `CORTEX_MCP_TOKEN` | Same bearer as `@cortex/mcp-server` |
| `VIZ_API_URL` | Optional; defaults to MCP origin |
| `RAILWAY_DOCKERFILE_PATH` | `apps/data-verse/Dockerfile` |

Build/deploy: push to `jackye426/cortex` `main`; Railway builds from the Dockerfile at repo root context.

## Optional / legacy (Lovable)

[jackye426/data-verse-render](https://github.com/jackye426/data-verse-render) → https://data-verse-render.lovable.app

Uses TanStack server functions + Lovable secrets. Prefer Railway unless you want Lovable's editor sync.

## Indexes

| Id | Route | Job | Data family |
|----|-------|-----|-------------|
| 00 | `/` | Index hub | — |
| 01 | `/scan` | Intrapersonal volume (self-model facets, interests, diffs) | `VizDensity` view=`scan` |
| 02 | `/particles` | Attention geometry (embedding projection + priority/cycle orbits) | `VizDensity` view=`particle` |
| 03 | `/insights` | Cross-source filaments | `VizDensity` view=`cross` |
| 04 | `/streams` | Throughput wall (chats/digests/observations as texture) | `VizDensity` view=`text` |
| 05 | `/ledger` | Readable insight instrument + VIR controls | `VizLedger` |

**Density vs ledger:** indexes 01–04 accept only `VizDensity` (atmosphere). Index 05 accepts only `VizLedger` (InsightCards, open questions, self-model, interests, priority-vs-actual, diffs, VIR meters).

Shared contracts: [`packages/viz-contracts`](../packages/viz-contracts).

## Run locally (fixtures)

```powershell
pnpm --filter @cortex/viz-contracts build
pnpm --filter @cortex/data-verse dev
```

Opens on http://localhost:5179. Without `VITE_VIZ_API_URL`, the UI uses deterministic fixtures.

## Run locally (live MCP)

```powershell
pnpm --filter @cortex/mcp-server dev
$env:VITE_VIZ_API_URL="http://localhost:8790"
$env:VITE_VIZ_BEARER="<your-mcp-token>"
$env:VITE_VIZ_FIXTURES="0"
pnpm --filter @cortex/data-verse dev
```

### Projection API (mcp-server)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/viz/density?view=scan\|particle\|cross\|text` | Bearer required; empty store → structured empty payload |
| GET | `/v1/viz/ledger?channel=mirror\|questions\|self\|interests\|attr\|diff` | Bearer required |
| POST | `/v1/viz/verdict` | `{ insightId, verdict: confirm\|reject\|refine, ... }` → intrapersonal VIR |
| POST | `/v1/viz/projection` | Offline embedding→3D snapshot (`kind=viz_projection`) |
| POST | `/v1/twin` `{ "job": "viz-projection" }` | Same snapshot job |

On Railway, the dashboard calls these via **`/api/viz/...`** (same-origin proxy).

Weekly `twin-pipeline` also writes the viz projection snapshot after portrait.

## Acceptance checklist

- **AC1** ModeNav shows 00–05; all routes use `DvFrame`.
- **AC2** Fixtures render non-empty 01–05 offline.
- **AC3** 01–04 never import InsightCard detail fields; 05 never mounts Brain/Particle/Insight/Text as primary.
- **AC4–AC5** Live density/ledger/verdict behind bearer; 401 without auth on MCP direct.
- **AC6** Visual intent: density = atmosphere; ledger = only place to act.
- **AC7** `pnpm --filter @cortex/data-verse build` succeeds.