/**

 * Load Google Workspace OAuth config from env.

 *

 * Required for live API calls:

 *   GOOGLE_CLIENT_ID

 *   GOOGLE_CLIENT_SECRET

 *   GOOGLE_REFRESH_TOKEN

 *

 * Optional:

 *   GOOGLE_REDIRECT_URI (default http://127.0.0.1:8765/oauth2callback)

 *   GOOGLE_ACCESS_TOKEN (short-lived; usually refreshed from refresh token)

 *   GOOGLE_ACCOUNT_EMAIL (labels account_key; otherwise "workspace")

 *   GOOGLE_YOUTUBE_CLIENT_ID / GOOGLE_YOUTUBE_CLIENT_SECRET

 *     (personal YouTube OAuth client; falls back to GOOGLE_CLIENT_*)

 *   GOOGLE_YOUTUBE_REFRESH_TOKEN (personal YouTube; falls back to GOOGLE_REFRESH_TOKEN)

 *   GOOGLE_MOCK=1 (force mock mode even if credentials present)

 */



export interface GoogleAuthConfig {

  clientId: string;

  clientSecret: string;

  redirectUri: string;

  refreshToken: string;

  accessToken?: string;

  accountEmail?: string;

}



function env(name: string): string | undefined {

  const v = process.env[name];

  if (v == null) return undefined;

  const trimmed = v.trim();

  return trimmed.length > 0 ? trimmed : undefined;

}



/** True when operator forced mock fixtures (no live Google calls). */

export function isGoogleMockForced(): boolean {

  const v = env("GOOGLE_MOCK")?.toLowerCase();

  return v === "1" || v === "true" || v === "yes";

}



/**

 * True when OAuth client + refresh token are present.

 * Does not validate the token against Google.

 */

export function isGoogleConfigured(): boolean {

  return Boolean(

    env("GOOGLE_CLIENT_ID") &&

      env("GOOGLE_CLIENT_SECRET") &&

      env("GOOGLE_REFRESH_TOKEN"),

  );

}



/**

 * True when a YouTube-capable OAuth client + refresh token are present.

 * Prefers GOOGLE_YOUTUBE_CLIENT_* and GOOGLE_YOUTUBE_REFRESH_TOKEN over GOOGLE_*.

 */

export function isYoutubeGoogleConfigured(): boolean {

  const clientId = env("GOOGLE_YOUTUBE_CLIENT_ID") || env("GOOGLE_CLIENT_ID");

  const clientSecret =

    env("GOOGLE_YOUTUBE_CLIENT_SECRET") || env("GOOGLE_CLIENT_SECRET");

  const refreshToken =

    env("GOOGLE_YOUTUBE_REFRESH_TOKEN") || env("GOOGLE_REFRESH_TOKEN");

  return Boolean(clientId && clientSecret && refreshToken);

}



/**

 * Prefer mock fixtures when credentials are missing or GOOGLE_MOCK is set.

 * Live OAuth is never initiated automatically.

 */

export function shouldUseGoogleMock(): boolean {

  return isGoogleMockForced() || !isGoogleConfigured();

}



/** YouTube adapter mock gate — allows a separate personal client + refresh token. */

export function shouldUseYoutubeGoogleMock(): boolean {

  return isGoogleMockForced() || !isYoutubeGoogleConfigured();

}



function baseGoogleClientEnv(): Omit<GoogleAuthConfig, "refreshToken"> | null {

  const clientId = env("GOOGLE_CLIENT_ID");

  const clientSecret = env("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) return null;

  return {

    clientId,

    clientSecret,

    redirectUri:

      env("GOOGLE_REDIRECT_URI") ?? "http://127.0.0.1:8765/oauth2callback",

    accessToken: env("GOOGLE_ACCESS_TOKEN"),

    accountEmail: env("GOOGLE_ACCOUNT_EMAIL"),

  };

}



/**

 * YouTube OAuth client credentials: prefer GOOGLE_YOUTUBE_CLIENT_ID/SECRET,

 * else fall back to Workspace GOOGLE_CLIENT_ID/SECRET.

 */

function youtubeGoogleClientEnv(): Omit<GoogleAuthConfig, "refreshToken"> | null {

  const clientId = env("GOOGLE_YOUTUBE_CLIENT_ID") || env("GOOGLE_CLIENT_ID");

  const clientSecret =

    env("GOOGLE_YOUTUBE_CLIENT_SECRET") || env("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) return null;

  return {

    clientId,

    clientSecret,

    redirectUri:

      env("GOOGLE_REDIRECT_URI") ?? "http://127.0.0.1:8765/oauth2callback",

    accessToken: env("GOOGLE_ACCESS_TOKEN"),

    accountEmail: env("GOOGLE_ACCOUNT_EMAIL"),

  };

}



export function loadGoogleAuthConfigFromEnv(): GoogleAuthConfig | null {

  const base = baseGoogleClientEnv();

  const refreshToken = env("GOOGLE_REFRESH_TOKEN");

  if (!base || !refreshToken) return null;

  return { ...base, refreshToken };

}



/**

 * YouTube-only config: prefers personal YouTube client id/secret + refresh token,

 * falling back to Workspace GOOGLE_* when unset.

 */

export function loadYoutubeGoogleAuthConfigFromEnv(): GoogleAuthConfig | null {

  const base = youtubeGoogleClientEnv();

  const refreshToken =

    env("GOOGLE_YOUTUBE_REFRESH_TOKEN") || env("GOOGLE_REFRESH_TOKEN");

  if (!base || !refreshToken) return null;

  return { ...base, refreshToken };

}



/** Stable checkpoint account_key for Workspace sources. */

export function googleAccountKey(email?: string): string {

  const fromEnv = email ?? env("GOOGLE_ACCOUNT_EMAIL");

  return fromEnv ? `workspace:${fromEnv.toLowerCase()}` : "workspace";

}

