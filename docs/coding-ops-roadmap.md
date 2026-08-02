# Cortex Coding Ops Intelligence — Implementation Roadmap

This document is the execution plan to bring **Paxel-depth coding-session analysis** into Cortex: how you direct AI coding agents, which decisions you make, how work links to git outcomes, scored judgment across five axes, and a feedback loop that surfaces concrete growth edges.

It is written so implementation can proceed end-to-end without re-scoping. Each phase lists: goal, current baseline, data model, code touchpoints, work packages, MCP/API surface, pipeline changes, tests/eval, exit criteria, and dependencies.

**North-star:** A weekly coding builder profile the user trusts — specific, evidence-cited, and useful for improving how they steer agents — not a vanity scorecard.

**Strategic principle:** Port Paxel’s *method* (condense → events → git link → decisions → episode score → profile → feedback), not the YC product, Docker client, or upload path. All analysis stays in Cortex.

**Related docs:** [twin.md](twin.md) · [intrapersonal-roadmap.md](intrapersonal-roadmap.md) · [memory-substrate.md](memory-substrate.md) · [sources.md](sources.md)

---

## Motivation

Paxel (YC) demonstrates a strong pattern for coding-session intelligence:

1. Discover local AI transcripts (Claude Code, Codex, Cursor, …).
2. Parse into events, steering traces, plan files, and session signals.
3. Link sessions to git commit groups / episodes.
4. Classify decision exchanges against a law catalog.
5. Score episodes on five human-judgment axes.
6. Assemble a builder profile with strengths, growth edges, and insight cards.

Cortex already ingests and summarizes coding sessions, but stops at **executive memory** (`kind=summary`) plus thin intrapersonal atoms. It does not yet produce a **coding-ops judgment layer** comparable to Paxel.

This roadmap closes that gap for **Cursor / Claude Code / Codex first**, then generalizes.

---

## Current baseline (do not rebuild)

| Layer | Status | Primary paths |
|-------|--------|---------------|
| Session ingest | Shipped | `apps/api` `/v1/ingest`, `packages/adapters/{cursor,claude-code,codex}`, `hooks/*` |
| Canonical grain | Shipped | `sessions`, `turns`, `messages`, `tool_calls`, `records`, `raw_artifacts` |
| Session sampling | Shipped | `apps/mcp-server/src/session-sampler.ts` |
| Summary distillates | Shipped | `apps/mcp-server/src/distillate.ts` → `kind=summary` |
| Search / mirror | Shipped | `search_memory`, `ask_mirror`, evidence broker |
| Observations from summaries | Shipped | `intrapersonal/extract-observations.ts` (signals → factual atoms) |
| Twin pipeline | Shipped | `twin-pipeline.ts` nightly / weekly / backfill |
| Ability / weekly mirror / self-model | Shipped | Intrapersonal I-stack — adjacent, not coding-ops specific |

### What `kind=summary` already extracts

From `StructuredDistillate` in `distillate.ts`:

- `summary`, `projects`, `repos`, `nextActions`, `commercialVsTech`
- `openQuestions`, `topics`, `explicitCommitments`, `decisions`
- `explorationSignals`, `demonstratedBehaviors`, `frictionSignals` (each with evidence indices)

These remain the **executive / RAG substrate**. Coding ops adds a parallel judgment layer; it does not replace summary distillates.

### Gaps vs Paxel-like depth

| Capability | Cortex today |
|------------|--------------|
| Full-session event graph (steering, redirects, plan files, subagents) | Sampled summary only; no steering traces |
| Decision catalog / law classification | Free-text `decisions[]` + manual `capture_decision` |
| Session ↔ git episode linking | Weak (occasional branch/sha metadata) |
| Five-axis human-judgment scoring | None |
| Multi-day work streams / episodes | Project briefs only |
| Coding builder profile + growth edge | Ability model is keyword-ish; weekly mirror is intrapersonal |
| Insight cards grounded in agent-direction behavior | Mirror cards exist, but not this rubric |

---

## Layer map (extend, don’t fork)

Existing Twin path remains D1–D5. Intrapersonal work remains I0–I6. Coding ops adds **O0–O6**:

| Layer | Name | Phase |
|-------|------|-------|
| **O0** | Product contract + axis definitions | Phase 0 |
| **O1** | Session ops extract (events, steering, signals) | Phase 1 |
| **O2** | Narratives + decision catalog | Phase 2 |
| **O3** | Episodes + git linking | Phase 3 |
| **O4** | Five-axis episode scoring | Phase 4 |
| **O5** | Coding builder profile + feedback surfaces | Phase 5 |
| **O6** | Product-thinking bridge + generalization | Phase 6 |

