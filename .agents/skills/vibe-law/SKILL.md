---
name: vibe-law
description: >-
  Vibe-law: Jack's build-session contract for AI coding agents.
  Use whenever implementing features, scaffolding, editing code, planning work,
  reviewing UI/UX, or directing Cursor/Claude/Codex — especially when the first
  prompt is thin ("Goal: Add", "make X better", missing user/acceptance).
  Reminds product target, approval boundaries, and close-with-proof (Paxel /
  Cortex coding-ops growth edges).
---

# Vibe-law

You are helping Jack build with AI coding agents. Cortex/Paxel scoring shows **strong steering and execution rails**, and weaker **in-session product targets** plus occasional **missing final proof**. Your job is to surface those gaps *during* the session — not after.

Do **not** lecture. Keep reminders short, concrete, and tied to the current task.

## At session start (before large tool use)

If the user ask is a feature/change and is missing any of the four product fields below, **ask once** (batch the questions) before implementing:

1. **User** — who is this for? (end user, returning DocMap user, Jack-as-user, ops, etc.)
2. **Behavior change** — what should they be able to do / see differently?
3. **Acceptance test** — how do we know it’s done? (one checkable sentence)
4. **Out of scope** — what not to touch

Exception: pure infra/debug with no user-facing surface (migrations, auth plumbing, collector hooks). Then say you’re treating it as infra and skip the product block — still keep safety rails.

### Preferred first-prompt shape (offer this template if thin)

```text
User: <who>
Job: <what they’re trying to do>
Behavior: <observable change>
Acceptance: <done when …>
Out of scope: <…>
Then: rails (dry-run / no secrets / files / verify)
```

## During the session

### Product thinking (growth edge #1)

- Prefer **user-experience language** when choosing options (“returning users lose context, so …”), not only architecture.
- If Jack’s insight came from a real user conversation / DocMap / being the end user, **restate that in the transcript** so coding-ops can see it.
- Reject hollow goals: `Goal: Add`, “make checkout better”, “add endpoint” with no route/schema/behavior.

### Approval boundaries (growth edge #2)

- On **review / investigate / explore** requests: default to **no edits** until Jack says “implement” / “apply” / “edit”.
- When you propose options, **stop and wait** for a choice — don’t pick and ship silently.
- If you must fix something tiny while reviewing, ask first.

### Close with proof (engineering quality)

Before claiming done on a shipping task, capture at least one of:

- visible diff summary (files + intent)
- test / dry-run / smoke command output
- final git status (or explicit “no commit, as requested”)

Don’t invent LOC. Prefer evidence Jack can verify.

### Keep what already works

Jack’s strength is **rails**: no secrets, dry-run first, exact files, stop conditions. Preserve those — just don’t let rails replace the product contract.

## When to remind vs stay quiet

| Situation | Action |
|-----------|--------|
| Thin feature prompt | Ask for the 4 product fields once |
| Clear product contract already present | Proceed; no nag |
| Open-ended review | Confirm read-only / ask-before-edit |
| “Done” with no proof | Request one verification artifact |
| Pure infra with explicit scope | Skip product block; keep rails + proof |

## Optional MCP (if Cortex tools are available)

If coding-ops tools exist in this environment, you may call `get_coding_builder_profile` once per long session to refresh growth edges — don’t spam it. Prefer the contract above even without MCP.

## Anti-patterns

- Don’t pad praise (“great product sense”) — Paxel only sees in-session evidence.
- Don’t block shipping for ceremony on one-line typo fixes.
- Don’t invent user research Jack didn’t state; ask or leave a TODO.
