# Feature Implementation Plan

**Overall Progress:** `45%` (implementation)
**Discovery Progress:** `100%`

## Product Contract

- **User:** Forma founders — Jack (commercial) and Eric (technical) — and the AI agents they already use.
- **Job:** Keep a shared, evidence-backed model of what Forma currently knows, believes, has decided, and is building.
- **Behavior:** A founder or agent can ask “what is true now?”, “what changed?”, or “where are we inconsistent?” and receive cited, current company state.
- **Acceptance:** A post-cutover GitHub event, Granola meeting, and founder MCP write-back produce immutable cited evidence. Conflicting Jack/Eric assumptions produce a pending state proposal; an authenticated founder can approve, reject, or refine it; approval atomically creates a new state revision; a subsequent query returns the revised answer and citations.
- **Isolation:** No pre-cutover evidence, personal Cortex/gbrain records, unapproved repositories, unrelated Codex sessions, or personal inbox messages enter Company Brain.
- **Out of scope:** Claude Chat, Cowork, Claude Code, Slack, ordinary ChatGPT app history, unscoped GitHub, full Gmail, and importing existing Cortex/gbrain records.

## TLDR

Build a **fresh Company Brain** for Forma by reusing Cortex/gbrain code patterns, not personal schemas or records. First prove one complete GitHub → evidence → proposal → approval → state → cited-query slice. Then connect Granola, Forma-scoped Codex, founder MCP write-back, and finally tightly scoped Gmail. Claude remains deferred.

