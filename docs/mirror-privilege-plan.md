# Plan: Mirror privilege boundary + evidence broker

## Goal

Keep Mirror interpretations accurate by allowing raw evidence when needed, without giving every connected agent service-role vault access.

**Rule:** The default AI surface sees distillates. Raw evidence is retrieved narrowly, temporarily, and explicitly via an evidence broker.

## Non-goals

- Sealing Mirror so it can never see raw content
- Moving collectors/compilers off vault access (they remain vault-tier jobs)
- Redesigning OpenAI/OpenRouter provider choice in this plan
- Building a separate product UI for approvals (policy hooks only; human approval can be env/flag/ops initially)

## Current state (problem)

| Today | Risk |
|-------|------|
| MCP uses `SUPABASE_SERVICE_ROLE_KEY` | Compromise of Mirror host = full vault |
| Default tools include `search_records`, `get_email_thread`, `get_session`, `get_calendar_range`, `get_file_summary` | Any agent can browse raw records |
| `ask_mirror` reflective path expands to raw youtube/email | Implicit raw retrieval without broker/limits/audit |
| `audit_log` records route + token hash only | No purpose, model, sources, retention class |
| Portraits / hypotheses treated like ordinary distillates | Sensitive derived memory under-protected |

## Target architecture

```text
┌─────────────────────────────────────────────────────────┐
│ 1. Vault + ingestion (service role / vault credential)  │
│    collector, API ingest, distill compilers, twin-pipeline │
│    raw records/sessions + redaction on write              │
└───────────────────────────┬─────────────────────────────┘
                            │ compilers write distillates
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Mirror surface (mirror credential — no raw SELECT)   │
│    search_memory, ask_mirror, briefs, priority_vs_actual │
│    portrait (gated), allocator_context, entities (read)  │
│    citations + redacted excerpts only                    │
└───────────────────────────┬─────────────────────────────┘
                            │ when raw needed
                            ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Evidence broker (read-only RPC + tool)               │
│    retrieve_supporting_evidence(...)                     │
│    limits, field allowlist, redaction, access log        │
│    sensitive categories require explicit approval flag    │
└─────────────────────────────────────────────────────────┘
```

---

## Workstreams

### A. Credential and database privilege split

**Intent:** Mirror cannot `SELECT` from raw tables even if the app is buggy.

1. Create Supabase roles (or dedicated keys) roughly:
   - `cortex_vault` — current service-role scope for API + collectors + compilers
   - `cortex_mirror` — SELECT on distillates, entities (read), approved views/RPCs only
2. Expose Mirror-safe RPCs / views:
   - Keep/extend `cortex_search_memory` for distillate hybrid search
   - Add `cortex_retrieve_supporting_evidence(...)` (broker)
   - Optional: `cortex_list_distillates`, portrait list RPCs
3. Deny Mirror role on: `records`, `messages`, `turns`, `raw_artifacts`, Storage `raw`/`exports`, and unrestricted `cortex_search_records`
4. Railway: MCP **Mirror** service uses `SUPABASE_MIRROR_KEY` (or renamed); API / pipeline jobs keep service role
5. Short-term escape hatch: single MCP binary, two env modes (`CORTEX_MCP_PROFILE=mirror|ops`) before splitting services

**Acceptance**

- With Mirror key alone, PostgREST cannot read `records` / `messages`
- `search_memory` / distillate list still work
- Compilers on vault key still distill

---

### B. Default Mirror tool surface

**Intent:** Connected agents are not vault admins.

**Keep on default Mirror profile**

- `cortex_help`, `search_memory`, `ask_mirror`
- `list_recent_work` (session/github/email **distillate-biased** or metadata-only; see note below)
- Twin: `list_decisions` / `capture_decision`, `priority_vs_actual`, `refresh_self_model` / `get_portrait` / `list_portrait_versions`, `allocator_context`
- Entities: read-oriented `list_entities`, `get_entity_links` (writes optional / ops-only)

**Move off default Mirror profile → ops profile or broker**

- `search_records`
- `get_email_thread`
- `get_session` (full messages)
- `get_calendar_range` (or keep as broker-approved thin calendar tool — decide in B1)
- `get_file_summary` / ebook / spotify / youtube list tools that dump vault rows

**B1 decision (calendar):** Prefer thin `get_calendar_range` on Mirror if it returns only summary/start/end/attendee count (no descriptions/bodies). Otherwise route through broker.

**B2 decision (`list_recent_work`):** Prefer returning session titles + distillate snippets / github_outcome digests, not raw email payloads.

**Acceptance**

- Default Cursor MCP config only loads Mirror tools
- Ops/debug still available via `CORTEX_MCP_PROFILE=ops` or separate URL
- Playbook updated: raw deep-dive → `retrieve_supporting_evidence`

---

### C. Evidence broker

**Tool / RPC shape**

```ts
retrieve_supporting_evidence({
  purpose: string,              // required free-text reason for audit
  source_types: string[],       // email | session | calendar | drive | github | youtube | ...
  date_range?: { since: string; until: string },
  subject_ids?: string[],       // entity keys, project ids, thread ids, session ids
  max_results?: number,         // hard-capped (e.g. ≤ 10)
  permitted_fields?: string[],  // timestamp, sender, subject, body_excerpt, title, ...
  sensitivity_ack?: boolean,    // required for sensitive categories
})
```

**Broker behavior**

