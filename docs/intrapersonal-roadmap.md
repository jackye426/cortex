# Cortex Intrapersonal Intelligence — Implementation Roadmap

This document is the execution plan to move Cortex from **personal executive twin / vault RAG** to a **trustworthy, evolving intrapersonal intelligence system**.

It is written so implementation can proceed end-to-end without re-scoping. Each phase lists: goal, current baseline, data model, code touchpoints, work packages, MCP/API surface, pipeline changes, tests/eval, exit criteria, and dependencies.

**North-star metric:** Validated Insight Rate — % of surfaced insights the user judges accurate + non-obvious + useful, later supported by behaviour or outcomes.

**Strategic principle:** Earn depth through evidence and correction, not through increasingly confident language.

---

## Current baseline (do not rebuild)

| Layer | Status | Primary paths |
|-------|--------|---------------|
| Ingest vault | Shipped | `apps/api`, `apps/collector`, `packages/adapters/*` |
| Distillates + embeddings | Shipped | `apps/mcp-server/src/distillate.ts`, `project-brief.ts` |
| Hybrid search + lenses | Shipped | `cortex_search_memory`, `store/memory-lenses.ts` |
| `ask_mirror` (ephemeral) | Shipped | `analyst.ts` — claims: `fact` \| `observation` \| `hypothesis` |
| Interest digests | Partial | YouTube / Spotify / Browser; Calibre lens placeholder |
| Decisions/outcomes | Light | MCP `capture_decision` → distillate kinds, no linkage loop |
| Self-model D4 | Light | Overwrites single `self_model` row with prose lists |
| Portrait | Versioned | Append-only via `supersedesId` |
| Twin pipeline | Shipped | nightly / weekly / backfill in `twin-pipeline.ts` |
| Product UI | Absent | MCP + CLI only |

**Architectural rule for this roadmap:** Prefer first-class tables for durable intrapersonal objects (observations, interests, hypotheses, experiments, model versions). Keep distillates as compiled views / search substrate. Do not persist psychology into raw vault rows.

---

## Twin layer map (extend, don’t fork)

Existing Twin path remains D1–D5. Intrapersonal work adds **I0–I6**:

| Layer | Name | Phase |
|-------|------|-------|
| **I0** | Product contract + epistemic types | Phase 0 |
| **I1** | Evidence integrity | Phase 1 |
| **I2** | Interest + affect entities | Phase 2 |
| **I3** | Hypothesis ledger + self-model v2 | Phase 3 |
| **I4** | Outcomes + experiments + calibration | Phase 4 |
| **I5** | Longitudinal intelligence | Phase 5 |
| **I6** | Four product views | Phase 6 |

Implementation order is strictly I0 → I1 → I2/I3 (I2 can start after I1A–I1C) → I4 → I5 → I6. I6 may prototype against I3 data early, but ships only after I3 exit criteria.

---

## Shared design decisions (locked for implementation)

### Epistemic types

Every intrapersonal atom is tagged:

| Type | Meaning | Persistable as fact? |
|------|---------|----------------------|
| `observation` | Behaviour or event Cortex can point to | Yes |
| `self_report` | User-stated belief/desire/identity | Yes (as self-report) |
| `interpretation` | Meaning assigned to observations | No — revisable only |
| `hypothesis` | Testable competing claim | Ledger only |
| `outcome` | Later result of decision/experiment | Yes |

Assistant-generated text without independent support is `assistant_derived` support, never sole basis for high confidence.

### Source families (for balanced retrieval)

```text
ai_sessions | calendar | email | github | drive | media_youtube
media_spotify | browser | reading | decisions | reflections | people_feedback
```

High-confidence insights require ≥3 independent families, or must be labeled `provisional`.

### Insight card contract (all product surfaces)

Every surfaced insight must include:

1. What Cortex noticed  
2. Why it may matter  
3. Evidence from different sources (with dates + types)  
4. Confidence  
5. Contradictory evidence  
6. A competing explanation  
7. A proposed test  
8. Confirm / reject / refine controls  

### Confidence policy

- Start low for assistant-only interpretations.  
- Increase only with independent source diversity + user confirmation + outcome support.  
- Decrease on contradiction, rejection, or failed prediction.  
- Never use confident tone as a substitute for evidence.

### Privilege / safety

Follow `docs/mirror-privilege-plan.md`:

- New intrapersonal tables are `reflective_sensitive` by default.  
- Mirror role gets controlled read/write tools; no bulk export.  
- Broker excerpts are not auto-fed into self-model compilers.  
- Cortex is not clinical, diagnostic, or authoritative about inner life.

---

## Phase 0 — Product contract + epistemic foundation

### Goal

Make the vision enforceable in code and eval before building features on top.

### Work packages

#### P0.1 — Roadmap + twin doc alignment
- Keep this file as source of truth.
- Add I0–I6 matrix pointer in `docs/twin.md`.
- Add Validated Insight Rate definition to `docs/eval-baseline.md`.

#### P0.2 — Shared TypeScript contracts
New package or module: `apps/mcp-server/src/intrapersonal/types.ts` (or `packages/core` if shared with API).

Define:

