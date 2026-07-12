import { google } from "googleapis";
import {
  loadGoogleAuthConfigFromEnv,
  loadYoutubeGoogleAuthConfigFromEnv,
  type GoogleAuthConfig,
} from "./config.js";
import {
  WORKSPACE_SCOPES,
  type WorkspaceScopeBundle,
} from "./scopes.js";

/** OAuth2 client type from the googleapis-bundled auth library. */
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export interface GetAuthUrlOptions {
  /** Prefill / prefer this Google account on the consent screen. */
  loginHint?: string;
}

/**
 * Build an OAuth2 client from explicit config (does not refresh yet).
 */
export function createOAuth2Client(config: GoogleAuthConfig): OAuth2Client {
  const client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
  client.setCredentials({
    refresh_token: config.refreshToken,
    access_token: config.accessToken,
  });
  return client;
}

/**
 * Create an authenticated OAuth2 client from env, or null if not configured.
 * Callers should fall back to mock mode when null.
 */
export function createOAuth2ClientFromEnv(): OAuth2Client | null {
  const config = loadGoogleAuthConfigFromEnv();
  if (!config) return null;
  return createOAuth2Client(config);
}

/**
 * YouTube OAuth client: prefers GOOGLE_YOUTUBE_CLIENT_ID/SECRET +
 * GOOGLE_YOUTUBE_REFRESH_TOKEN so a personal Gmail grant can use an External
 * OAuth client and never overwrite Workspace GOOGLE_* credentials.
 */
export function createYoutubeOAuth2ClientFromEnv(): OAuth2Client | null {
  const config = loadYoutubeGoogleAuthConfigFromEnv();
  if (!config) return null;
  return createOAuth2Client(config);
}

/** Generate a consent URL for the given Workspace scope bundle. */
export function getAuthUrl(
  client: OAuth2Client,
  bundle: WorkspaceScopeBundle = "all",
  options?: GetAuthUrlOptions,
): string {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...WORKSPACE_SCOPES[bundle]],
    include_granted_scopes: true,
    ...(options?.loginHint ? { login_hint: options.loginHint } : {}),
  });
}

/**
 * Exchange an authorization code for tokens (manual OAuth CLI / setup).
 * Prefer storing only the refresh_token in `.env` as GOOGLE_REFRESH_TOKEN.
 */
export async function exchangeCodeForTokens(
  client: OAuth2Client,
  code: string,
): Promise<{
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
}> {
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    scope: tokens.scope,
  };
}

/** Ensure access token is fresh (uses refresh_token). */
export async function ensureAccessToken(
  client: OAuth2Client,
): Promise<string | null> {
  const creds = await client.getAccessToken();
  if (typeof creds === "string") return creds;
  if (creds && typeof creds === "object" && "token" in creds) {
    return (creds as { token?: string | null }).token ?? null;
  }
  return null;
}

/** googleapis factory helpers bound to an OAuth2 client. */
export function calendarApi(auth: OAuth2Client) {
  return google.calendar({ version: "v3", auth });
}

export function driveApi(auth: OAuth2Client) {
  return google.drive({ version: "v3", auth });
}

export function gmailApi(auth: OAuth2Client) {
  return google.gmail({ version: "v1", auth });
}

export function youtubeApi(auth: OAuth2Client) {
  return google.youtube({ version: "v3", auth });
}

export function oauth2Api(auth: OAuth2Client) {
  return google.oauth2({ version: "v2", auth });
}