Implementation order is strictly O0 → O1 → O2 → O3 → O4 → O5 → O6. O6 may prototype product-contract prompts early, but ships after O5.

**Relationship to intrapersonal:** Coding ops is **ops judgment**, not personality. Episode scores and profile cards may be cited as `observation` / `assistant_derived` evidence into ability-model / weekly mirror / self-model — they must not be merged into self-model schema as identity claims.

---

## Shared design decisions (locked)

### Scope (v1)

- Sources: **Cursor, Claude Code, Codex** only.
- Subject: human developer judgment in USER turns, not AI code volume.
- Runtime: Cortex TypeScript in `apps/mcp-server` (+ migrations). No dependency on `paxel.ycombinator.com` or `ghcr.io/yc-software/paxel-client`.
- Reference material: public Paxel `upload.sh` behavior + open ports (`paxel-skill` / `open-paxel`) for specs and prompts — reimplemented in-repo.

### Five axes (verbatim intent from Paxel rubric)

| Axis key | Question |
|----------|----------|
| `execution_leverage` | Does effort close outcome loops? |
| `steering` | Does the human control the AI? |
| `engineering_quality` | Is engineering rigor calibrated to risk? |
| `product_thinking` | Are user-facing decisions driven from user needs? |
| `planning` | Is planning effort calibrated to complexity? |

Rules:

- Scores are **1.0–10.0** when evidenced.
- **Omit** an axis key when there is no direct evidence (do not invent a low default).
- For `session_only` episodes (no commits): omit `execution_leverage` and `engineering_quality`.
- Resist halo effects: uneven profiles are correct.
- 7 = median competent agent operator.

Overall band cuts (for rollup display; document as approximate until calibrated):

| Band | Range |
|------|-------|
| WEAK | &lt; 4 |
| LIMITED | 4 – &lt; 6 |
| STRONG | 6 – &lt; 8 |
| ELITE | 8 – &lt; 9 |
| EXEMPLAR | ≥ 9 |

### Epistemic / privilege

- Coding ops atoms that are factual (`user redirected`, `plan file written`, `commit linked`) → may feed `observations` with `source_family=ai_sessions`.
- Axis scores, narratives, growth edges → `interpretation` / reflective compiled views — revisable, not vault facts.
- Privilege: `reflective_sensitive` for profile + episode scores (same class as portrait / weekly mirror).
- Raw transcripts stay in vault; profile stores redacted excerpts/paths only.

### Insight card contract

Every surfaced coding-ops insight must include:

1. What Cortex noticed  
2. Why it may matter  
3. What to try next (concrete)  
4. Citations (session_id / episode_id / distillate_id)  
5. Confidence + support_kind  

### Architectural rule

Prefer first-class tables for durable coding-ops objects (`session_ops_events`, `coding_decisions`, `coding_episodes`, `episode_scores`, `coding_builder_profiles`). Keep distillates as compiled / searchable views (`kind=session_ops_digest`, `episode_score`, `coding_builder_profile`). Do not persist psychology into raw vault rows.

---

## Target architecture

```text
sessions / turns / messages / tool_calls   (existing)
        │
        ├─ O1  session_ops_events (+ signals, steering traces)
        ├─ O2  session narratives + coding_decisions (catalog)
        ├─ O3  coding_episodes (+ git commit group links)
        ├─ O4  episode_scores (5 axes + prose)
        └─ O5  coding_builder_profiles (versioned rollup)
                 │
                 ├─ distillates: session_ops_digest | episode_score | coding_builder_profile
                 ├─ observations (factual ops atoms only)
                 ├─ weekly_mirror section: "How you build with agents"
                 └─ MCP feedback: get_coding_builder_profile, list_episode_scores, ask_mirror
```

Suggested package home:

```text
apps/mcp-server/src/session-ops/
  extract-events.ts
  narrative.ts
  decisions.ts
  git-episodes.ts
  score-episode.ts
  profile.ts
  decision_catalog.json
  prompts/
    session_narrative.md
    decision_classifier.md
    episode_scoring.md
```

---

## Phase 0 — Product contract (O0)

### Goal

Lock axis definitions, omission rules, privilege labels, and non-goals so later phases do not re-litigate scope.

### Work packages