```typescript
type EpistemicType =
  | "observation"
  | "self_report"
  | "interpretation"
  | "hypothesis"
  | "outcome";

type EvidenceSupportKind =
  | "direct_observation"
  | "self_report"
  | "assistant_derived"
  | "external_feedback"
  | "inferred_proxy";

type SourceFamily =
  | "ai_sessions"
  | "calendar"
  | "email"
  | "github"
  | "drive"
  | "media_youtube"
  | "media_spotify"
  | "browser"
  | "reading"
  | "decisions"
  | "reflections"
  | "people_feedback"
  | "other";

type HypothesisState =
  | "emerging"
  | "supported"
  | "disputed"
  | "retired";

type InterestClass =
  | "terminal"
  | "instrumental"
  | "aspirational"
  | "situational"
  | "dormant";

interface EvidenceRef {
  sourceFamily: SourceFamily;
  evidenceType: EpistemicType;
  supportKind: EvidenceSupportKind;
  distillateId?: string;
  recordId?: string;
  entityId?: string;
  observedAt?: string;
  independenceGroup: string; // usually sourceFamily or account id
  excerpt?: string;
  weight: number; // 0–1 after downranking rules
}
```

#### P0.3 — Persistence policy constants
Document and encode:

- Ephemeral: raw `ask_mirror` answers  
- Promotable: hypotheses, interest candidates, open questions  
- Durable facts: observations, self-reports, outcomes  
- Compiled views: weekly mirror, interest map, self-model version, portrait  

#### P0.4 — Eval scaffolding for insight quality
Extend `apps/mcp-server/src/eval/`:

- `insight-quality.ts` fixtures for: provenance present, circular evidence, missing contradiction, untyped claim, assistant-only high confidence.
- Wire into `quality-gate-cli.ts` as a second suite (`--suite=memory|insight|all`).

### Exit criteria (Checkpoint C0)

- [ ] Shared types compile and are imported by analyst stubs.  
- [ ] Eval suite can fail a fixture for missing provenance / circular evidence.  
- [ ] Twin docs reference I0–I6 and Validated Insight Rate.  
- [ ] Privilege labels decided for new tables (`reflective_sensitive`).

**Depends on:** nothing. **Unblocks:** all later phases.

---

## Phase 1 — Evidence Integrity (I1)

### Goal

Every material claim shows sources, dates, evidence type, and degree of independence. Work conversations cannot drown quieter psychological signal.

### Current gap

- Provenance exists on `raw_artifacts` and as loose `metadata.evidenceRefs` on digests.  
- No `evidence_type`, independence groups, or circular-evidence detector.  
- `ask_mirror` retrieves hybrid hits without per-family quotas.  
- Non-hypothesis claims require citation ids, but not source diversity.

### Data model

Migration: `supabase/migrations/YYYYMMDDHHMMSS_intrapersonal_evidence.sql`

#### Table `observations`

Durable factual atoms extracted from distillates/records (not psychology).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `owner_id` | uuid | |
| `epistemic_type` | text | `observation` \| `self_report` only |
| `statement` | text | Plain factual phrasing |
| `source_family` | text | |
| `independence_group` | text | |
| `occurred_at` | timestamptz | |
| `captured_at` | timestamptz | default now |
| `record_id` | uuid null | fk soft |
| `distillate_id` | uuid null | |
| `session_id` | uuid null | |
| `support_kind` | text | |
| `confidence` | real | |
| `metadata` | jsonb | topics, projects, valence proxies |
| `content_hash` | text | dedupe |

Indexes: `(owner_id, occurred_at desc)`, `(owner_id, source_family)`, unique `(owner_id, content_hash)`.

#### Table `claim_evidence` (join used by hypotheses/insights later)

| Column | Type |
|--------|------|
| `id` | uuid |
| `owner_id` | uuid |
| `claim_id` | uuid | // hypothesis or insight id |
| `claim_kind` | text | `hypothesis` \| `insight` \| `interest` \| `self_model_item` |
| `observation_id` | uuid null |
| `evidence` | jsonb | EvidenceRef snapshot |
| `polarity` | text | `supports` \| `contradicts` |
| `created_at` | timestamptz |

#### RPC / search extension

Add `cortex_search_memory_balanced(...)` or extend `cortex_search_memory` with:

- `p_balance_by_source boolean`  
- `p_per_family_limit int` (default 3)  
- `p_exclude_assistant_derived boolean`

Application-layer balancer is acceptable for v1 if SQL is hard; put balancer in `apps/mcp-server/src/intrapersonal/balanced-retrieve.ts` and keep SQL filters as-is.

### Work packages

#### P1.1 — Source coverage audit tool
**File:** `apps/mcp-server/src/intrapersonal/source-health.ts`  
**MCP:** `audit_source_coverage`  
**HTTP:** `POST /v1/audit/source-coverage`

Report per source / family:

- last ingest time  
- record count (7/30/90d)  
- distillate coverage %  
- embed coverage %  
- reflective vs operational volume ratio  
- drowning risk score (AI sessions share of top-k for reflective queries)

#### P1.2 — Observation extractor
**File:** `apps/mcp-server/src/intrapersonal/extract-observations.ts`

From session summaries + interest digests + decision captures:

- Emit factual observations only (no motives/traits).  
- Preserve evidence refs + timestamps.  
- Deduplicate via `content_hash`.  
- Run in nightly pipeline after distill/adapters.

#### P1.3 — Balanced retrieval
**File:** `apps/mcp-server/src/intrapersonal/balanced-retrieve.ts`

Algorithm:

1. Run existing `search_memory` with larger candidate pool (e.g. 40).  
2. Bucket by `sourceFamily(hit)`.  
3. Take top `perFamily` from each non-empty bucket.  
4. Fill remainder by global score.  
5. Annotate each hit with `sourceFamily`, `independenceGroup`, `supportKind`.

Wire into `ask_mirror` before analyst synthesis.

#### P1.4 — Circular evidence detector
**File:** `apps/mcp-server/src/intrapersonal/circular-evidence.ts`

Detect when a candidate claim’s support is primarily:

