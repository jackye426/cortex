/**
 * MCP endpoint profiles — Mirror (default agents) vs Ops (maintenance).
 */
export type McpToolProfile = "mirror" | "ops";

export const MIRROR_PLAYBOOK = `Cortex Mirror playbook (distillates by default):

1. Work / building → list_recent_work, then search_memory (mode=operational). Do NOT expect raw session dumps.
2. Schedule structure → get_calendar_range (sanitised: title/start/end/attendee_count only). Descriptions/attachments → retrieve_supporting_evidence with a capability.
3. Semantic / insight → search_memory (operational|reflective|both). Cited synthesis → ask_mirror.
4. Raw evidence (email body, session turns, drive preview, calendar description) → request_evidence_capability (sensitive) then retrieve_supporting_evidence. Policy decides access; agent preference is not authority.
5. Restricted material (identity/credential-like Drive, auth mail) requires an ops-issued capability — Mirror cannot mint it.
6. Portraits are reflective_sensitive — use get_portrait deliberately; do not persist broker excerpts into long-term memory.
7. Call cortex_help anytime for this playbook.`;

export const OPS_PLAYBOOK = `Cortex Ops playbook (elevated vault maintenance):

1. Full vault tools: search_records, get_session, get_email_thread, get_file_summary, unsanitised calendar, raw list tools.
2. issue_restricted_capability for restricted broker access (short-lived, scoped).
3. Prefer Mirror endpoint for everyday twin chat — keep ops for debugging and restricted grants.
4. Call cortex_help anytime.`;

export function playbookForProfile(profile: McpToolProfile): string {
  return profile === "ops" ? OPS_PLAYBOOK : MIRROR_PLAYBOOK;
}
