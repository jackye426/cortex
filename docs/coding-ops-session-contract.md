# Coding ops session contract (build-time reminders)

Standing instructions so AI coding sessions address **Paxel / Cortex coding-ops growth edges** while you build — not only in the weekly profile.

**Skill (auto-loaded by agents):**

| Tool | Path |
|------|------|
| Cursor | [`.cursor/skills/coding-ops-session-contract/SKILL.md`](../.cursor/skills/coding-ops-session-contract/SKILL.md) |
| Claude / Codex / Gemini | [`.agents/skills/coding-ops-session-contract/SKILL.md`](../.agents/skills/coding-ops-session-contract/SKILL.md) |
| Claude Code | [`.claude/skills/coding-ops-session-contract/SKILL.md`](../.claude/skills/coding-ops-session-contract/SKILL.md) |

Also referenced from root [`AGENTS.md`](../AGENTS.md).

## Why this exists

Paxel (and Cortex coding-ops) score **in-session** evidence. Strong off-chat product thinking does not count unless restated in the agent transcript. Your report pattern:

- **Strong:** steering, safety rails, dry-run / no-secrets, architecture redirects  
- **Weaker in-session:** product targets on small features, approval boundaries on reviews, final proof artifacts  

## Paste template (user-facing work)

```text
User: <who>
Job: <what they’re trying to do>
Behavior: <observable change>
Acceptance: <done when …>
Out of scope: <…>

Rails: dry-run first / no secrets / no commit until I say / only touch <files>
```

## Agent behavior (summary)

1. If the feature ask is thin → ask once for the four product fields before implementing.  
2. Review/investigate → default read-only until you approve edits.  
3. Before “done” on shipping work → show diff summary, test/smoke output, or git status.  
4. Keep your existing rails; don’t replace product contract with process.

## Refresh from live profile

```text
MCP: get_coding_builder_profile
HTTP: POST /v1/twin { "job": "coding-ops" }
```

Update this skill’s growth-edge wording when the profile’s top growth cards change.

## Related

- [coding-ops-roadmap.md](coding-ops-roadmap.md)  
- [twin.md](twin.md)  