- prior `portrait` / `self_model` text  
- prior assistant messages restating the same claim  
- identical phrasing across derived distillates with no underlying records  

Mark support `assistant_derived` and cap confidence ≤ 0.4 unless independent observations exist.

#### P1.5 — Analyst hardening
Update `analyst.ts`:

- Expand claim types to align with epistemic types (keep back-compat: map `fact` → observation/self_report).  
- Require provenance objects, not just id strings.  
- Reject/repair high-confidence hypotheses with <2 independent families.  
- Always ask model for `contradictions[]` and `alternativeExplanations[]` (already partly present).  
- Persist nothing yet; return richer ephemeral payload.

#### P1.6 — Provenance coverage metric
Add to quality gate:

- % of material claims with ≥1 non-assistant evidence ref  
- % of high-confidence claims with ≥3 families  
- Fail gate if provenance coverage < 100% on fixture suite

### Pipeline changes

Nightly append:

```text
… → embed-backfill → seed-entities → extract-observations → source-health snapshot
```

### MCP / API surface

| Tool | Purpose |
|------|---------|
| `audit_source_coverage` | Ingestion/distill health |
| `list_observations` | Filter by family/date/topic |
| `search_memory` | Optional `balanceBySource` (default true for reflective/both) |

### Tests

- Unit: balancer distributes across families.  
- Unit: circular detector flags portrait-only support.  
- Fixture quality-gate insight suite.  
- Integration: observation extract dry-run on fixture store.

### Exit criteria (Checkpoint C1)

- [ ] `audit_source_coverage` returns all configured sources.  
- [ ] Reflective `ask_mirror` uses balanced retrieval by default.  
- [ ] Insight eval: 100% provenance on material fixture claims.  
- [ ] Circular / assistant-only high-confidence claims fail the gate.  
- [ ] Observations table populated by nightly job (or dry-run verified).  
- [ ] Docs updated: evidence rules in `memory-substrate.md`.

**Depends on:** C0. **Unblocks:** Phase 2 & 3.

---

## Phase 2 — Interest And Affect (I2)

### Goal

First-class interest entities with classification; energy/affect proxies; Interest Map as a compiled view.

### Current gap

- Weekly interest digests exist but are blobs.  
- Topics seeded as generic `entities.entity_type=topic`.  
- No terminal/instrumental/aspirational/situational/dormant classes.  
- No energy/voluntary-return model.  
- `reading_interest_digest` lens reserved, compiler missing.

### Data model

Migration: `..._intrapersonal_interests.sql`

#### Table `interests`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | |
| `owner_id` | uuid | |
| `canonical_key` | text | slug |
| `display_name` | text | |
| `class` | text | InterestClass |
| `status` | text | `active` \| `dormant` \| `retired` |
| `confidence` | real | |
| `summary` | text | |
| `first_seen_at` | timestamptz | |
| `last_active_at` | timestamptz | |
| `recurrence_score` | real | |
| `specificity_score` | real | increasing detail over time |
| `voluntary_return_score` | real | |
| `persistence_after_utility` | real | |
| `energy_delta` | real null | -1..1 proxy |
| `metadata` | jsonb | |
| unique `(owner_id, canonical_key)` | | |

#### Table `interest_evidence`

Same shape as `claim_evidence` specialized, or reuse `claim_evidence` with `claim_kind='interest'`.

#### Table `affect_signals` (lightweight)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | |
| `owner_id` | uuid | |
| `signal_type` | text | `energy` \| `valence` \| `friction` \| `flow` |
| `value` | real | normalized |
| `source_family` | text | |
| `observation_id` | uuid null | |
| `context` | jsonb | activity, project, interest keys |
| `occurred_at` | timestamptz | |
| `capture_mode` | text | `inferred` \| `self_report` |

### Classification rules (implement as scored heuristics + LLM assist)

An interest candidate scores for:

| Signal | Supports |
|--------|----------|
| Recurrence across unrelated contexts | terminal / enduring |
| Voluntary return without external deadline | terminal |
| Increasing specificity of questions/media | terminal / aspirational |
| Tied to identity language (“I want to become…”) | aspirational |
| Appears only inside one project window | situational / instrumental |
| Strong historically, quiet ≥ N weeks | dormant |
| Utility disappears but pursuit continues | terminal (strong) |
| Pursuit ends when project ends | instrumental / situational |

LLM may propose class; final write stores scores + rationale evidence.

### Work packages

#### P2.1 — Interest candidate mining
**File:** `apps/mcp-server/src/intrapersonal/interest-mine.ts`

Inputs:

- `youtube_interest_digest`, `spotify_interest_digest`, `browser_interest_digest`  
- session summary topics + explorationSignals  
- Drive/GitHub pursuit topics (instrumental bias)  
- Calibre/reading once compiler exists  

Output: upsert `interests` + evidence links.

#### P2.2 — Reading interest compiler
Implement `reading_interest_digest` in `source-adapters.ts` (Calibre ebooks + progress if available). Enable in weekly adapters.

#### P2.3 — Affect proxy extraction
From existing session metadata:

- `frictionSignals` → negative energy/friction  
- `explorationSignals` / voluntary deep dives → positive engagement  
- calendar overload weeks → drain proxy  
- media binge after work friction → recovery proxy (low confidence)

Optional MCP: `log_reflection` for explicit energy/valence self-reports.

#### P2.4 — Interest Map compiler
**File:** `apps/mcp-server/src/intrapersonal/interest-map.ts`  
Writes distillate `kind=interest_map` (versioned like portrait: append subject versions) **and** updates `interests` rows.

Payload sections: terminal, instrumental, aspirational, situational, dormant — each with evidence summaries.

