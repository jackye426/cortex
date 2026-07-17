/**
 * MCP endpoint profiles — Mirror (default agents) vs Ops (maintenance).
 */
export type McpToolProfile = "mirror" | "ops";

export const MIRROR_PLAYBOOK = `Cortex Mirror playbook (distillates by default):

Start every new thread by calling cortex_help once, then follow this order.

1. Work / building → list_recent_work, then search_memory (mode=operational). Do NOT expect raw session dumps or get_session on this endpoint.
2. Schedule structure → get_calendar_range (sanitised: summary/start/end/attendee_count only). Descriptions/attachments → evidence broker.
3. Semantic / insight → search_memory (operational|reflective|both). Cited synthesis → ask_mirror (citations required; source-balanced for reflective/both; no silent raw expansion). Evidence health → audit_source_coverage; factual atoms → list_observations. Interests → get_interest_map / list_interests; optional log_reflection for energy/valence. Four views → get_weekly_mirror, get_interest_map, get_self_model, list_open_questions. Confirm/reject/refine hypotheses via confirm_hypothesis / reject_hypothesis (or confirm_insight wrappers). Experiments → propose_experiment / complete_experiment; longitudinal → how_have_i_changed; metrics → intrapersonal_metrics.
4. Raw evidence (email body, session turns, drive preview, calendar description):
   a) request_evidence_capability with purpose, sourceTypes, since, until (ISO), permittedFields
      (e.g. body_excerpt|session_excerpt|description_excerpt|text_preview), optional subjectIds/maxResults
   b) retrieve_supporting_evidence with the returned capability_id + same scope
   Policy decides access; your preference is not authority.
5. Restricted material (identity/credential-like Drive, auth mail) needs an ops-issued capability — Mirror cannot mint it.
6. Portraits are reflective_sensitive — use get_portrait deliberately; never persist broker excerpts into long-term memory.
7. Twin helpers on Mirror stay on derived memory (entities, decisions, portraits, allocator_context). Prefer ask_mirror / search_memory for answers.

If a tool is missing, you are on Mirror — do not invent Ops tools (search_records, get_session, get_email_thread).`;

export const OPS_PLAYBOOK = `Cortex Ops playbook (elevated vault maintenance):

1. Full vault tools: search_records, get_session, get_email_thread, get_file_summary, unsanitised calendar, raw list tools.
2. issue_restricted_capability for restricted broker access (short-lived, scoped).
3. Prefer Mirror endpoint for everyday twin chat — keep Ops for debugging and restricted grants.
4. Call cortex_help anytime.`;

export function playbookForProfile(profile: McpToolProfile): string {
  return profile === "ops" ? OPS_PLAYBOOK : MIRROR_PLAYBOOK;
}
