# Twin path (D1–D5) + RAG ops

Cortex’s Personal Executive Twin builds on **distillates + MCP search**, not Obsidian.

Unified memory substrate (session sampling, lenses, YouTube digests, `ask_mirror`, portraits): see [memory-substrate.md](memory-substrate.md).

**Intrapersonal intelligence (I0–I6):** evidence integrity → interests → hypothesis ledger → outcomes → longitudinal diffs → four product views. Execution plan: [intrapersonal-roadmap.md](intrapersonal-roadmap.md).

| Layer | Capability | Status in repo |
|-------|------------|----------------|
| **C** RAG | `distillates.embedding` + hybrid `search_memory`; embed on write; `pnpm embed-backfill` | Production-useful |
| **C+** Lenses | `mode=operational\|reflective\|both` + domain/topic filters | Shipped |
| **C+** Mirror | `ask_mirror` cited synthesis (ephemeral) | Shipped |
| **C+** YouTube | Weekly `youtube_interest_digest` | Shipped |
| **D1** Project graph | `entities` / `entity_links`; MCP `list_entities` / `upsert_entity` / `link_entity` / `seed_entities` | Seeded from `metadata.projects[]` + topics |
| **B3** Project briefs | `kind=project_brief` via `POST /v1/project-brief` or `pnpm distillate -- --project-brief` | Rollup + optional embed |
| **D2** Priority vs actual | Week distillate `kind=priority_vs_actual` (session hours → projects) | Heuristic attribution |
| **D3** Decisions & outcomes | MCP `capture_decision` / `capture_outcome` + first-class `decisions` tables | I4 loop |
| **D4** Theory of Jack | Versioned `self_model_versions` + `kind=self_model` projection + portrait | Self-model v2 (I3) |
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

# Evidence integrity (I1) — also runs inside twin-pipeline after seed-entities
# MCP: extract_observations / audit_source_coverage / list_observations
# HTTP: POST /v1/twin { "job": "extract-observations" }
#       POST /v1/audit/source-coverage
# Insight quality fixtures:
pnpm quality-gate -- --suite=insight
pnpm quality-gate -- --suite=all --fixture

# Interest intelligence (I2) — weekly twin-pipeline after reflective adapters
# MCP: refresh_interest_map / get_interest_map / list_interests / log_reflection
# HTTP: POST /v1/twin { "job": "interest-map" }
# Adapter: reading-interest (Calibre → reading_interest_digest)

# Intrapersonal S3–S6 — hypotheses, self-model v2, weekly mirror, experiments, diffs
# MCP: list_hypotheses / propose_hypothesis / confirm_hypothesis / reject_hypothesis
#      get_self_model / refresh_self_model / get_weekly_mirror / list_open_questions
#      propose_experiment / complete_experiment / how_have_i_changed / intrapersonal_metrics
# HTTP: POST /v1/twin { "job": "self-model" | "weekly-mirror" | "open-questions" }
# Weekly pipeline: interest-map → ability-model → cycles → self-model v2 → diff
#                  → weekly-mirror → open-questions → portrait

# YouTube interest digests + quality gate
pnpm youtube-digest -- --dry-run
pnpm quality-gate -- --fixture --limit=11
pnpm quality-gate -- --limit=11

# Scheduled pipeline (nightly / weekly / historical backfill)
pnpm twin-pipeline -- --mode=nightly
pnpm twin-pipeline -- --mode=weekly
pnpm twin-pipeline -- --mode=backfill --max-batches=20 --batch-size=30
```

HTTP (same bearer as MCP): `POST /v1/distillate`, `/v1/project-brief`, `/v1/embed-backfill`, `/v1/twin` (`job`: `seed-entities` | `priority-vs-actual` | `project-brief` | `self-model` | `portrait` | `youtube-digest` | `extract-observations` | `interest-map` | `weekly-mirror` | `open-questions`), `POST /v1/twin-pipeline`, `POST /v1/ask-mirror`, `POST /v1/quality-gate`, `POST /v1/source-adapter`.

## Automation

| Schedule | Mode | What runs |
|----------|------|-----------|
| Daily 03:00 | `nightly` | Distill new sessions → enabled `CORTEX_SOURCE_ADAPTERS` operational digests → YouTube digest → embed-backfill → seed-entities |
| Sunday 04:00 | `weekly` | Nightly work + reflective adapters + interest-map + priority-vs-actual + ability-model + cycles + self-model v2 + diff + weekly-mirror + open-questions + portrait |
| Manual | `backfill` | Repeat nightly batches until no undistilled sessions remain |

**Windows (pm2):** after `pnpm --filter @cortex/mcp-server... build`, start cron apps:

```powershell
pm2 start ecosystem.config.cjs --only cortex-twin-nightly,cortex-twin-weekly
pm2 save
```

**Railway:** add a cron service or use an external scheduler to `POST` the MCP URL:

```powershell
curl -Method POST "https://<mcp-host>/v1/twin-pipeline" `
  -Headers @{ Authorization = "Bearer $env:CORTEX_MCP_TOKEN"; "Content-Type" = "application/json" } `
  -Body '{"mode":"nightly"}'
```

## MCP twin tools

`seed_entities`, `capture_decision`, `capture_outcome`, `list_decisions`, `priority_vs_actual`, `refresh_self_model`, `get_self_model`, `list_hypotheses`, `confirm_hypothesis` / `reject_hypothesis`, `get_weekly_mirror`, `list_open_questions`, `propose_experiment` / `complete_experiment`, `how_have_i_changed`, `intrapersonal_metrics`, `allocator_context`, plus graph tools and `search_memory`.

**Non-goals:** Obsidian middle vault; embedding full email/raw records; browser visit firehose; a separate allocator product UI.

See also [mcp.md](mcp.md) retrieval playbook and [README.md](../README.md) status.