#### P2.5 — Entity graph bridge
Link `interests` ↔ `entities` (topic/project) via `entity_links` or `interest_links` so operational twin tools can still navigate.

### Pipeline

Weekly append:

```text
… → browser/spotify/reading adapters → interest-mine → interest-map → …
```

Nightly: light interest touch from new session observations (recurrence counters only).

### MCP / API

| Tool | Purpose |
|------|---------|
| `list_interests` | Filter by class/status |
| `upsert_interest` | Manual refine |
| `get_interest_map` | Latest compiled map |
| `log_reflection` | Optional affect/self-report capture |
| `refresh_interest_map` | Job trigger |

### Tests

- Classification fixtures: situational vs terminal.  
- Dormant detection after inactivity.  
- Interest map includes multi-source evidence.  
- Quality-gate questions: “What interests recur outside work projects?”

### Exit criteria (Checkpoint C2)

- [ ] `interests` populated from ≥3 media/AI families.  
- [ ] Classes assigned with stored rationale scores.  
- [ ] `get_interest_map` returns structured grouped interests.  
- [ ] Reading digest implemented or explicitly deferred with issue + lens note.  
- [ ] At least one interest demonstrates project-independent recurrence in fixtures.  
- [ ] Reflective search can filter/boost interest entities.

**Depends on:** C1 (observations + balanced retrieval). **Unblocks:** richer Weekly Mirror + Self-Model.

---

## Phase 3 — Intrapersonal Hypotheses + Self-Model v2 (I3)

### Goal

Replace overwrite-style D4 prose with a ledger of competing, falsifiable claims and a versioned structured self-model.

### Current gap

- `refreshSelfModel` overwrites one row with `hypotheses/failureModes/leverageBets` strings.  
- Portrait versions exist but are essay snapshots.  
- `ask_mirror` hypotheses are ephemeral.  
- No confirm/reject/refine.  
- No rival explanations as durable objects.

### Data model

Migration: `..._intrapersonal_hypotheses_self_model.sql`

#### Table `hypotheses`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | |
| `owner_id` | uuid | |
| `claim` | text | |
| `why_it_matters` | text | |
| `state` | text | HypothesisState |
| `confidence` | real | |
| `source_diversity` | int | distinct families |
| `falsifiers` | jsonb | string[] |
| `alternative_explanations` | jsonb | string[] |
| `domains` | text[] | energy, attention, motive, strength, … |
| `last_tested_at` | timestamptz null | |
| `origin` | text | `ask_mirror` \| `weekly_job` \| `user` \| `interest_mine` |
| `assistant_weight` | real | downrank factor |
| `metadata` | jsonb | |
| `created_at` / `updated_at` | timestamptz | |

Evidence via `claim_evidence`.

#### Table `intrapersonal_records`

First-class typed self-model atoms:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | |
| `owner_id` | uuid | |
| `record_kind` | text | see enum below |
| `title` | text | |
| `statement` | text | |
| `epistemic_type` | text | interpretation/hypothesis/self_report… |
| `confidence` | real | |
| `status` | text | `active` \| `disputed` \| `retired` |
| `context` | jsonb | environments, time ranges |
| `behaviour` | jsonb | observed behaviours |
| `outcome` | jsonb | linked outcomes |
| `origin` | text | `self_report` \| `inference` |
| `hypothesis_id` | uuid null | |
| `interest_id` | uuid null | |
| `metadata` | jsonb | |

`record_kind` enum:

```text
interest_ref | value | energy_pattern | strength | limitation | motive
avoidance_pattern | emotional_trigger | relationship_pattern
identity_aspiration | decision_tendency | coping_strategy
recurring_conflict | conviction_change | environment_condition
```

#### Table `self_model_versions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | |
| `owner_id` | uuid | |
| `version` | int | monotonic |
| `summary` | text | concise portrait prose |
| `compiled_from` | jsonb | hypothesis ids, record ids, interest ids |
| `strengths` | jsonb | structured items + evidence |
| `limitations` | jsonb | |
| `motives` | jsonb | |
| `tensions` | jsonb | |
| `identity_development` | jsonb | |
| `open_question_ids` | uuid[] | |
| `supersedes_id` | uuid null | |
| `user_corrections` | jsonb | applied since prior version |
| `created_at` | timestamptz | |

Keep writing distillate `kind=self_model` as **search projection** of latest version (content = summary + key bullets), but source of truth is `self_model_versions`. Portrait compiler should read structured version, not invent from scratch.

### Work packages

#### P3.1 — Hypothesis ledger CRUD
**Files:** `intrapersonal/hypotheses.ts`, store methods, migration.

MCP:

- `list_hypotheses` (state, domain, minConfidence)  
- `get_hypothesis`  
- `propose_hypothesis` (from agent/user)  
- `promote_mirror_claims` (take ask_mirror hypothesis claims → ledger at low confidence)  
- `confirm_hypothesis` / `reject_hypothesis` / `refine_hypothesis`

Reject → `state=retired` or `disputed` + correction note. Refine → new claim text + link prior id in metadata.

#### P3.2 — Rival + contradiction attachment
When promoting/creating:

- Require ≥1 alternative explanation (generate if missing).  
- Pull contradicting observations via balanced search on claim negation / rival.  
- Store both polarities in `claim_evidence`.

#### P3.3 — Strength / limitation compiler
**File:** `intrapersonal/ability-model.ts`

Strength evidence weights:

- repeated successful behaviour  
- measurable improvement  
- external feedback  
- shipped outcomes (`github_outcome_digest`, decision outcomes)  
- cross-context performance  
- retention after novelty fades  

