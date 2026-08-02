# Data-verse visualization

Ikeda-style computational frontend for Cortex. Product fork lives at [`apps/data-verse`](../apps/data-verse). The Lovable-hosted upstream remains at [jackye426/data-verse-render](https://github.com/jackye426/data-verse-render) (local backup: `../data-verse-render-backup`); Cortex owns the integrated app.

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

## Run (fixtures)

```powershell
pnpm --filter @cortex/viz-contracts build
pnpm --filter @cortex/data-verse dev
```

Opens on http://localhost:5179. With no `VITE_VIZ_API_URL`, the UI uses deterministic fixtures (AC2).

## Live personal dashboard (Lovable)

URL: https://data-verse-render.lovable.app  
Repo: [jackye426/data-verse-render](https://github.com/jackye426/data-verse-render)

Server functions proxy to Railway MCP. In Lovable **Secrets**, set:

| Name | Value |
|------|--------|
| `CORTEX_MCP_TOKEN` | Same bearer as Railway MCP |
| `VIZ_API_URL` | Optional; default `https://cortexmcp-server-production-1c59.up.railway.app` |

Without the token, the live site falls back to fixtures.

### Projection API (mcp-server)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/viz/density?view=scan\|particle\|cross\|text` | Bearer required; empty store → structured empty payload |
| GET | `/v1/viz/ledger?channel=mirror\|questions\|self\|interests\|attr\|diff` | Bearer required |
| POST | `/v1/viz/verdict` | `{ insightId, verdict: confirm\|reject\|refine, ... }` → intrapersonal VIR |
| POST | `/v1/viz/projection` | Offline embedding→3D snapshot (`kind=viz_projection`) |
| POST | `/v1/twin` `{ "job": "viz-projection" }` | Same snapshot job |

Weekly `twin-pipeline` also writes the viz projection snapshot after portrait.

## Acceptance checklist

- **AC1** ModeNav shows 00–05; all routes use `DvFrame`.
- **AC2** Fixtures render non-empty 01–05 offline.
- **AC3** 01–04 never import InsightCard detail fields; 05 never mounts Brain/Particle/Insight/Text as primary.
- **AC4–AC5** Live density/ledger/verdict behind bearer; 401 without auth.
- **AC6** Visual intent: density = atmosphere; ledger = only place to act.
- **AC7** `pnpm --filter @cortex/data-verse build` succeeds; no Lovable runtime in the Cortex fork.
