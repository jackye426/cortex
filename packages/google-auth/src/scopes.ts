/**
 * Google Workspace OAuth scopes for Cortex Phase 5.
 * Personal (consumer) Google accounts are out of scope — Workspace only.
 *
 * Verification: `gmail.readonly` is a restricted scope. Stay in Google Cloud
 * OAuth testing mode (test users) until verification is required for broader
 * access. See docs/google.md.
 */

/** Calendar events (read-only). */
export const SCOPE_CALENDAR_READONLY =
  "https://www.googleapis.com/auth/calendar.readonly";

/** Drive file metadata + export (read-only). */
export const SCOPE_DRIVE_READONLY =
  "https://www.googleapis.com/auth/drive.readonly";

/**
 * Gmail message bodies (read-only). Restricted scope — verification required
 * for production apps outside the test-user list.
 */
export const SCOPE_GMAIL_READONLY =
  "https://www.googleapis.com/auth/gmail.readonly";

/** Optional: user email for account_key labeling. */
export const SCOPE_USERINFO_EMAIL =
  "https://www.googleapis.com/auth/userinfo.email";

/** YouTube Data API v3 (read-only library). Phase 5b. */
export const SCOPE_YOUTUBE_READONLY =
  "https://www.googleapis.com/auth/youtube.readonly";

/** Scopes per Cortex source adapter. */
export const WORKSPACE_SCOPES = {
  calendar: [SCOPE_CALENDAR_READONLY, SCOPE_USERINFO_EMAIL],
  drive: [SCOPE_DRIVE_READONLY, SCOPE_USERINFO_EMAIL],
  gmail: [SCOPE_GMAIL_READONLY, SCOPE_USERINFO_EMAIL],
  youtube: [SCOPE_YOUTUBE_READONLY, SCOPE_USERINFO_EMAIL],
  /** Single consent covering Calendar → Drive → Gmail. */
  all: [
    SCOPE_CALENDAR_READONLY,
    SCOPE_DRIVE_READONLY,
    SCOPE_GMAIL_READONLY,
    SCOPE_USERINFO_EMAIL,
  ],
  /** Workspace + YouTube (re-consent required if prior grant lacked youtube.readonly). */
  allWithYoutube: [
    SCOPE_CALENDAR_READONLY,
    SCOPE_DRIVE_READONLY,
    SCOPE_GMAIL_READONLY,
    SCOPE_YOUTUBE_READONLY,
    SCOPE_USERINFO_EMAIL,
  ],
} as const;

export type WorkspaceScopeBundle = keyof typeof WORKSPACE_SCOPES;