Limitation inference:

- repeated friction  
- corrections  
- avoidance  
- failed predictions  
- poor outcomes  

Never infer limitation from absence alone.

#### P3.4 — Self-model compiler v2
Replace body of `refreshSelfModel`:

1. Gather active hypotheses, intrapersonal_records, interests, recent outcomes.  
2. Compile structured `self_model_versions` row (version++).  
3. Upsert search distillate `self_model` projection.  
4. Optionally trigger portrait from structured fields (`portrait-v2`).

#### P3.5 — ask_mirror promotion path
After `ask_mirror`, return `promotableClaimIds`. Tool `promote_mirror_claims` writes ledger entries with `origin=ask_mirror`, `assistant_weight` high (downrank), confidence capped.

Weekly job may auto-promote only if:

- ≥2 independent families, and  
- contradiction slot filled, and  
- not circular  

Still `state=emerging`.

#### P3.6 — User correction incorporation
Corrections stored on hypothesis/record and copied into next `self_model_versions.user_corrections`. Compiler must not reassert rejected claims without new independent evidence (and then only as `disputed`/`emerging` with note).

### Pipeline

Weekly:

```text
… → priority_vs_actual → hypothesis-promote/refresh → ability-model
  → refresh_self_model_v2 → portrait-v2
```

### MCP / API

| Tool | Purpose |
|------|---------|
| `list_hypotheses` / `get_hypothesis` | Ledger read |
| `propose_hypothesis` | Manual/agent add |
| `promote_mirror_claims` | Ephemeral → durable |
| `confirm_hypothesis` | User support |
| `reject_hypothesis` | Retire/dispute |
| `refine_hypothesis` | Correct claim |
| `list_intrapersonal_records` | Typed atoms |
| `refresh_self_model` | Compiles v2 versions |
| `get_self_model` | Latest structured version |
| `list_self_model_versions` | History |

### Tests

- Promote → list → reject → next self-model omits claim.  
- Assistant-only claim cannot reach `supported` without new evidence.  
- Strength not created from single anecdote.  
- Portrait-v2 cites structured ids.

### Exit criteria (Checkpoint C3)

- [ ] Hypotheses are durable with state machine.  
- [ ] Every substantial hypothesis has contradiction + alternative stored (or explicit `none_found` with low confidence).  
- [ ] Confirm/reject/refine tools work and affect next model version.  
- [ ] `self_model` overwrite prose path replaced by versioned compiler (legacy field kept as projection).  
- [ ] Validated Insight Rate denominator starts counting surfaced ledger insights with user verdicts.  
- [ ] Eval covers rejection persistence.

**Depends on:** C1; uses interests from C2 when available (graceful if empty). **Unblocks:** Phase 4 & 6.

---

## Phase 4 — Outcomes And Learning (I4)

### Goal

Close the loop: insight → test → outcome → updated confidence/self-model.

### Current gap

- `capture_decision` stores isolated notes.  
- No expected vs actual outcome schema.  
- No experiment objects.  
- No calibration against later evidence.  
- No cycle detection.

### Data model

Migration: `..._intrapersonal_outcomes_experiments.sql`

#### Extend decisions (new table preferred)

`decisions`

| Column | Type |
|--------|------|
| `id` | uuid |
| `owner_id` | uuid |
| `title` | text |
| `statement` | text |
| `decided_at` | timestamptz |
| `expected_outcome` | text |
| `related_hypothesis_ids` | uuid[] |
| `related_entity_keys` | text[] |
| `source` | text | `user` \| `mined` \| `migrated_distillate` |
| `distillate_id` | uuid null | back-compat |
| `metadata` | jsonb |

`decision_outcomes`

| Column | Type |
|--------|------|
| `id` | uuid |
| `decision_id` | uuid |
| `recorded_at` | timestamptz |
| `actual_outcome` | text |
| `aligned_with_expected` | boolean null |
| `evidence` | jsonb | EvidenceRef[] |
| `learning` | text null |

#### Table `experiments`

| Column | Type |
|--------|------|
| `id` | uuid |
| `owner_id` | uuid |
| `hypothesis_id` | uuid |
| `title` | text |
| `protocol` | text | what to do/observe |
| `status` | text | `proposed` \| `active` \| `completed` \| `abandoned` |
| `proposed_at` | timestamptz |
| `due_at` | timestamptz null |
| `completed_at` | timestamptz null |
| `result_summary` | text null |
| `result_polarity` | text null | `supports` \| `contradicts` \| `inconclusive` |
| `evidence` | jsonb | |
| `metadata` | jsonb |

### Work packages

#### P4.1 — Decision/outcome upgrade
Migrate MCP `capture_decision` to write `decisions` (+ optional distillate projection for search).  
Add `capture_outcome` linking `decision_id`.  
Backfill from existing `kind=decision|outcome` distillates where possible.

#### P4.2 — Experiment designer
**File:** `intrapersonal/experiments.ts`

For each major insight/hypothesis, generate a test from templates:

- Track energy before/after N activities.  
- Make a real decision among competing motives; record choice.  
- Ship a deliberately simple version.  
- Spend time on interest with no commercial purpose.  
- Ask collaborators for examples of a claimed strength.  
- State a desire without justification; observe behaviour.

MCP: `propose_experiment`, `list_experiments`, `complete_experiment`.

#### P4.3 — Follow-up scheduler
Weekly job: list `active` experiments past `due_at` → surface in Open Questions / Weekly Mirror as “report results”.  
MCP: `request_experiment_results` (returns due prompts).

#### P4.4 — Confidence calibration
**File:** `intrapersonal/calibration.ts`

