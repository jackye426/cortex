# Unified Memory Substrate

Cortex evolves task-oriented distillates into one evidence-backed memory layer with operational and reflective lenses. Raw vault data stays immutable; interpretation is derived and replayable.

## Architecture (v1)

```text
raw vault / records / sessions
        ↓
richer session distillates  +  weekly YouTube interest digests
        ↓
distillates.embedding (one space) + metadata lenses
        ↓
topic/project entity hubs
        ↓
search_memory (operational | reflective | both)
        ↓
ask_mirror (cited, ephemeral Analyst)
        ↓
optional versioned portrait (after quality gate)
```

## What ships in v1

| Capability | Status |
|------------|--------|
| Stratified session sampling (first/mid/last/tool-heavy) | Yes |
| Richer session metadata (topics, commitments, evidenced behaviors) | Yes — no speculative psychology at write time |
| Metadata lenses on `search_memory` | Yes |
| YouTube weekly interest digests (embedded) | Yes |
| Connection candidates (ephemeral ranking) | Yes |
| `ask_mirror` cited synthesis | Yes |
| Versioned `portrait` snapshots | Yes (weekly / on demand) |
| Email/calendar/GitHub/Spotify/Drive/browser adapters | Yes — post-gate v2 compilers; enabled by default in twin-pipeline ([source-adapters.md](source-adapters.md)) |

## Commands

```powershell
# Session distillates (enriched)
pnpm distillate -- --limit=20

# YouTube weekly interest digest
pnpm youtube-digest -- --dry-run
pnpm youtube-digest -- --week=2026-W28

# Nightly pipeline includes sessions + YouTube digest
pnpm twin-pipeline -- --mode=nightly

# Cited Analyst
# MCP tool: ask_mirror
# HTTP: POST /v1/ask-mirror  { "query": "...", "mode": "both" }

# Quality gate (fixture or live store)
pnpm quality-gate -- --fixture --limit=11
pnpm quality-gate -- --limit=11

# Post-gate source adapters
pnpm source-adapter -- --list
pnpm source-adapter -- --adapter=email-thread --dry-run
```

## Retrieval modes

| Mode | Prefer |
|------|--------|
| `operational` | summaries, commitments, decisions, project briefs, outcomes |
| `reflective` | interest digests, portraits, exploration/observation fields on summaries |
| `both` | union with labels preserved |

## Evidence rules

- Persist observable evidence; infer psychology only in `ask_mirror` as `hypothesis`.
- Keyword-only record hits are weaker than embedded distillates.
- YouTube (and later media) digests are required for semantic cross-source comparison.
- Other sources remain keyword-retrievable until their adapters are enabled.
- **I1 evidence integrity:** reflective/both `ask_mirror` uses source-balanced retrieval; assistant-derived kinds (`portrait`, `self_model`, …) are down-ranked; material claims need provenance. Durable facts land in `observations` (see [intrapersonal-roadmap.md](intrapersonal-roadmap.md)).
- Audit: MCP `audit_source_coverage` / `POST /v1/audit/source-coverage`. Insight fixtures: `pnpm quality-gate -- --suite=insight`.

## Migration

Apply `supabase/migrations/20260713120000_memory_lenses_search.sql` for lens-aware `cortex_search_memory`.

## Evaluation

Baseline questions live in `apps/mcp-server/src/eval/baseline.ts`. Run `pnpm quality-gate` before enabling additional source adapters or relying on portraits in agent context.
