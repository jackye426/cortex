# Memory substrate evaluation baseline

Questions and fixture shapes for comparing pre/post Unified Memory Substrate changes.

Source of truth: `apps/mcp-server/src/eval/baseline.ts`

## Questions

1. What were my next actions on Cortex? (operational)
2. What did I repeatedly fail to finish? (reflective)
3. Which problem domains keep recurring? (both)
4. What approaches appear to work well for me? (reflective)
5. What evidence suggests a weakness or recurring friction? (reflective)
6. What am I exploring outside active work? (reflective)
7. How do my YouTube interests overlap with my agent work? (both)
8. Where is the apparent overlap weak or unsupported? (both)
9. What changed between two time periods? (both)
10. Show the source evidence for every conclusion. (both)
11. What is my relationship with underwater basket weaving? (reflective — **intentionally insufficient**)

## Fixture shapes

- short successful session
- long session with end decision
- long tool-heavy middle
- abandoned/usage-limited
- repeated topic across sessions
- YouTube related (agent memory) vs unrelated (cooking)

## How to run

```powershell
pnpm quality-gate -- --fixture --limit=11
# or against live vault (requires env):
pnpm quality-gate -- --limit=11
# or HTTP POST /v1/quality-gate with bearer token
```

Pass criteria: operational questions return evidence; insufficient-evidence question reports gaps/low confidence; fabricated citation IDs are rejected by Analyst validation.