On experiment/outcome completion:

- Update hypothesis confidence + state.  
- Record prediction event `{claim_id, predicted, actual, ts}`.  
- Maintain rolling accuracy by claim domain.  
- Downrank chronically wrong generators (e.g. assistant-only motives).

#### P4.5 — Cycle detection
**File:** `intrapersonal/cycles.ts`

Detect repeating patterns across ≥3 instances:

- avoidance loops  
- decision oscillations (status vs autonomy etc.)  
- start-strong / fade interest cycles  

Emit hypotheses with evidence spans, not just labels.

### Pipeline

Weekly:

```text
… → request due experiments → calibrate from new outcomes → cycle detect → self-model refresh
```

### MCP / API

| Tool | Purpose |
|------|---------|
| `capture_decision` | v2 fields |
| `capture_outcome` | Link actual result |
| `propose_experiment` | Attach test to hypothesis |
| `complete_experiment` | Record result + calibrate |
| `list_experiments` | Filter status |
| `request_experiment_results` | Due prompts |
| `get_calibration_stats` | Accuracy by domain |

### Tests

- Completing experiment that contradicts → hypothesis `disputed`/`retired` + confidence drop.  
- Decision without outcome stays visible as open loop.  
- Cycle detector fixture with synthetic repeating avoidance.  
- Metric: % decisions with outcomes.

### Exit criteria (Checkpoint C4)

- [ ] Decisions have expected + actual outcome fields.  
- [ ] Experiments attach to hypotheses and update ledger on completion.  
- [ ] Calibration stats exposed.  
- [ ] At least one automated cycle detector path with fixtures.  
- [ ] Self-model refresh consumes new outcomes/experiments.  
- [ ] Validated Insight Rate numerator can include “later supported by outcome”.

**Depends on:** C3. **Unblocks:** Phase 5 predictive claims; improves Phase 6 Open Questions.

---

## Phase 5 — Longitudinal Intelligence (I5)

### Goal

Answer “How have I changed?” with evidenced diffs, not impressionistic prose.

### Current gap

- Portrait has `supersedesId` chain but no structured diff.  
- Self-model overwrite destroys history (fixed in I3).  
- No emerging/fading detectors beyond interest dormancy (I2).

### Data model

Migration: `..._intrapersonal_longitudinal.sql`

#### Table `self_model_diffs` (materialized on version write)

| Column | Type |
|--------|------|
| `id` | uuid |
| `owner_id` | uuid |
| `from_version_id` | uuid |
| `to_version_id` | uuid |
| `stable` | jsonb | |
| `emerging` | jsonb | |
| `fading` | jsonb | |
| `environment_shifts` | jsonb | |
| `confirmed_predictions` | jsonb | |
| `disproved_predictions` | jsonb | |
| `event_anchors` | jsonb | linked decisions/outcomes/timeboxes |
| `created_at` | timestamptz |

### Work packages

#### P5.1 — Version diff compiler
On each `self_model_versions` insert, compute diff vs previous:

- Interests: class/status changes  
- Hypotheses: state transitions  
- Strengths/limitations: added/removed/confidence deltas  
- Motives/tensions: churn  

#### P5.2 — Change explanation job
**File:** `intrapersonal/change-explain.ts`

Input: time range.  
Output: structured report + distillate `kind=change_report`:

- What changed  
- Evidence  
- Candidate triggers (events, environment)  
- What stayed stable  
- Predictions confirmed/disproved  

#### P5.3 — Emerging / fading detectors
Reuse interest recurrence + hypothesis age + evidence velocity:

- Emerging: rising recurrence/specificity in window  
- Fading: declining activity + optional explicit disengagement  
- Stable: consistent across ≥2 environments / ≥ N weeks  

#### P5.4 — Longitudinal MCP queries
Tools:

- `diff_self_model` (`from`, `to` or relative `since`)  
- `how_have_i_changed` (compiled answer with citations)  
- `list_prediction_results`

#### P5.5 — Portrait as longitudinal view
Portrait-v2 includes “since last portrait” delta section sourced from `self_model_diffs`, not free invention.

### Pipeline

Weekly after self-model:

```text
refresh_self_model_v2 → compile_diff → change_report(optional rolling) → portrait-v2
```

### Tests

- Synthetic two-version fixture yields emerging/fading lists.  
- `how_have_i_changed` refuses unsupported narrative (gaps + low confidence).  
- Prediction confirm/disprove appears in diff.

### Exit criteria (Checkpoint C5)

- [ ] ≥2 self-model versions can be diffed structurally.  
- [ ] Change report cites evidence ids.  
- [ ] Emerging/fading interests visible without re-asking LLM to “summarize growth”.  
- [ ] Longitudinal questions added to eval suite and pass fixtures.  
- [ ] Prediction accuracy trend queryable.

**Depends on:** C3 + C4 (predictions/outcomes). **Unblocks:** mature Self-Model / Open Questions.

---

## Phase 6 — Initial product experience (I6)

### Goal

Ship the four views as stable product surfaces over structured data. MCP-first, thin UI second.

### Views

#### 6A. Weekly Mirror
Five evidence-backed observations covering:

1. Energy  
2. Attention  
3. Avoidance  
4. Decisions  
5. Emerging interests  

**Compiler:** `apps/mcp-server/src/intrapersonal/weekly-mirror.ts`  
**Distillate kind:** `weekly_mirror` (one per ISO week, upsert)  
**Selection rules:**

- Pull from observations + emerging hypotheses + due experiments + interest deltas.  
- Enforce insight card contract.  
- Max one item per theme.  
- Prefer cross-source; ban circular-only items.  
- Rank by expected personal value × novelty × evidence quality.

