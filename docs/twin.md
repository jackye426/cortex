# Twin path extension points (D1–D5)

Cortex’s Personal Executive Twin builds on **distillates + MCP search**, not Obsidian.

| Layer | Capability | Status in repo |
|-------|------------|----------------|
| **D1** Project graph | `entities` + `entity_links`; MCP `list_entities` / `upsert_entity` / `link_entity` / `get_entity_links` | Foundational |
| **B3** Project briefs | `kind=project_brief` via `POST /v1/project-brief` or `pnpm distillate -- --project-brief` | Scaffolding job |
| **D2** Priority vs actual | Ambition/priority entities + `stubPriorityVsActual` in `project-brief.ts` | Stub |
| **D3** Decisions & outcomes | MCP `capture_decision` → distillate `kind=decision\|outcome` | Light capture |
| **D4** Theory of Jack | Distillate `kind=self_model` via `stubSelfModelRefresh` | Stub |
| **D5** Capital allocator | `stubAllocatorContext` prompt seed over D1–D4 | Stub (no product) |

**Non-goals:** Obsidian middle vault; embedding full email/raw records; browser visit firehose.

See also [mcp.md](mcp.md) retrieval playbook and [README.md](../README.md) status.
