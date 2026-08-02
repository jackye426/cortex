# LLM Work Mirror — Implementation Roadmap

Paxel-method evaluation for how Jack uses LLMs, plus cautious intrapersonal synthesis (work patterns, interests, blindspots). Sibling to coding-ops — same method, different closed loop.

**North star:** Strict Validated Insight Rate — accurate ∧ non-obvious ∧ useful ∧ later supported by behavior/outcome/experiment.

**Related:** [coding-ops-roadmap.md](coding-ops-roadmap.md) · [intrapersonal-roadmap.md](intrapersonal-roadmap.md) · [twin.md](twin.md)

## Product contract

| Field | Value |
|-------|--------|
| User | Jack (Cortex operator / subject) |
| Behavior | Versioned evidence-cited report: LLM usage evaluation + intrapersonal hypotheses + ≤3 experiments |
| Acceptance | 30-day report; ≥6/10 reviewed cards accurate + non-obvious + useful |
| Out of scope | Clinical labels, personality typing, consumer UI, Claude.ai/Gemini ingest, AI-only high-confidence identity |

## Evaluator routing

| Episode | Evaluator |
|---------|-----------|
| `cursor` / `claude-code` / `codex` | coding-ops only |
| `chatgpt-export` / `chatgpt` (when session grain exists) | llm-ops only |
| Ambiguous one-shot trivia | skip / descriptive only |

Never double-score the same episode.

## Axes (1–10, omit when no evidence)

| Axis | Question |
|------|----------|
| `outcome_leverage` | Does effort close useful loops (decision/artifact/outcome)? |
| `problem_framing` | Job / done-when / out-of-scope before long generation? |
| `steering` | Human controls the model (redirect, constrain, kill bad frames)? |
| `epistemic_discipline` | Demand sources, rivals, reject confident mush? |
| `verification` | Checks calibrated to risk/uncertainty? |
| `planning` | Plan/context depth calibrated to complexity? |

## Delivery slices

| Slice | Delivers | Status |
|-------|----------|--------|
| **S0** | Contract, types, fixtures | This branch |
| **S1** | Source routing + actor attribution + commitment fix | This branch |
| **S2** | LLM event/signal extract | This branch |
| **S3** | Context classify + episode rebuild | This branch |
| **S4** | Heuristic/LLM episode scoring | This branch |
| **S5** | `llm_operator_profile` + MCP + pipeline | This branch |
| **S6** | Intrapersonal synthesis → hypotheses | Scaffold / follow-on |
| **S7** | Versioned `llm_work_mirror` report | Partial (profile + mirror card) |
| **S8** | Experiments / longitudinal calibration | Follow-on |

## Distillate kinds

```text
llm_ops_digest
llm_episode_score
llm_operator_profile
llm_work_mirror          # full integrated report (S7)
```

## MCP

- `extract_llm_ops` — run pipeline
- `list_llm_ops_episodes` — digests / episodes
- `list_llm_episode_scores`
- `get_llm_operator_profile`

HTTP: `POST /v1/twin` `{ "job": "llm-ops" }`

## Acceptance criteria (release gates)

### Data and routing
- [ ] Coding and ChatGPT sessions do not share an evaluator
- [ ] Behavioral events record actor + evidence pointer
- [ ] Sampled/stub sessions visibly degraded or skipped
- [ ] Commitments extract from `explicitCommitments`

### Behavioral evaluation
- [ ] Scores cite user-attributed evidence; unsupported axes omitted
- [ ] Context/opportunity shown; no vanity overall headline as primary product
- [ ] Quality fixtures reject assistant-to-user credit and halo scoring

### Intrapersonal (S6+)
- [ ] Full insight-card contract; AI-only identity claims provisional
- [ ] Rejected insights do not silently reappear
- [ ] ≥6/10 reviewed cards useful on a real week

### Longitudinal (S8)
- [ ] Experiments update hypothesis confidence
- [ ] Source-coverage changes ≠ personal change

## Pipeline

Nightly: after coding-ops → `llm-ops` (skip profile)  
Weekly: llm-ops with profile → weekly mirror may include `llm_ops` card