Thesis: [AI-Native Company OS](https://app.notion.com/p/3c6196f5637381a19f5fcd68f33abf7b).

## Critical Decisions

- **Clean-room and fail-closed:** Use a separate Supabase/Postgres project, storage, credentials, checkpoints, and `cutover_at`. Company Brain entrypoints accept only `COMPANY_BRAIN_*` configuration, verify the expected project reference, and refuse generic Cortex credential fallbacks.
- **Company model, not personal model:** Reuse the epistemic concepts and interfaces, but introduce company-native actors, topics/entities, immutable source events, proposals, decisions, and state revisions. Do not reuse intrapersonal tables unchanged.
- **Immutable history:** Store each source event/version once, deduplicate deliveries, reject stale updates, and maintain a separate latest-state pointer. Never overwrite history with a stable PR, issue, note, or session ID.
- **Cutover rule:** Admissibility is based on the source action that changed company reality. Missing/invalid timestamps are rejected before raw persistence. A pre-cutover PR merged post-cutover contributes only the post-cutover merge event and minimal identifiers—not pre-cutover comments/body as evidence.
- **Approval boundary:** Service identities ingest, agents propose, authenticated founders approve/reject/refine. Interpretive changes never auto-apply. Hard facts such as “PR merged” may auto-create factual state but cannot silently create an interpretation.
- **V0 founder coverage:** Eric → approved GitHub repos and MCP write-back. Jack → Granola, Forma-scoped Codex, MCP write-back, and later Gmail.
- **MCP is I/O:** MCP exposes context, changes, evidence, proposals, verdicts, and current state. It is not the canonical store.
- **Granola:** Use the official API + signed webhooks with a dedicated Forma folder/space and workspace API key. Granola MCP remains investigation-only.
- **Claude and Slack:** Excluded from V0.
- **Notion:** Human-readable projection only; never canonical state or the approval authority.

## State and Proposal Contract

```text
signed/authorized source event
  → scope + cutover gate
  → immutable evidence event
  → factual observation
  → compiler or founder proposes change
  → pending proposal
  → founder approve | reject | refine
  → immutable state revision
  → current-state pointer
  → cited MCP answer
```

Minimum durable shapes:

- **Actor:** founder, agent, or ingest service; provider identity mappings; role.
- **Source event:** source, external event/version ID, actor, source-action time, captured time, immutable payload reference, scope decision, provenance.
- **Observation:** factual statement, epistemic class, event/evidence links, affected topics/entities.
- **Proposal:** `pending | approved | rejected | superseded`; immutable proposed payload; proposer; evidence IDs; affected state key; created time.
- **Verdict:** approver, action, note/refinement, timestamp.
- **State revision:** topic/entity key, statement, epistemic class, confidence, effective time, supersedes ID, evidence IDs, proposal/verdict IDs.
- **Current state:** pointer to the effective revision; never an independently mutable claim.

Verified local Codex scopes (do not widen):

| Scope | Path |
|---|---|
| ChatGPT project “Forma” | `~\.codex\.chatgpt-projects\g-p-6a5ce2bd588c8191b36fa21f22def31e` |
| Engineering cwd `emed` | `Desktop\Current Projects\emed` |

The product repo may appear locally as `Work companion` (`productName: Forma`). GitHub App installation/repository IDs—not local folder names—define GitHub scope.

## Tasks

- [x] 🟩 **Step 1: Lock product target, sources, and exclusions**
  - [x] 🟩 Read the Company Brain thesis and choose a fresh organisational state boundary
  - [x] 🟩 Verify Forma/`emed` Codex scopes and Claude limitations
  - [x] 🟩 Select GitHub, Granola, scoped Codex, founder write-back, then Gmail
  - [x] 🟩 Exclude personal Cortex/gbrain data, Claude, Slack, broad inbox/repo access

- [x] 🟩 **Step 2: Build the fail-closed company foundation**
  - [x] 🟩 Company-only environment loader (`COMPANY_BRAIN_*`); persistent Supabase store and SQL prepared for a separate project
  - [x] 🟩 Refuse generic Cortex credential fallbacks, missing project ref, or absent `cutover_at`
  - [x] 🟩 Actor/identity mappings: ingest service, proposing agent, approving founders
  - [x] 🟩 Immutable source events, observations, proposals, verdicts, state revisions, current-state pointers
  - [x] 🟩 Enforce scope and source-action cutover at connector and ingest boundary
  - [x] 🟩 Empty store reports zero Cortex/gbrain records
  - [ ] 🟥 Provision the separate Supabase project and wire the SQL store (schema is ready; runtime is isolated memory until then)

- [x] 🟩 **Step 3: Expose authenticated proposal, approval, and query MCP**
  - [x] 🟩 Query tools: `brain_context`, `brain_current_state`, `brain_decisions`, `brain_changes`, `brain_evidence`
  - [x] 🟩 Proposal tools: `brain_propose_observation`, `brain_propose_decision`, `brain_propose_state_change`
  - [x] 🟩 Founder-only tools: `brain_approve_proposal`, `brain_reject_proposal`, `brain_refine_proposal`
  - [x] 🟩 Apply verdict + state revision + current pointer atomically with stale-proposal protection
  - [x] 🟩 Citations required; GitHub payloads minimized and raw payload retrieval withheld

- [x] 🟩 **Step 4: Prove one GitHub-to-state vertical slice (Eric)**
  - [x] 🟩 Allowlist explicit Forma repository IDs (and optional installation IDs)
  - [x] 🟩 Require webhook signatures; deduplicate `X-GitHub-Delivery`
  - [x] 🟩 Support PRs, reviews, issues, checks/CI, and deployments
  - [ ] 🟥 Create the GitHub App in GitHub and point it at a deployed webhook
  - [ ] 🟥 Reconcile missed deliveries with installation authentication
  - [x] 🟩 Reject stale deliveries while retaining immutable event history
  - [x] 🟩 End-to-end test: merged PR → cited evidence/current hard fact → `brain.changes`

- [ ] 🟥 **Step 5: Validate and connect Granola (Jack)**
  - [ ] 🟥 Contract spike: confirm Business/Enterprise entitlement, workspace key, Forma folder ID, payload IDs/timestamps, participant attribution, signatures, retries, and transcript retrieval
  - [ ] 🟥 Register signed folder-filtered webhooks and fetch canonical note/summary/transcript through the API
  - [ ] 🟥 Treat webhook notifications as triggers; deduplicate/version fetched note content
  - [ ] 🟥 End-to-end: one Forma meeting → cited commercial observation → pending interpretive proposal

- [ ] 🟥 **Step 6: Add the local Forma-scoped Codex collector (Jack)**
  - [ ] 🟥 Run the collector on Jack’s machine and authenticate it as a limited ingest service
  - [ ] 🟥 Preselect exact normalized ChatGPT-project/`emed` metadata before opening or uploading JSONL
  - [ ] 🟥 Reject missing, ambiguous, or out-of-scope metadata; never fall back to “ingest all”
  - [ ] 🟥 Use independent company checkpoints; preview count/titles/paths before first write
  - [ ] 🟥 End-to-end: one allowed session → cited evidence; unrelated rollouts remain absent

- [ ] 🟥 **Step 7: Compile cross-founder state**
  - [ ] 🟥 Give Jack and Eric authenticated MCP write-back for observations, decisions, and proposed state changes
  - [ ] 🟥 Attribute every claim to founder/agent/source while keeping evidence distinct from interpretation
  - [ ] 🟥 Compile evidence → observations → affected topic/entity → proposal; version compiler prompts/rules
  - [ ] 🟥 Never auto-apply interpretive output; retain alternatives, contradictions, and provenance
  - [ ] 🟥 Golden scenario: conflicting Jack/Eric assumptions → pending proposal → founder verdict → revised cited answer

- [ ] 🟥 **Step 8: Add tightly scoped Gmail after the core loop works**
  - [ ] 🟥 Reuse Gmail transport/checkpoint patterns with a Forma label as the required scope; domain allowlists may narrow, never widen
  - [ ] 🟥 Apply the same predicate to initial listing and every Gmail History message
  - [ ] 🟥 Reject missing headers/labels and pre-cutover messages; never ingest the full personal inbox
  - [ ] 🟥 Dry-run and review representative included/excluded threads before write

- [ ] 🟥 **Step 9: Add the Notion projection**
  - [ ] 🟥 Publish a human-readable “Current Company State” from approved state revisions
  - [ ] 🟥 Show revision time, confidence, owner, and evidence links
  - [ ] 🟥 Confirm Notion edits cannot mutate canonical state

## Verification Gates

Each connector must pass unit contract tests plus an end-to-end ingest → store → query test.

- [x] 🟩 Pre-cutover and missing-timestamp events are rejected before raw persistence
- [x] 🟩 Out-of-scope repo/folder/domain/cwd events leave no records or artifacts
- [x] 🟩 Duplicate delivery replay is idempotent; stale/equal-time delivery cannot regress latest state
- [x] 🟩 Agent can propose but cannot approve; unauthenticated/non-founder approval fails
- [x] 🟩 Approve/reject/refine and concurrent stale approval paths are covered
- [x] 🟩 State supersession preserves complete history and current pointer integrity
- [x] 🟩 Every answer citation resolves to immutable evidence under access policy
- [x] 🟩 Compiler eval distinguishes hard facts from interpretations and does not auto-apply the latter
- [x] 🟩 Clean-room audit finds zero personal Cortex/gbrain records
- [x] 🟩 V0 stores no raw blobs; minimized event provenance remains per source event

## Stop Conditions

- Any personal Cortex/gbrain record, pre-cutover evidence, or out-of-scope source artifact enters Company Brain.
- Any Company Brain service can start using generic/fallback Cortex credentials.
- Any agent can approve its own interpretive proposal or bypass founder authentication.
- Any connector widens scope when metadata, labels, signatures, or timestamps are missing.
- Claude ingest, Slack, broad GitHub/Gmail access, or ordinary ChatGPT history enters V0.