1. Document axis anchors (adapt Paxel `episode_scoring.md` into `session-ops/prompts/`).
2. Define decision types + law catalog source of truth (`decision_catalog.json`).
3. Define privilege + Mirror grants for new tables.
4. Write fixture inventory: ≥3 Cursor, ≥3 Claude, ≥3 Codex sessions covering shipping / exploration / thin-prompt / heavy-steer cases.

### Exit criteria

- [ ] This roadmap accepted as the coding-ops contract.
- [ ] Prompt stubs + catalog checked into repo (even before wiring).
- [ ] Fixture list named under `apps/mcp-server/src/eval/fixtures/coding-ops/` (or equivalent).

**Depends on:** nothing. **Unblocks:** O1+.

---

## Phase 1 — Session ops extract (O1)

### Goal

Deterministic, full-grain extraction of coding-session events and signals from stored turns/messages/tool_calls (and raw JSONL when available) — richer than stratified summary sampling.

### Current gap

`distillSession` samples first/middle/last/tool-heavy turns. Steering redirects, plan files, and subagent loops are easy to miss.

### Data model

Migration: `supabase/migrations/YYYYMMDDHHMMSS_coding_ops_events.sql`

#### Table `session_ops_events`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `owner_id` | uuid | |
| `session_id` | uuid | → sessions |
| `event_index` | int | order in session |
| `event_type` | text | see enum below |
| `occurred_at` | timestamptz null | |
| `payload` | jsonb | paths, commands, shas, truncated texts |
| `content_hash` | text | dedupe |

Event types (v1):

```text
file_edit | file_create | file_read | bash_command
git_commit | git_push | git_branch_switch
test_run | error_encountered
agent_proposal | agent_thinking | user_directive
subagent_dispatch | subagent_return
```

#### Table `session_ops_snapshots` (optional v1; else distillate metadata)

Per-session rollup: steering traces, plan files, session_signals, user_highlights, active_time_windows.

### Work packages

**P1.1 — Event extractor**  
File: `apps/mcp-server/src/session-ops/extract-events.ts`  
Port behavioral spec from Paxel `events.py` onto Cortex grain (not raw filesystem discovery).

**P1.2 — Steering + plan + signals**  
Extract short redirects / constraints; detect plan files; compute signal counters including `product_references`.

**P1.3 — Persist + list**  
Store methods + MCP `list_session_ops` / HTTP twin job `session-ops-extract`.

### Pipeline

Nightly, after `runDistillateBatches` (summary):

```text
… → distill summaries → session-ops-extract → extract-observations → …
```

### MCP / API

| Tool / job | Purpose |
|------------|---------|
| `list_session_ops` | Inspect events/signals for a session |
| `extract_session_ops` | Run extractor (`dryRun` supported) |
| `POST /v1/twin` `job=session-ops-extract` | Pipeline trigger |

### Tests

- Unit: event typing from fixture turns/tool_calls.
- Integration: dry-run extract on fixture store.

### Exit criteria

- [ ] Fixture sessions produce stable event counts.
- [ ] Steering traces and plan files recovered when present in grain/raw.
- [ ] Existing `kind=summary` path unchanged.

**Depends on:** O0. **Unblocks:** O2.

---

## Phase 2 — Narratives + decision catalog (O2)

### Goal

Two-hop LLM analysis: (1) neutral CTO-style session narrative of *human* decisions; (2) classify decision exchanges against the law catalog.

### Data model

#### Table `coding_decisions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `owner_id` | uuid | |
| `session_id` | uuid | |
| `decision_type` | text | `strategic_redirect` \| `technical_catch` \| `product_insight` \| `option_selection` |
| `law_key` | text null | catalog key |
| `significance` | text | strategic / moderate / tactical |
| `domain` | text | architecture / product / … |
| `narrative` | text | one-sentence |
| `evidence` | jsonb | event indexes, excerpts |
| `outcome_signal` | text null | positive / negative / mixed / neutral |
| `confidence` | real | |
| `content_hash` | text | dedupe |

Narratives may live as:

- `distillates.kind = session_ops_narrative`, or
- column / object storage on `session_ops_snapshots`.

Prefer distillate for searchability.

### Work packages

**P2.1 — Narrative prompt + runner**  
`session-ops/prompts/session_narrative.md` + `narrative.ts`  
Hard rules: credit USER judgments only; never credit AI diagnoses to the human; ≤520 words; intent tag `shipping|exploration|ambiguous`.

