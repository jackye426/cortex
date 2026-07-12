export {
  SCOPE_CALENDAR_READONLY,
  SCOPE_DRIVE_READONLY,
  SCOPE_GMAIL_READONLY,
  SCOPE_USERINFO_EMAIL,
  SCOPE_YOUTUBE_READONLY,
  WORKSPACE_SCOPES,
  type WorkspaceScopeBundle,
} from "./scopes.js";

export {
  googleAccountKey,
  isGoogleConfigured,
  isGoogleMockForced,
  isYoutubeGoogleConfigured,
  loadGoogleAuthConfigFromEnv,
  loadYoutubeGoogleAuthConfigFromEnv,
  shouldUseGoogleMock,
  shouldUseYoutubeGoogleMock,
  type GoogleAuthConfig,
} from "./config.js";

export {
  calendarApi,
  createOAuth2Client,
  createOAuth2ClientFromEnv,
  createYoutubeOAuth2ClientFromEnv,
  driveApi,
  ensureAccessToken,
  exchangeCodeForTokens,
  getAuthUrl,
  gmailApi,
  oauth2Api,
  youtubeApi,
  type GetAuthUrlOptions,
  type OAuth2Client,
} from "./client.js";
