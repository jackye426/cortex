# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Cortex is a pnpm workspace (Node 25+, pnpm 10+, ESM everywhere) implementing a personal AI/session vault:
collectors run on Windows → ingest API → Supabase (EU) → LLM distillates + pgvector → remote MCP server →
visualization frontend. See [README.md](README.md) and [docs/](docs/) for the data pipeline; this file focuses on
what you need to change code.

Workspace members: `apps/{api,mcp-server,collector,data-verse,chatgpt-extension,openai-mirror}` and
`packages/{core,viz-contracts,redaction,normalize,adapters/*,google-auth}`.

Per [AGENTS.md](AGENTS.md), build/implement/review work follows the **vibe-law** contract
(`.claude/skills/vibe-law/SKILL.md`): state user + behavior change + acceptance test + out-of-scope before
implementing a thin ask; don't edit during review/investigate requests; close with proof (diff, command output,
git status).

## Where the frontend lives — read before any UI work

The data-verse UI exists in **two copies**, and this repo holds the secondary one.

| Copy | Location | Stack | Auth | Role |
|------|----------|-------|------|------|
| Private dashboard | `jackye426/data-verse-render`, cloned at `../data-verse-render-backup` | TanStack **Start** + Lovable | Cookie session via `/v1/web-auth/*` | **Source of truth** — jackye.wiki |
| Rollback dashboard | `apps/data-verse` (this repo) | Vite **SPA** | `server.mjs` injects a bearer server-side | Keep building; don't author here |
| Visual baseline | `../data-verse-f98-baseline` (worktree at `f98f902`) | — | — | Pre-Cortex reference |

**New UI features go to `data-verse-render`.** Work done in `apps/data-verse` does not reach jackye.wiki.
The two copies are otherwise byte-identical across shells, routes and styles — they diverge only in
`src/lib/viz-api.ts` (transport) and how contracts are imported. Private auth spans matching
`codex/private-jackye-wiki-auth` branches in both repos. Full topology: [docs/data-verse.md](docs/data-verse.md).

## Commands

Run everything from the repo root; `pnpm --filter <pkg>` targets a workspace member.

```powershell
pnpm install
pnpm build                      # pnpm -r run build
pnpm typecheck                  # every package
pnpm lint                       # root ESLint flat config over the whole repo

# data-verse (rollback copy)
pnpm dev:data-verse             # vite on http://localhost:5179 (fixture mode by default)
pnpm build:data-verse           # builds @cortex/viz-contracts first, then the app — required order
pnpm start:data-verse           # node server.mjs (static server + /api/viz proxy)
pnpm --filter @cortex/data-verse typecheck

# shared contracts → generated copy in data-verse-render
pnpm check:viz-contracts        # fails if the frontend copy is stale
pnpm sync:viz-contracts         # regenerate it

# backend the frontends talk to
pnpm dev:mcp                    # MCP + viz API on http://localhost:8790
pnpm test:mcp                   # node:test via tsx, all *.test.ts in apps/mcp-server
pnpm --filter @cortex/mcp-server exec tsx --test src/web-auth.test.ts   # single test file
```

`@cortex/data-verse` has no test suite; its acceptance criteria are the AC1–AC7 checklist in
[docs/data-verse.md](docs/data-verse.md), verified by running the app and `pnpm build:data-verse`.

### Running data-verse against live data

```powershell
pnpm --filter @cortex/mcp-server dev
$env:VITE_VIZ_API_URL="http://localhost:8790"
$env:VITE_VIZ_BEARER="<mcp-token>"
$env:VITE_VIZ_FIXTURES="0"
pnpm dev:data-verse
```

## Frontend architecture (applies to both copies)

React 19 + TanStack Router + Tailwind v4, path alias `@/*` → `src/*`. Aesthetic is Ikeda-style: black field,
monospace, hairline rules, uppercase micro-labels.

### The core rule: density vs ledger

Six indexes, all wrapped in `DvFrame` and listed in `ModeNav`:

| Id | Route | Data |
|----|-------|------|
| 00 | `/` | index hub, mounts every shell as thumbnails |
| 01 | `/scan` | `VizDensity` view=`scan` |
| 02 | `/particles` | `VizDensity` view=`particle` |
| 03 | `/insights` | `VizDensity` view=`cross` |
| 04 | `/streams` | `VizDensity` view=`text` |
| 05 | `/ledger` | `VizLedger` |

Indexes 01–04 are **atmosphere**: they must never render InsightCard-style detail fields, and never mount ledger
detail/verdict UI. Index 05 is the **only** place with readable prose and VIR controls (confirm/reject/refine), and it
must not mount Brain/Particle/Insight/Text as its primary field. Breaking this is an AC3/AC6 regression.

### Shell-driven geometry

Client canvases own the generative geometry at fixed budgets (`DENSITY_BUDGETS`: brain 9k points,
particle 5.2k/22 orbits, cross 4.6k nodes, text 180×900). The API only supplies **semantic overlays** —
annotations, meters, channel bars, stream seeds — mapped in `src/lib/overlays.ts` and passed as optional props.
Shells fall back to their built-in seeded defaults when a prop is absent, so they always render standalone.
Do not move geometry generation to the server; do not change budgets without updating `DENSITY_BUDGETS`.