**P2.2 — Decision extract + classify**  
`session-ops/decisions.ts` + catalog JSON  
Candidate pairing (agent_proposal → user_directive); LLM classify; regex fallback; in-session outcome heuristic.

**P2.3 — Optional promotion**  
High-significance `product_insight` / `strategic_redirect` may call existing `captureDecision` path — never drop coding_decisions row.

### Caching

Cache LLM results keyed by `(session_id, content_hash, prompt_version)` in DB or store layer so reruns are cheap (Paxel-like).

### Exit criteria

- [ ] Fixtures yield narratives + classified decisions with evidence indexes.
- [ ] Decision-type histogram available for profile cards.
- [ ] Quality fixtures reject narratives that credit AI work to the human.

**Depends on:** O1. **Unblocks:** O4 (can score with weaker episodes); O3 improves scoring quality.

---

## Phase 3 — Episodes + git linking (O3)

### Goal

Group commits and link sessions into episodes / work streams so scoring judges closed loops, not isolated chats.

### Data model

#### Table `coding_commit_groups`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `owner_id` | uuid | |
| `repo_remote` | text | normalized |
| `group_type` | text | pr / cluster / single |
| `title` | text | |
| `pr_number` | int null | |
| `branch` | text null | |
| `commit_shas` | text[] | |
| `insertions` / `deletions` | int | from numstat |
| `earliest_commit_at` / `latest_commit_at` | timestamptz | |

#### Table `coding_episodes`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `owner_id` | uuid | |
| `episode_type` | text | feature / bugfix / refactor / infrastructure / implementation |
| `session_ids` | uuid[] | |
| `commit_group_ids` | uuid[] | |
| `link_confidence` | real | |
| `window_start` / `window_end` | timestamptz | |

Link priority (Paxel-faithful):

1. PR match (1.0)  
2. SHA match (0.9)  
3. Branch match (0.7)  
4. Timestamp overlap ±1h (0.5)  
5. Else session_only (0.3)

### Work packages

**P3.1 — Git collect**  
Host/collector or MCP job: `git log` + numstat for remotes known from session cwd/metadata (Codex already carries some git fields). Support `--no-repo` / missing git → session_only episodes.

**P3.2 — Group + link**  
`session-ops/git-episodes.ts`

**P3.3 — Work streams**  
Optional weekly: gap-based multi-episode streams for profile narrative.

### Exit criteria

- [ ] Fixture repos link sessions to commits with documented precision.
- [ ] Session_only path works when git unavailable (cloud agents, deleted cwd).

**Depends on:** O1 (session metadata / SHAs in events). **Unblocks:** high-quality O4.

---

## Phase 4 — Five-axis episode scoring (O4)

### Goal

Score each episode with the five-axis rubric; persist prose + scores for drill-down and rollup.

### Data model

#### Table `episode_scores`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `owner_id` | uuid | |
| `episode_id` | uuid | |
| `title` | text | ≤140 chars |
| `facts` | text | |
| `interpretation` | text | |
| `counterweight` | text | |
| `confidence` | real | |
| `scores` | jsonb | sparse axis → number |
| `model` | text | |
| `prompt_version` | text | |
| `input_hash` | text | cache key |
| unique `(owner_id, episode_id, prompt_version)` | | |

Compiled view: `distillates.kind = episode_score` (embed for `search_memory`).

### Work packages

**P4.1 — Episode input builder**  
Faithful block order: header, code volume, intent, first prompts, narratives, user highlights, decisions, plan files, signals, dispatch stats.

**P4.2 — Scorer**  
`session-ops/prompts/episode_scoring.md` + `score-episode.ts`

**P4.3 — Quality gate suite**  
`pnpm quality-gate -- --suite=coding-ops`  
Checks: axis omission, no AI-credit-to-human, provenance present, anti-halo heuristics on fixtures.

### Exit criteria

- [ ] All fixture episodes scored or explicitly skipped with reason.
- [ ] Quality-gate coding-ops suite green.
- [ ] Scores retrievable via MCP.

**Depends on:** O2 required; O3 preferred. **Unblocks:** O5.

---

## Phase 5 — Builder profile + feedback (O5)

### Goal

Roll scores into a versioned coding builder profile and feed it back through MCP + weekly mirror + ask_mirror.

### Data model

