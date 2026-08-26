# Feature Implementation Plan

**Overall Progress:** `15%`

User: Forma founders (Jack commercial, Eric technical, Joe product) and the AIs they already use.
Job: Keep a shared, evidence-backed model of what Forma currently knows, believes, has decided, and is building.
Behavior: Agents can ask “what is true now / what changed / where are we inconsistent?” and get cited company state, not a personal Cortex dump.
Acceptance: After cutover, a merged Forma PR, a Granola meeting, and a Forma-scoped Codex session each produce cited evidence; interpretive state changes wait for human approval; nothing older than `cutover_at` and no personal Cortex/gbrain records enter the store.
Out of scope: Claude Chat / Cowork / Claude Code; Slack; personal inbox / all GitHub repos; importing Cortex or gbrain pages; ordinary ChatGPT app chats (no local transcript).

## TLDR

Stand up a **fresh Company Brain** for Forma: reuse Cortex/gbrain **code patterns**, never existing personal records. V0 ingests Eric through approved GitHub repos, Jack through Granola + Forma-scoped Codex + tight Gmail, and durable AI conclusions through MCP write-back. The compiler proposes state; humans approve. Claude is deferred.

Thesis: [AI-Native Company OS](https://app.notion.com/p/3c6196f5637381a19f5fcd68f33abf7b).

## Critical Decisions

- **Clean-room store** — separate Supabase/Postgres, credentials, checkpoints, and `cutover_at`. No Cortex import, no “same DB, different `org_id`”. Rationale: personal and company evidence must never mix.
- **Reuse code, not records** — copy/adapt `CortexStore` epistemic ladder, collector, Gmail/GitHub/Codex adapters, evidence broker, MCP. Rationale: the hard parts already exist; V0 is re-scope + allowlists.
- **State is the product** — evidence in, proposed transitions out. Auto-apply only hard events (e.g. PR merged). Interpretive changes need approval. Rationale: a Slack-style anecdote must not become truth.
- **V0 sources (locked)** — GitHub App on approved Forma repos; Granola **API + webhooks** (not Granola MCP); Codex limited to ChatGPT project “Forma” and `emed` cwd; Gmail after those three work, with label/domain/`cutover_at` query. Rationale: highest-signal surfaces already verified locally.
- **Claude ignored for now** — no Chat, Cowork, or Claude Code ingest in V0. Ordinary ChatGPT app chats stay MCP write-back only (bodies are not local). Rationale: Jack asked to drop Claude; ChatGPT Desktop has no complete local chat archive.
- **MCP is I/O, not the store** — `brain.context` / `brain.changes` / `brain.propose_*`; Notion is a human-readable projection, not canonical. Rationale: matches the thesis; ChatGPT/Claude remain the reasoning layer.
- **No Slack in V0** — Jack: Slack is not the best surface.

Verified local Codex scopes (do not widen):

| Scope | Path |
|---|---|
| ChatGPT project “Forma” | `~\.codex\.chatgpt-projects\g-p-6a5ce2bd588c8191b36fa21f22def31e` |
| Engineering cwd `emed` | `Desktop\Current Projects\emed` |

Product repo on disk is named `Work companion` (`productName: Forma`). GitHub App allowlist is the canonical repo list, not the Desktop folder name.

## Tasks:

- [x] 🟩 **Step 1: Lock V0 sources and exclusions**
  - [x] 🟩 Read Company Brain thesis; treat as fresh org state, not personal Cortex
  - [x] 🟩 Confirm Eric → GitHub; Jack → Granola, email, ChatGPT/Codex
  - [x] 🟩 Verify Codex Forma project + `emed` transcripts exist locally
  - [x] 🟩 Defer Claude Chat / Cowork / Code (no Forma Cowork folder; Chat bodies not local)

- [ ] 🟥 **Step 2: Clean-room store and cutover**
  - [ ] 🟥 New isolated env (`COMPANY_BRAIN_*`) and empty Supabase project
  - [ ] 🟥 Reuse `CortexStore` observation / hypothesis / decision / VIR shapes in a company-scoped store
  - [ ] 🟥 Set `cutover_at`, repo/folder/domain allowlists; refuse any Cortex/gbrain import path
  - [ ] 🟥 Dry-run: empty tables, no personal records

- [ ] 🟥 **Step 3: GitHub connector (Eric)**
  - [ ] 🟥 GitHub App installed only on approved Forma repos (inspire `packages/adapters/github`, do not reuse unscoped PAT scan)
  - [ ] 🟥 Ingest PRs, reviews, issues, CI, deployments; commits only when tied to active work
  - [ ] 🟥 Webhooks + periodic reconcile; infer “Eric is working on X” from open PRs/assignments, not commit volume
  - [ ] 🟥 Dry-run against allowlist; merged PR lands as evidence within minutes

- [ ] 🟥 **Step 4: Granola ingest (Jack)**
  - [ ] 🟥 Official Granola API + webhooks into a dedicated Forma space (Business/Enterprise)
  - [ ] 🟥 Notes / summaries / transcripts as evidence with citations; Granola MCP is investigation-only, not canonical ingest
  - [ ] 🟥 Dry-run: one meeting → proposed commercial observation, nothing pre-cutover

- [ ] 🟥 **Step 5: Codex Forma-scoped ingest (Jack)**
  - [ ] 🟥 Filter existing `@cortex/adapter-codex` to ChatGPT project “Forma” + `emed` cwd only
  - [ ] 🟥 Do not ingest other Codex rollouts or ordinary ChatGPT app chats
  - [ ] 🟥 Dry-run: Forma/emed sessions only; count and titles reviewable before write

- [ ] 🟥 **Step 6: MCP write-back and query**
  - [ ] 🟥 Tools: `brain.context`, `brain.current_state`, `brain.decisions`, `brain.changes`, `brain.evidence`, `brain.propose_observation`, `brain.propose_decision`, `brain.propose_state_change`
  - [ ] 🟥 Proposals enter an approval queue; they do not become company state on write
  - [ ] 🟥 Point ChatGPT/Cursor MCP at Company Brain (Claude wiring later)
  - [ ] 🟥 Smoke: explicit “record the durable conclusions” creates a pending proposal with provenance

- [ ] 🟥 **Step 7: State compiler**
  - [ ] 🟥 Pipeline: evidence → observation → affected topic/person → propose hypothesis / decision / state change → approve/reject/refine → current state
  - [ ] 🟥 Auto-apply only hard events (e.g. PR merged); interpretive changes always need a human
  - [ ] 🟥 Test query: “Where are Jack, Eric, and Joe operating from inconsistent assumptions?”

- [ ] 🟥 **Step 8: Gmail (after GitHub, Granola, Codex)**
  - [ ] 🟥 Reuse `@cortex/adapter-gmail` with a tight query: Forma label and/or approved domains, one account, `cutover_at`
  - [ ] 🟥 No full personal inbox
  - [ ] 🟥 Dry-run: three envelopes, all in-scope

- [ ] 🟥 **Step 9: Notion projection**
  - [ ] 🟥 Human-readable “Current Company State” page fed from the store
  - [ ] 🟥 Notion is a projection, not the canonical database

## Stop conditions

- Any evidence predating `cutover_at`, or any Cortex/gbrain personal page, is a bug.
- Claude ingest, Slack, unscoped GitHub, or full Gmail are out of this plan.
- No implementation until Jack says implement; this file is the contract.