1. Read-only
2. Enforce source allowlist + date window (default max window e.g. 90d; sensitive shorter)
3. Cap results and excerpt length (e.g. ≤ 500–800 chars / item)
4. Run `@cortex/redaction` (and Drive-like PII heuristics) before return; drop items that still look like secrets
5. Strip fields not in `permitted_fields`
6. Log access: who/token hash, purpose, sources, ids returned, sensitivity class, model-not-yet (broker itself), timestamp
7. Sensitive categories (`drive` body, identity-like filenames, portrait internals, auth/recovery mail) require `sensitivity_ack=true` or ops profile
8. Response marked `ephemeral: true` — playbook: do not write broker payloads into portrait / long-term memory

**Wire into `ask_mirror`**

- Remove ad-hoc `searchRecords` expansion for youtube/email
- Mirror may call broker internally when confidence/gaps warrant, OR expose broker as a tool the outer agent calls before re-asking Mirror
- Prefer **tool-visible broker** first (explicit); optional later: Mirror auto-broker with same limits + audit

**Acceptance**

- Broker returns excerpts only; secrets redacted/skipped
- Over-limit / over-window requests rejected
- Sensitive without ack rejected
- Access rows appear in audit/evidence_access log
- ask_mirror no longer silently dumps raw email/youtube payloads

---

### D. Interpretation audit + retention metadata

Extend beyond route-level `audit_log`:

| Field | Example |
|-------|---------|
| purpose | user query or broker purpose |
| surface | `ask_mirror` \| `retrieve_supporting_evidence` \| `portrait` |
| model / provider | OpenRouter model id |
| evidence_classes | `distillate` \| `broker_excerpt` |
| source_refs | distillate ids / record ids returned |
| retention | `ephemeral` \| `persisted_distillate` \| `portrait` |
| zdr / data_collection flags | from env |
| token_id_hash | existing |

**Acceptance**

- Every `ask_mirror` and broker call writes a structured audit row
- Ops can answer: what raw ids were sent to which model, when

---

### E. Sensitive derived memory

1. Tag `portrait`, `self_model`, and claims with `claimType=hypothesis` as sensitivity class `reflective_sensitive`
2. Default Mirror can read portraits; exporting/sending full portrait text to third-party tools should follow same audit as broker
3. Do not auto-merge broker raw excerpts into portrait refresh inputs unless explicitly flagged

**Acceptance**

- Portrait refresh audit includes model + source distillate ids
- Broker excerpts excluded from portrait inputs by default

---

### F. Provider / egress hygiene (policy, light code)

Document and verify (mostly ops):

- What Mirror/broker transmit (excerpts vs full bodies)
- Provider (OpenRouter / OpenAI) and ZDR / data-collection settings already used for distillates
- No broker content in verbose Railway logs
- Third-party PII awareness for email/Drive excerpts

No change to training defaults assumed; keep current ZDR-oriented distillate settings and apply same HTTP client defaults to Mirror/broker LLM calls.

---

## Suggested implementation sequence

| Step | Work | Depends | Risk |
|------|------|---------|------|
| 0 | ADR / this plan agreed; decide B1 calendar + B2 list_recent_work | — | Low |
| 1 | Mirror tool profile split (`mirror` vs `ops`) — **no DB change yet** | 0 | Low — fastest risk reduction |
| 2 | Evidence broker tool + RPC stub over existing service role (limits + redaction + log) | 1 | Medium |
| 3 | Remove silent raw expansion from `ask_mirror`; use broker or distillates only | 2 | Medium |
| 4 | Interpretation audit fields | 2–3 | Low |
| 5 | Supabase `cortex_mirror` role + revoke raw table access; MCP uses Mirror key | 2–4 | Higher — needs careful deploy |
| 6 | Portrait sensitivity + exclude broker excerpts from portrait inputs | 3–4 | Low |
| 7 | Optional: split Railway MCP mirror vs ops services | 5 | Ops |

**Do step 1 before step 5.** Tool-surface lockdown reduces blast radius immediately; DB role split hardens it.

---

## Rollout / verification

```powershell
# Profile
CORTEX_MCP_PROFILE=mirror   # default
CORTEX_MCP_PROFILE=ops      # vault tools

# Broker dry checks
# - email last 30d, max_results=3, permitted_fields=timestamp,sender,subject,body_excerpt
# - drive without sensitivity_ack → reject
# - password-like preview → skipped/redacted

# Mirror
pnpm quality-gate -- --limit=11
# ask_mirror operational Q → distillate citations only
# ask_mirror needing raw → agent calls retrieve_supporting_evidence then re-asks

# Privilege
# Mirror key: SELECT records → fail
# Vault key: compilers still run
```

---

## Success criteria

1. Default connected agent cannot perform unrestricted vault search
2. Mirror credential cannot read raw tables directly
3. Raw access only via broker with purpose, caps, redaction, audit
4. Most queries answered from distillates/embeddings/briefs/portraits
5. Quality-gate does not regress (≥50%, target 11/11) after ask_mirror raw-expansion removal
6. Operators can audit what raw evidence left the vault toward which model

---

## Open questions (resolve in step 0)

1. Calendar on Mirror thin tool vs broker-only?
2. Broker auto-called inside `ask_mirror` vs agent-orchestrated only?
3. Human approval mechanism for sensitive: env flag, ops profile, or future UI?
4. One MCP service with profiles vs two Railway services from day one?
5. Should `list_recent_work` stay Mirror-facing if it still touches `records` under the hood? (If yes, rewrite to distillate/entity index before role split.)