#### Table `coding_builder_profiles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `owner_id` | uuid | |
| `version` | int | monotonic per owner |
| `window_start` / `window_end` | timestamptz | |
| `axes` | jsonb | per-axis means |
| `band` | text | approximate label |
| `strengths` | jsonb | insight cards |
| `growth_edges` | jsonb | insight cards |
| `decision_summary` | jsonb | type/law histograms |
| `metrics` | jsonb | plan rate, redirect rate, parallel sessions, … |
| `supersedes_id` | uuid null | |
| `created_at` | timestamptz | |

Compiled: `distillates.kind = coding_builder_profile` (embed).

### Feedback surfaces

| Surface | Behavior |
|---------|----------|
| MCP `get_coding_builder_profile` | Latest versioned profile |
| MCP `list_episode_scores` | Drill-down by window / repo / axis |
| MCP `refresh_coding_builder_profile` | Recompute |
| `get_weekly_mirror` | New section: **How you build with agents** |
| `ask_mirror` | For queries about steering / planning / building with agents, prefer profile + episode_scores in retrieval |
| `compile_ability_model` | May cite episode_scores / growth edges as evidence refs (not replace keyword strengths overnight) |
| Twin pipeline weekly | After open-questions / before portrait: `coding-builder-profile` |

### Insight cards (v1 set)

Computed from session_ops + scores (adapt Paxel card set to Cortex):

- Builder pattern / archetype heuristic  
- Plan-first rate  
- Mid-task redirect rate  
- Prompt style (thinking partner vs terse)  
- Parallel main sessions  
- Top decision laws  
- Strengths (top axes + evidence)  
- Growth edge (lowest evidenced axis or explicit PT thin-prompt pattern)

### Pipeline

Weekly:

```text
… → episodeScore backfill
  → buildCodingBuilderProfile
  → refreshWeeklyMirror (includes coding-ops section)
  → …
```

Nightly: extract + narrative/decisions + light episode link/score for new sessions only.

### Exit criteria

- [ ] `get_coding_builder_profile` returns axes, cards, citations.
- [ ] Weekly mirror includes coding-ops section backed by same profile version.
- [ ] `ask_mirror("how do I steer agents?")` cites profile/episode evidence.
- [ ] Manual review on one real week of sessions: growth edge is specific and actionable.

**Depends on:** O4. **Unblocks:** O6; user-facing utilization.

---

## Phase 6 — Product-thinking bridge + generalization (O6)

### Goal

Address the systematic under-credit of product judgment when upstream user insight never enters the agent transcript; then extend beyond the three coding sources if valuable.

### Why product thinking under-reads

Paxel/Cortex scoring only sees in-session evidence. Upstream user conversations, DocMap research, and “I am the end user” context are invisible unless restated as user/job/behavior/acceptance criteria in prompts, plans, or decisions.

### Work packages

**P6.1 — Product contract bridge**  
- Optional hook / template snippet for coding agents: user, job, behavior change, acceptance test, out of scope.  
- Detector: flag thin feature prompts (`Goal: Add`, no route/schema, no acceptance test) as growth-edge candidates when episode is user-facing.

**P6.2 — Prior product context (careful)**  
When building narratives for sessions tagged DocMap / product topics, optionally attach short Cortex interest/observation snippets labeled **prior product context** (not transcript fact). Cap length; never raise confidence above transcript-grounded evidence.

**P6.3 — Generalize sources**  
Evaluate ChatGPT coding threads, Antigravity, etc., only after O5 acceptance on Cursor/Claude/Codex.

### Exit criteria

- [ ] At least one fixture where product-contract prompt language raises PT vs thin-prompt twin fixture.
- [ ] Growth-edge card for thin product targets fires on fixtures.
- [ ] No confidence inflation from prior context alone.

**Depends on:** O5. **Unblocks:** broader “apply this to almost everything else” program.

---

## Delivery slices (engineering order)

| Slice | Delivers | Phase |
|-------|----------|-------|
| **S1** | Event/steering/signal extract + `list_session_ops` | O1 |
| **S2** | Narratives + decision catalog | O2 |
| **S3** | Git episode linking | O3 |
| **S4** | Five-axis scoring + coding-ops quality-gate | O4 |
| **S5** | Builder profile + weekly mirror + ask_mirror wiring | O5 |
| **S6** | Product-contract bridge + polish + backfill | O6 |

---

## Pipeline placement (summary)

### Nightly (`twin-pipeline` mode=nightly)

