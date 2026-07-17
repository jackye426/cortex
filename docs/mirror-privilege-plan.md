# Plan: Mirror privilege boundary + evidence broker

## Goal

Keep Mirror interpretations accurate by allowing raw evidence when needed, without giving every connected agent service-role vault access.

**Rule:** The default AI surface sees distillates. Raw evidence is retrieved narrowly, temporarily, and explicitly via an evidence broker.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Deployment shape | **Two MCP endpoints in one service** initially (`/mcp` Mirror, `/mcp/ops` or equivalent). Split Railway services later if needed. |
| Mirror tools | **No raw vault tools** on the Mirror endpoint. |
| Sessions | **Always broker-only** — never expose full `get_session` / message dumps on Mirror. |
| Calendar | **Structure via sanitised view** on Mirror (title/summary, start, end, attendee count, ids). **Descriptions and attachments via broker.** |
| Who decides access | Agent may **request** evidence; **deterministic policy** grants or denies. Agent preference is not authority. |
| Sensitive access | Requires **explicit, scoped, short-lived capabilities** (not a permanent boolean on the agent). |
| Restricted data | Requires an **ops-issued capability** (stronger than Mirror self-serve sensitive caps). |
| Compilers / ingest | Retain raw access via a **separate non-interactive vault credential** (not the Mirror key). |
| Portraits / behavioural models | **Stronger protection** than ordinary distillates (class, audit, tighter retrieval). |

## Non-goals