#### 6B. Interest Map
Read model over `interests` + latest `interest_map` distillate.  
UI/MCP must show class toggles and evidence drawers.

#### 6C. Self-Model
Read latest `self_model_versions` (+ diff vs previous).  
Controls: confirm/reject/refine on each tension/strength/limitation item (writes through hypothesis/record tools).

#### 6D. Open Questions
Rank unresolved hypotheses + missing evidence slots + due experiments by:

```text
score = personal_value_prior * uncertainty * testability * source_gap_bonus
```

### Work packages

#### P6.1 — Insight card serializer
Shared renderer from hypothesis/observation bundles → card DTO used by all views.

#### P6.2 — View compilers + MCP getters

| Tool | Backing |
|------|---------|
| `get_weekly_mirror` | weekly_mirror distillate + live card hydrate |
| `get_interest_map` | from Phase 2 |
| `get_self_model` | from Phase 3 |
| `list_open_questions` | ranked hypotheses/experiments |

#### P6.3 — Interaction controls
Unify:

- `confirm_insight` / `reject_insight` / `refine_insight`  
(thin wrappers over hypothesis/record feedback; analytics for Validated Insight Rate)

#### P6.4 — Minimal UI (optional in same phase if MCP stable)
If implementing UI in-repo:

- Small web app or routes under a new `apps/mirror-web` (React/Next only if team wants; otherwise markdown/CLI render is enough for v1).  
- Pages: `/mirror`, `/interests`, `/self`, `/questions`.  
- No dashboard clutter: one job per page; insight cards as interaction containers.  
- Follow frontend design rules only if building visual UI; MCP-first delivery can ship without UI.

**Recommendation for one-go implementation:** ship MCP tools + `openai-mirror` friendly prompts + CLI pretty-print first; add web UI as a trailing work package (P6.4) after card DTO stabilizes.

#### P6.5 — Metrics dashboard (CLI)
`pnpm intrapersonal-metrics`:

- Validated Insight Rate (7/30/90d)  
- Provenance coverage  
- % high-confidence with ≥3 families  
- % hypotheses with contradictions  
- Correction incorporation lag (reject → next model version)  
- % decisions with outcomes  
- Hypothesis retirement rate  
- Source-family balance of weekly mirror items  

### Pipeline

Weekly culmination:

```text
nightly chain
  → interest-map
  → hypothesis refresh
  → self-model v2 + diff
  → weekly-mirror
  → open-questions snapshot
  → portrait-v2
  → metrics snapshot
```

### Tests

- Weekly mirror always returns ≤5 cards, each with full contract.  
- Rejected insight does not reappear next week without new evidence.  
- Open questions ranking prefers testable high-value gaps.  
- End-to-end fixture: observations → hypothesis → experiment → outcome → model diff → mirror.

### Exit criteria (Checkpoint C6)

- [ ] Four views available via MCP (UI optional).  
- [ ] Every mirror item satisfies insight card contract.  
- [ ] Confirm/reject/refine path instrumented for Validated Insight Rate.  
- [ ] Metrics command reports north-star + supporting measures.  
- [ ] Full-story eval path passes fixture suite (`memory` + `insight` + `loop`).  
- [ ] Docs playbook: how agents should use the four views (`docs/mcp.md`).

**Depends on:** C1–C3 minimum; C4–C5 for full loop quality. Soft-launch allowed after C3 with degraded experiment/longitudinal sections labeled incomplete.

---

## Checkpoints (release gates)

Use these as merge/release gates. Do not advance the next phase’s “durable write” work until the prior checkpoint passes — scaffolding types may land earlier.

### C0 — Contract ready
| Gate | Measure |
|------|---------|
| Types | Epistemic + EvidenceRef types merged |
| Eval | Insight fixture suite runnable |
| Docs | Roadmap + twin pointer live |
| Safety | reflective_sensitive labeling agreed |

### C1 — Evidence integrity
| Gate | Measure |
|------|---------|
| Provenance | 100% material claims in fixtures |
| Balance | Reflective retrieval returns ≥3 families when available |
| Circularity | Assistant-only high-confidence fails gate |
| Health | `audit_source_coverage` operational |
| Observations | Nightly extract writes deduped rows |

### C2 — Interest intelligence
| Gate | Measure |
|------|---------|
| Entities | Interests table non-empty across sources |
| Classes | ≥1 fixture each for terminal/situational/dormant |
| Map | `get_interest_map` structured response |
| Independence | Project-independent recurrence detected in fixture |

### C3 — Hypotheses + self-model
| Gate | Measure |
|------|---------|
| Ledger | CRUD + state machine |
| Contradictions | Required on substantial hypotheses |
| Corrections | Reject persists into next version |
| Versioning | `self_model_versions` append-only |
| VIR skeleton | User verdicts recorded |

### C4 — Learning loop
| Gate | Measure |
|------|---------|
| Outcomes | Decision expected/actual link works |
| Experiments | Complete → hypothesis update |
| Calibration | Stats endpoint non-zero on fixtures |
| Cycles | Detector fixture passes |

### C5 — Longitudinal
| Gate | Measure |
|------|---------|
| Diffs | Structured diff between versions |
| Change Q | `how_have_i_changed` cited answer |
| Predictions | Confirm/disprove visible in diff |

### C6 — Product surfaces
| Gate | Measure |
|------|---------|
| Four views | MCP getters complete |
| Card contract | 100% weekly mirror items compliant |
| Metrics | North-star + supporting metrics command |
| E2E | Fixture loop green |

---

## Suggested implementation trains (parallelism)

For a single push toward the goal, organize engineering as trains with a critical path:

