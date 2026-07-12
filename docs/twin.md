# Twin path (D1–D5) + RAG ops

Cortex’s Personal Executive Twin builds on **distillates + MCP search**, not Obsidian.

| Layer | Capability | Status in repo |
|-------|------------|----------------|
| **C** RAG | `distillates.embedding` + hybrid `search_memory`; embed on write; `pnpm embed-backfill` | Production-useful |
| **D1** Project graph | `entities` / `entity_links`; MCP `list_entities` / `upsert_entity` / `link_entity` / `seed_entities` | Seeded from `metadata.projects[]` |
| **B3** Project briefs | `kind=project_brief` via `POST /v1/project-brief` or `pnpm distillate -- --project-brief` | Rollup + optional embed |
| **D2** Priority vs actual | Week distillate `kind=priority_vs_actual` (session hours → projects) | Heuristic attribution |
| **D3** Decisions & outcomes | MCP `capture_decision` + `list_decisions` | Light capture + list |
| **D4** Theory of Jack | `kind=self_model` via `refresh_self_model` / `--self-model` | Reads D2/D3/briefs |
| **D5** Capital allocator | MCP `allocator_context` → 3h/3w/3y prompt seed | Grounding pack only |

## Commands

```powershell
# Session distillates (LLM or stub) + embed on write
pnpm distillate -- --dry-run --limit=5
pnpm distillate -- --limit=20

# Embed existing distillates without re-LLM
pnpm embed-backfill -- --dry-run --limit=50
pnpm embed-backfill -- --limit=50

# Twin jobs
pnpm distillate -- --seed-entities
pnpm distillate -- --project-brief --limit=40
pnpm distillate -- --priority-vs-actual
pnpm distillate -- --self-model
```

HTTP (same bearer as MCP): `POST /v1/distillate`, `/v1/project-brief`, `/v1/embed-backfill`, `/v1/twin` (`job`: `seed-entities` | `priority-vs-actual`).

## MCP twin tools

`seed_entities`, `capture_decision`, `list_decisions`, `priority_vs_actual`, `refresh_self_model`, `allocator_context`, plus graph tools and `search_memory`.

**Non-goals:** Obsidian middle vault; embedding full email/raw records; browser visit firehose; a separate allocator product UI.

See also [mcp.md](mcp.md) retrieval playbook and [README.md](../README.md) status.