Canvas shells (`BrainField`, `ParticleField`, `InsightField`, `TextStream`, `ScanSlices`) share
`src/lib/dataverse-canvas.ts` `useDataCanvas(draw)` for resize + DPR + rAF plumbing; it reads `--dv-fg` /
`--dv-accent` from CSS once and zeroes `t` under `prefers-reduced-motion`. Randomness goes through the seeded
LCG in `src/lib/dataverse-data.ts` / `fixtures.ts` — never introduce `Math.random()` into render paths.

### Data flow

`route → useDensity(view) / useLedger(channel) → lib/viz-api.ts → overlays.ts → shell props`.

The transport differs per copy:

- **`data-verse-render`** — browser calls Cortex directly with `credentials: "include"`; helpers in
  `src/lib/cortex-auth.ts`, login gate in `src/routes/__root.tsx`, `X-Cortex-CSRF: 1` on writes.
- **`apps/data-verse`** — fixture mode when `VITE_VIZ_FIXTURES=1` or dev on localhost with no `VITE_VIZ_API_URL`;
  otherwise same-origin `/api/viz/*` proxied by [server.mjs](apps/data-verse/server.mjs) with the bearer held
  server-side.

**Degradation is visible, never silent**: a failed or empty live fetch returns fixtures tagged
`meta.source="degraded"`, and every index renders `SourceStrip` showing `SRC/LIVE|FIXTURE|DEGRADED`.
Keep this contract when adding surfaces.

### Styling

`src/styles.css` holds two layers: the `--dv-*` tokens (bg/fg/dim/faint/line/hair/accent) plus
`dv-lattice` / `dv-interlace` / `dv-micro` utilities and `dv-scan`/`dv-sweep`/`dv-marquee` keyframes — that's the
data-verse system, exposed as Tailwind classes like `text-dv-faint`, `border-dv-hair`. The second block is an
inherited shadcn-style `--background`/`--primary` palette, largely unused; prefer `--dv-*` for new UI.
All colors are `oklch`. Animated elements carry `dv-anim` so reduced-motion can disable them.

### Conventions worth not relearning

- `src/routeTree.gen.ts` is generated by the router Vite plugin — never hand-edit. New route = new file in
  `src/routes/`.
- Per-route `head: () => ({ meta })` only renders because `__root.tsx` mounts `<HeadContent />`. Removing it
  silently kills every route's title and OG tags.
- `apps/data-verse` is a Router SPA with no server entry; `data-verse-render` is TanStack Start. Don't copy
  `createServerFn` / server-only patterns into this repo's copy.
- Repo-normalized line endings are enforced by [.gitattributes](.gitattributes) (`* text=auto`). Source files are
  BOM-free; don't reintroduce BOMs when porting files between the two repos.

## Backend contract the frontends depend on

[packages/viz-contracts](packages/viz-contracts/src/index.ts) is the single source of truth for `VizDensity`,
`VizLedger`, `VizVerdict*` and `DENSITY_BUDGETS`. `apps/data-verse` imports it as a workspace dependency;
`data-verse-render` cannot, so it carries a **generated** copy at `src/lib/viz-contracts.ts` produced by
[scripts/sync-viz-contracts.mjs](scripts/sync-viz-contracts.mjs). Never hand-edit that copy — it drifted badly
once already.

A contract change touches three places: the package, `apps/mcp-server/src/viz/*` (density/ledger/verdict/projection
builders), and the regenerated frontend copy (`pnpm sync:viz-contracts`). Rebuild `@cortex/viz-contracts` before
the app picks up type changes.

Viz API on `apps/mcp-server` (Hono):

| Method | Path |
|--------|------|
| GET | `/v1/viz/density?view=scan\|particle\|cross\|text` |
| GET | `/v1/viz/ledger?channel=mirror\|questions\|self\|interests\|attr\|diff` |
| POST | `/v1/viz/verdict` (writes an intrapersonal VIR verdict) |
| POST | `/v1/viz/projection` (offline embedding→3D snapshot, kind `viz_projection`) |

`authorizePrivateViz` in `apps/mcp-server/src/index.ts` accepts either the service bearer or a signed web-session
cookie; cookie-authenticated **mutations** additionally require an allowed `Origin` and `X-Cortex-CSRF: 1`.
All `/v1/viz/*` responses are `no-store`. Auth internals and tests live in `src/web-auth.ts` /
`src/web-auth.test.ts`; password hashes come from `pnpm web-auth:hash`.

## Known-red, out of scope

`pnpm lint` reports 8 pre-existing errors outside the frontend (`apps/mcp-server/src/store/*`,
`src/viz/ledger.ts`, `ecosystem.config.cjs`, `hooks/claude-stop.mjs`, `packages/adapters/calibre`). `apps/data-verse`
itself is lint-clean. `npx tsc --noEmit` in `data-verse-render` reports 11 `exactOptionalPropertyTypes` errors in
that repo's own components. Don't attribute these to your change.
