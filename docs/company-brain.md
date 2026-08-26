# Company Brain V0

Fresh Forma company-state service. Reuses Cortex code patterns, not personal records.

## Product

Jack and Eric (and their agents) query cited current state: what is true, what changed, where they disagree. Interpretive changes wait for a founder. Claude, Slack, and personal Cortex data stay out.

## Run

Company Brain reads **only** `COMPANY_BRAIN_*` variables.

```bash
pnpm --filter @cortex/company-brain test
pnpm --filter @cortex/company-brain-server dev
```

- Health: `GET /health`
- GitHub App webhook: `POST /v1/webhooks/github` (signature required)
- MCP: `POST /mcp` with Jack, Eric, or agent bearer token

Set `COMPANY_BRAIN_STORE=memory` for local tests only. Production refuses
ephemeral mode and requires `COMPANY_BRAIN_STORE=supabase` with the dedicated
Company Brain project URL, service key, and matching project ref.

`apps/company-brain/migrations/` is for a **separate** Supabase project; apply
the SQL files in numeric order and never apply them to Cortex. The migrations
include an upgrade path, RLS policies, and transactional RPCs for complete
event ingestion, source ordering, hard facts, and founder verdicts.
The hardening migration moves any legacy partial delivery into
`company_brain_private.cb_upgrade_replay_events` and frees its delivery ID for
manual GitHub redelivery.

## Tokens / roles

| Token | Role |
|---|---|
| `COMPANY_BRAIN_INGEST_TOKEN` | GitHub ingest only |
| `COMPANY_BRAIN_AGENT_TOKEN` | Propose, query; cannot approve |
| `COMPANY_BRAIN_FOUNDER_JACK_TOKEN` | Propose, query, approve/reject/refine |
| `COMPANY_BRAIN_FOUNDER_ERIC_TOKEN` | Propose, query, approve/reject/refine |

All bearer tokens and the GitHub webhook secret must be at least 32 bytes.

Hard facts (merged PR) auto-apply. Interpretations stay pending until a founder verdict.

Not in this slice: Granola, Codex collector, Gmail, Notion projection.