- Sealing Mirror so it can never see raw content
- Moving collectors/compilers off vault access
- Redesigning OpenAI/OpenRouter provider choice in this plan
- Full human-approval product UI in v1 (ops-issued capabilities + policy engine first)

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
┌──────────────────────────────────────────────────────────────┐
│ Vault credential (non-interactive)                             │
│ API ingest · collector · distill compilers · twin-pipeline     │
│ Full raw tables + Storage                                      │
└───────────────────────────────┬────────────────────────────────┘
                                │ writes distillates / briefs / portraits
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ One MCP process, two endpoints                                 │
│                                                                │
│  /mcp          Mirror credential                               │
│                distillates · embeddings · sanitised calendar     │
│                briefs · priority_vs_actual · gated portrait      │
│                retrieve_supporting_evidence (policy + caps)      │
│                                                                │
│  /mcp/ops      Vault or elevated credential                      │
│                ops tools · capability issuance · maintenance     │
└───────────────────────────────┬────────────────────────────────┘
                                │ broker RPC (read-only, limited)
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Evidence broker                                                │
│ Agent requests → policy evaluates → excerpts or deny           │
│ Redaction · field allowlist · access log · ephemeral payload   │
└──────────────────────────────────────────────────────────────┘
```

---

## Capability model

Access is not “agent said sensitivity_ack=true”. Access is **capability tokens** evaluated by deterministic policy.

| Class | Examples | How granted | Lifetime |
|-------|----------|-------------|----------|
| **routine** | Sanitised calendar structure; ordinary distillate search; non-sensitive broker fields (e.g. email subject/timestamp within window) | Implicit for Mirror endpoint auth | Session / request |
| **sensitive** | Email/session body excerpts; Drive text previews; calendar descriptions/attachments; youtube watch detail beyond digest | Explicit **scoped short-lived capability** minted for purpose + sources + window + max_results | Minutes (e.g. 5–15), single-use or tight reuse cap |
| **restricted** | Identity/credential-like Drive paths; auth/recovery mail; raw material matching sensitivity denylist; bulk export shapes | **Ops-issued capability** only (`/mcp/ops` or signed ops API) | Short-lived; narrower scope; mandatory audit |
| **reflective_sensitive** | `portrait`, `self_model`, behavioural hypotheses | Mirror may read under stronger audit; write/refresh and cross-export follow portrait policy; broker excerpts **not** auto-fed into portrait inputs | Persisted as distillates but labeled + audited |

**Flow**

1. Agent calls `retrieve_supporting_evidence` (and optionally `request_evidence_capability` first).
2. Policy checks: endpoint, capability class, source_types, date_range, subject_ids, max_results, permitted_fields, existing caps.
3. Allow → redacted excerpts + `ephemeral: true` + access log.
4. Deny → structured reason (`needs_capability`, `ops_only`, `window_exceeded`, `source_forbidden`).

Agent requests never bypass policy.

---

## Workstreams

### A. Credentials

1. **Vault credential (non-interactive):** today’s service-role equivalent for API, collector, compilers, twin-pipeline. Never configure this on the Mirror client path.
2. **Mirror credential:** SELECT/EXECUTE only on distillates, entities (read), sanitised calendar view, `cortex_search_memory`, broker RPC, portrait read RPCs as allowed by policy.
3. Deny Mirror on: `records` (raw), `messages`, `turns`, `raw_artifacts`, Storage buckets, unrestricted `cortex_search_records`.
4. Railway MCP process may hold **both** keys server-side initially, but:
   - Mirror endpoint handlers use **only** Mirror DB client
   - Ops / compiler HTTP jobs / internal distill routes use vault client
5. Later: split processes if desired; not required for v1

**Acceptance**

- Mirror DB client cannot `SELECT` `records` / `messages`
- Compilers on vault credential still distill
- Compromising a Mirror-only token does not yield service-role SQL

---

### B. Two MCP endpoints (one service)

| Endpoint | Audience | Tools |
|----------|----------|-------|
| `/mcp` (Mirror) | Cursor / executive agents | Distillate search, ask_mirror, sanitised calendar, twin read/write that stay on derived memory, evidence request + broker (policy-gated), gated portrait tools |
| `/mcp/ops` | Operators / maintenance | Vault tools (search_records, full session, full thread, file dumps), capability issuance for **restricted**, maintenance |

Cursor default config points at **Mirror only**.

**Mirror must not register**

- `search_records`
- `get_email_thread`
- `get_session` / full message dump
- Raw `get_file_summary` / firehose list tools
- Unsanitised calendar (descriptions/attachments)

**Sanitised calendar on Mirror**

- View or RPC: `id`, `summary`/`title`, `start`, `end`, `attendee_count`, optional `meeting_type` from digest join — **no** `description`, attachment payloads, or conference join secrets
- Descriptions / attachments → broker (`source_types=["calendar"]`, fields like `description_excerpt`)

**Sessions**

- No Mirror `get_session`
- Session evidence only via broker (`source_types=["session"]`, truncated turns, permitted fields)

**Acceptance**

- Mirror tool list contains zero raw vault browsers
- Ops endpoint still usable for debugging
- Playbook: deep evidence → request capability (if needed) → `retrieve_supporting_evidence`

---

### C. Evidence broker + policy engine

**Request shape**

```ts
retrieve_supporting_evidence({
  purpose: string,                 // required; audited
  source_types: string[],          // email | session | calendar | drive | github | youtube | ...
  date_range?: { since: string; until: string },
  subject_ids?: string[],
  max_results?: number,            // hard-capped
  permitted_fields?: string[],
  capability_id?: string,          // required when policy class ≥ sensitive
})
```

**Capability minting (sensitive)**

```ts
request_evidence_capability({
  purpose: string,
  class: "sensitive",              // restricted only via ops
  source_types: string[],
  date_range: { since: string; until: string },
  subject_ids?: string[],
  max_results: number,
  permitted_fields: string[],
  ttl_seconds?: number,            // capped by policy
})
→ { capability_id, expires_at, scope } | { denied, reason }
```

**Restricted**

- `issue_restricted_capability` on **ops endpoint only**
- Same scope fields; shorter TTL; mandatory ops token / operator identity in audit

**Policy (deterministic)**

- Map `(source_types × fields × subjects)` → class `routine | sensitive | restricted`
- Examples:
  - calendar structure fields → not broker (use sanitised view)
  - calendar `description_excerpt` → sensitive
  - session turn text → sensitive (always broker)
  - drive body / identity-like paths → restricted or sensitive+denylist skip
  - email body_excerpt → sensitive
- Enforce TTL, max_results, window width, field allowlist
- Redact via `@cortex/redaction`; skip secret/PII hits rather than “redact and still send” for high-risk patterns when policy says fail-closed
- Return `ephemeral: true`; playbook forbids persisting into portrait / long-term agent memory

**ask_mirror**

- Remove silent raw `searchRecords` expansion
- Mirror answers from distillates + sanitised calendar + citations
- Agent may fetch broker excerpts then re-ask; Mirror does **not** auto-escalate privileges

**Acceptance**

- Sensitive without valid capability → deny
- Restricted without ops-issued capability → deny
- Expired / overscope capability → deny
- Excerpts only; access logged
- ask_mirror does not pull raw email/youtube implicitly

---

### D. Interpretation audit

Every Mirror interpretation and broker access logs:

| Field | Example |
|-------|---------|
| purpose | query or broker purpose |
| surface | `ask_mirror` \| `retrieve_supporting_evidence` \| `request_evidence_capability` \| `portrait` |
| endpoint | `mirror` \| `ops` |
| model / provider | when LLM invoked |
| evidence_classes | `distillate` \| `sanitised_calendar` \| `broker_excerpt` |
| capability_id / class | if used |
| source_refs | ids returned |
| retention | `ephemeral` \| `persisted_distillate` \| `portrait` |
| zdr / data_collection | env flags |
| token_id_hash | existing |

**Acceptance**

- Can answer: what raw ids left the vault, under which capability, toward which model

---

### E. Portrait / behavioural model protection

1. Label `portrait`, `self_model`, and hypothesis-heavy artefacts `reflective_sensitive`
2. Stronger audit on read and refresh than ordinary digests
3. Portrait refresh inputs = distillates / briefs / priority_vs_actual / prior portrait — **not** broker ephemeral excerpts by default
4. Ops capability required to export or bulk-dump portraits if that tool exists

**Acceptance**

- Broker excerpts excluded from portrait inputs by default
- Portrait refresh audit includes model + source distillate ids

---

### F. Provider / egress hygiene

- Transmit excerpts only through broker path
- Apply same ZDR / data-collection client defaults as distillate path
- Do not log broker bodies to Railway stdout
- Document third-party PII in email/Drive excerpts

---

## Implementation sequence

| Step | Work | Risk | Status |
|------|------|------|--------|
| 1 | Dual endpoints + Mirror tool allowlist (still one DB key) | Low | **Done** (`/mcp`, `/mcp/ops`) |
| 2 | Sanitised calendar view + Mirror calendar tool | Low | **Done** (+ SQL view migration) |
| 3 | Capability store + policy engine + broker tools | Medium | **Done** (in-memory caps; table migration ready) |
| 4 | Remove ask_mirror silent raw expansion; playbook update | Medium | **Done** |
| 5 | Interpretation / capability / broker audit rows | Low | **Done** (metadata on `audit_log`) |
| 6 | Portrait `reflective_sensitive` + input exclusion | Low | **Done** (metadata flags; inputs already distillate-only) |
| 7 | Mirror DB role + MCP Mirror handlers on Mirror key | Higher | **Partial** — `SUPABASE_MIRROR_KEY` documented; apply role grants in Supabase before wiring client |
| 8 | Optional later: separate Railway services | Ops | Pending |

Migration: `supabase/migrations/20260716160000_evidence_capabilities_and_calendar_view.sql`

---

## Verification

```powershell
# Mirror endpoint: no search_records / get_session / get_email_thread
# Sanitised calendar: structure fields only
# Broker session request without capability → deny (sensitive)
# Mint sensitive capability → broker returns excerpts → expires
# Restricted without ops capability → deny
# ask_mirror: distillate citations; no implicit raw email dump
pnpm quality-gate -- --limit=11
# Mirror key cannot SELECT records; vault key compilers still run
```

---

## Success criteria

1. Mirror endpoint exposes no raw vault browsers; sessions are broker-only
2. Calendar structure available sanitised; descriptions/attachments only via broker
3. Agent can request evidence; policy + capabilities decide access
4. Sensitive = short-lived scoped caps; restricted = ops-issued only
5. Compilers use separate non-interactive vault credential
6. Portraits / behavioural models have stronger controls than ordinary distillates
7. Quality-gate does not regress after raw-expansion removal
8. Auditable trail for raw egress and interpretation calls
