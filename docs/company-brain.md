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
ephemeral mode and requires `COMPANY_BRAIN_STORE=supabase` with
`COMPANY_BRAIN_SUPABASE_URL`, service key, and matching project ref.

**Reuse the existing Cortex EU Supabase project** — add namespaced `cb_*`
tables there. Isolation is schema + `COMPANY_BRAIN_*` credentials (never fall
back to generic `SUPABASE_*`). Provisioning: [company-brain-provision.md](company-brain-provision.md).

Apply `apps/company-brain/migrations/` in numeric order (or
`node scripts/company-brain-apply-migrations.mjs`). Migrations include RLS,
transactional RPCs, and an upgrade path that queues legacy partial deliveries
in `company_brain_private.cb_upgrade_replay_events`.

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