```text
Critical path:
  P0 → P1.1–P1.5 → P3.1–P3.4 → P6.1–P6.3 → P4.2–P4.4 → P5 → P6.5

Parallel after C1:
  Train Interest: P2.*
  Train Analyst: remaining ask_mirror provenance UX
  Train Reading adapter: P2.2

Parallel after C3:
  Train Loop: P4.*
  Train Views: P6.1–P6.3 (degraded mode OK)
  Train UI: P6.4 (optional)

After C4:
  Train Longitudinal: P5.*
  Train Metrics polish: P6.5
```

### One-go milestone packaging (delivery slices)

If implementing continuously in one program, merge in this slice order:

| Slice | Delivers | Checkpoint |
|-------|----------|------------|
| S0 | Types, eval fixtures, docs pointers | C0 |
| S1 | Observations, balanced retrieve, circular detector, source audit | C1 |
| S2 | Interests + affect proxies + interest map | C2 |
| S3 | Hypothesis ledger, feedback tools, self-model versions | C3 |
| S4 | Weekly mirror + open questions + insight cards (MCP) | C6 partial |
| S5 | Decisions/experiments/calibration/cycles | C4 |
| S6 | Diffs + change reports + longitudinal tools | C5 |
| S7 | Metrics + portrait-v2 + optional web UI + playbook | C6 full |

S4 before S5 is intentional: product learning starts once ledger insights are reviewable; experiments deepen trust afterward.

---

## Concrete file / module map (target)

```text
apps/mcp-server/src/intrapersonal/
  types.ts
  source-health.ts
  extract-observations.ts
  balanced-retrieve.ts
  circular-evidence.ts
  interest-mine.ts
  interest-map.ts
  affect.ts
  hypotheses.ts
  ability-model.ts
  self-model-v2.ts
  experiments.ts
  calibration.ts
  cycles.ts
  change-explain.ts
  weekly-mirror.ts
  open-questions.ts
  insight-card.ts
  metrics.ts

supabase/migrations/
  *_intrapersonal_evidence.sql
  *_intrapersonal_interests.sql
  *_intrapersonal_hypotheses_self_model.sql
  *_intrapersonal_outcomes_experiments.sql
  *_intrapersonal_longitudinal.sql
  *_intrapersonal_mirror_grants.sql

apps/mcp-server/src/
  analyst.ts              # provenance-rich claims
  twin-pipeline.ts        # wire new jobs
  tools.ts                # MCP registration
  store/supabase-store.ts # new CRUD
  store/memory-lenses.ts  # new kinds
  eval/insight-quality.ts
  eval/baseline.ts        # longitudinal + interest Qs

docs/
  intrapersonal-roadmap.md  # this file
  twin.md                   # I-layer pointer
  mcp.md                    # four-view playbook
  eval-baseline.md          # VIR + insight suite
  memory-substrate.md       # evidence rules v2
```

### New distillate kinds

```text
interest_map
weekly_mirror
open_questions_snapshot
change_report
self_model          # projection of latest version (existing kind, new compiler)
portrait            # v2 compiler inputs
reading_interest_digest
```

Add reflective kinds to `memory-lenses.ts` accordingly.

---

## Metrics instrumentation (from S1 onward)

Emit audit_log or metrics rows for:

| Event | Fields |
|-------|--------|
| `insight_surfaced` | id, view, confidence, family_count |
| `insight_verdict` | id, verdict=`confirm|reject|refine`, note |
| `hypothesis_state_change` | id, from, to, reason |
| `experiment_completed` | id, polarity |
| `model_version_written` | version, correction_count |
| `retrieval_balance` | query, family_histogram |

Validated Insight Rate:

```text
VIR = count(verdict=confirm AND (non_obvious_flag OR user_marked_useful)
            AND (later_outcome_support OR confirm_only_for_interim))
      / count(insights_surfaced_in_window)
```

Interim VIR (before C4) may use confirm∧useful∧non_obvious only; full VIR requires outcome/behaviour support field.

---

## Product boundaries (non-goals for this program)

- Clinical diagnosis or therapy replacement  
- Static Big-Five style personality report as the product  
- Productivity surveillance dashboard as primary UX  
- Embedding entire raw email/transcript corpus  
- Treating assistant opinions as permanent facts  
- Multi-tenant consumer auth (remain single-owner vault)  
- Replacing MCP twin with Obsidian or a second memory system  

---

## Acceptance demo script (end state)

1. Run source coverage audit — show balanced families.  
2. Open Weekly Mirror — five cards, each with multi-source evidence + rival + test.  
3. Reject one card — refresh self-model — claim gone or disputed.  
4. Open Interest Map — terminal vs instrumental vs dormant with citations.  
5. Promote an `ask_mirror` hypothesis — see ledger entry at low confidence.  
6. Complete a linked experiment that contradicts — confidence drops; state `disputed`.  
7. Ask `how_have_i_changed` over 90 days — structured diff with evidence.  
8. Run `pnpm intrapersonal-metrics` — VIR + provenance + contradiction coverage visible.

When this demo is green, Cortex has completed the shift from “here is what your history says about you” to “here is a pattern, the evidence for and against it, and how we can discover whether it is true.”

---

## Implementation status

| Slice | Status |
|-------|--------|
| **S0** | Types, insight-quality fixtures, docs pointers — in progress on this branch |
| **S1** | Observations migration, balanced retrieve, circular policy, source audit, nightly extract — in progress on this branch |
| S2–S7 | Not started |

### Immediate next implementation action

After S0+S1 merge and C1 gates green, continue **S2** (interest entities + Interest Map).