```text
distill new sessions (kind=summary)
  → enabled operational source adapters
  → youtube digest
  → embed-backfill
  → seed-entities
  → extract-observations
  → extract-affect
  → session-ops-extract          # NEW (O1)
  → session-ops-narrative/decisions for new sessions  # NEW (O2)
  → episode-link + score new     # NEW (O3–O4)
```

### Weekly

```text
nightly work
  → reflective adapters + interest-map + …
  → coding-builder-profile       # NEW (O5)
  → weekly-mirror (incl. coding-ops section)
  → open-questions / portrait / …
```

---

## Acceptance test (definition of done)

A coding-ops fixture pack (Cursor + Claude + Codex) must satisfy:

1. **Depth** — For ≥10 sessions: events, narrative, decisions, episode link attempt, and scores with citations.  
2. **Rubric fidelity** — Axis omission + anti-halo + no AI-credit-to-human checks pass in quality-gate.  
3. **Insight usefulness** — Profile returns ≥5 cards including strengths + one concrete growth edge with session citations.  
4. **Feedback path** — `get_coding_builder_profile` and weekly mirror section share the same profile version; `ask_mirror` coding-judgment queries cite episode/profile evidence.  
5. **Non-regression** — `kind=summary` search/observations still work; AI-session drowning controls remain.  
6. **Privacy** — Raw transcripts remain vault-only; profile stores redacted excerpts/paths only.  
7. **Manual VIR** — User review of one real week: insights judged accurate + non-obvious + useful.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| LLM cost / latency (two hops × many sessions) | Content-hash cache; skip unchanged; concurrency caps; score only new/changed episodes nightly |
| Sampler starvation of PT/steering | O1 uses fuller grain than summary sampler |
| Git missing in cloud / dead cwd | First-class session_only episodes; never fail the pipeline |
| Conflation with intrapersonal self-model | Separate tables; cite as evidence only |
| Product thinking systematically low | O6 bridge; document measurement mismatch in profile copy |
| Rubric drift from Paxel | Pin prompt_version; keep catalog versioned |

---

## Non-goals (v1)

- Uploading sessions or scores to YC Paxel.  
- Replacing `kind=summary` executive distillates.  
- Ingesting Notion / meeting notes as first-class Paxel inputs (bridge only in O6).  
- Claiming exact YC overall-band parity (server rollup is opaque; label bands approximate).  
- Product UI beyond MCP/CLI (same as current twin posture).

---

## Reference map (external → Cortex)

| Paxel-style stage | Cortex home |
|-------------------|-------------|
| Host discovery (`upload.sh`) | Existing adapters + hooks + collector |
| Condense / events | `session-ops/extract-events.ts` |
| Session narrative | `session-ops/narrative.ts` |
| Decision catalog | `session-ops/decisions.ts` + `decision_catalog.json` |
| Commit groups / episodes | `session-ops/git-episodes.ts` |
| Episode scoring | `session-ops/score-episode.ts` |
| Profile / cards | `session-ops/profile.ts` |
| Results page | MCP `get_coding_builder_profile` + weekly mirror section |

---

## Status

| Slice | Status |
|-------|--------|
| O0 contract (this doc) | Active |
| S1 session-ops extract | Shipped (v1) — `session-ops/extract-events.ts`, distillate `session_ops_digest` |
| S2 narratives + decisions | Shipped (v1) — stub + LLM paths; catalog in `decision_catalog.json` |
| S3 git episodes | Partial — SHA/PR/branch soft-link + session_only; full git log collect TBD |
| S4 five-axis scoring | Shipped (v1) — stub + LLM; `episode_score` distillates |
| S5 builder profile + feedback | Shipped (v1) — `coding_builder_profile`, MCP tools, weekly mirror card, twin-pipeline |
| S6 product-thinking bridge | Partial — thin-prompt detector + growth card; prior-context attach TBD |

**Routing:** coding-ops only processes `cursor` / `claude-code` / `codex`. ChatGPT sessions go to **LLM Work Mirror** ([llm-work-mirror-roadmap.md](llm-work-mirror-roadmap.md)).

**MCP:** `extract_session_ops`, `list_session_ops`, `list_episode_scores`, `get_coding_builder_profile`  
**HTTP:** `POST /v1/twin` `{ "job": "coding-ops" }`  
**Pipeline:** nightly extracts digests/scores; weekly builds profile + mirror coding_ops card.  
**Build-time reminders:** skill **`vibe-law`** under `.cursor/skills/`, `.agents/skills/`, `.claude/skills/` — see [vibe-law.md](vibe-law.md).
