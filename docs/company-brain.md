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

Default store is isolated in-memory. `apps/company-brain/migrations/001_init.sql` is for a **separate** Supabase project; do not apply it to Cortex.

## Tokens / roles

| Token | Role |
|---|---|
| `COMPANY_BRAIN_INGEST_TOKEN` | GitHub ingest only |
| `COMPANY_BRAIN_AGENT_TOKEN` | Propose, query; cannot approve |
| `COMPANY_BRAIN_FOUNDER_JACK_TOKEN` | Propose, query, approve/reject/refine |
| `COMPANY_BRAIN_FOUNDER_ERIC_TOKEN` | Propose, query, approve/reject/refine |

Hard facts (merged PR) auto-apply. Interpretations stay pending until a founder verdict.

Not in this slice: Granola, Codex collector, Gmail, Notion projection.
