/**
 * Spotify Web API OAuth config from env.
 *
 * Required for live API calls:
 *   SPOTIFY_CLIENT_ID
 *   SPOTIFY_CLIENT_SECRET
 *   SPOTIFY_REFRESH_TOKEN
 *
 * Optional:
 *   SPOTIFY_REDIRECT_URI (default http://127.0.0.1:8766/callback)
 *   SPOTIFY_ACCESS_TOKEN (short-lived; usually refreshed)
 *   SPOTIFY_MOCK=1 (force mock mode even if credentials present)
 */

export const SPOTIFY_SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-recently-played",
  "user-top-read",
  "user-read-playback-state",
] as const;

export interface SpotifyAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
  accessToken?: string;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isSpotifyMockForced(): boolean {
  const v = env("SPOTIFY_MOCK")?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isSpotifyConfigured(): boolean {
  return Boolean(
    env("SPOTIFY_CLIENT_ID") &&
      env("SPOTIFY_CLIENT_SECRET") &&
      env("SPOTIFY_REFRESH_TOKEN"),
  );
}

/** Prefer mock fixtures when credentials are missing or SPOTIFY_MOCK is set. */
export function shouldUseSpotifyMock(): boolean {
  return isSpotifyMockForced() || !isSpotifyConfigured();
}

export function loadSpotifyAuthConfigFromEnv(): SpotifyAuthConfig | null {
  const clientId = env("SPOTIFY_CLIENT_ID");
  const clientSecret = env("SPOTIFY_CLIENT_SECRET");
  const refreshToken = env("SPOTIFY_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return null;

  return {
    clientId,
    clientSecret,
    redirectUri:
      env("SPOTIFY_REDIRECT_URI") ?? "http://127.0.0.1:8766/callback",
    refreshToken,
    accessToken: env("SPOTIFY_ACCESS_TOKEN"),
  };
}

export function spotifyAccountKey(): string {
  return "spotify";
}

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTH_URL = "https://accounts.spotify.com/authorize";

export function getSpotifyAuthUrl(config: {
  clientId: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: SPOTIFY_SCOPES.join(" "),
    show_dialog: "true",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeSpotifyCode(
  config: { clientId: string; clientSecret: string; redirectUri: string },
  code: string,
): Promise<{
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
}> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  const basic = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };
}

/**
 * Refresh access token. Mutates config.accessToken when successful.
 */
export async function ensureSpotifyAccessToken(
  config: SpotifyAuthConfig,
): Promise<string> {
  if (config.accessToken) return config.accessToken;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.refreshToken,
  });
  const basic = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token refresh failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!json.access_token) {
    throw new Error("Spotify token refresh returned no access_token");
  }
  config.accessToken = json.access_token;
  if (json.refresh_token) config.refreshToken = json.refresh_token;
  return json.access_token;
}
