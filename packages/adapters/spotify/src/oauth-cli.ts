/**
 * Manual OAuth helper for Spotify Web API.
 *
 * Usage:
 *   pnpm --filter @cortex/adapter-spotify oauth
 *   pnpm --filter @cortex/adapter-spotify oauth -- --code=AUTH_CODE
 *
 * Requires SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET in env / .env.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exchangeSpotifyCode,
  getSpotifyAuthUrl,
  SPOTIFY_SCOPES,
} from "./auth.js";

function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // cwd is usually packages/adapters/spotify under pnpm --filter;
  // source lives in .../spotify/src — walk up to the monorepo root .env.
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../../.env"),
    resolve(here, "../../../../.env"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\n/)) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI?.trim() ||
    "http://127.0.0.1:8766/callback";

  if (!clientId || !clientSecret) {
    console.error(
      "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (Spotify Developer Dashboard) first.",
    );
    process.exit(1);
  }

  const codeArg = process.argv.find((a) => a.startsWith("--code="));
  const code = codeArg?.slice("--code=".length);

  if (!code) {
    const url = getSpotifyAuthUrl({ clientId, redirectUri });
    console.log("Cortex Spotify OAuth");
    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(" REQUIRED REDIRECT URI (paste into Spotify Dashboard)");
    console.log(`   ${redirectUri}`);
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    console.log(
      "Must match character-for-character (http vs https, 127.0.0.1 vs",
    );
    console.log(
      "localhost, port, path, trailing slash). Dashboard often suggests",
    );
    console.log(
      "localhost — Cortex uses 127.0.0.1. Mismatch → redirect_uri error.",
    );
    console.log("");
    console.log("1. Open https://developer.spotify.com/dashboard → your app");
    console.log("2. Settings → Redirect URIs → add the URI above → Save");
    console.log("3. Open this URL in a browser:");
    console.log("");
    console.log(url);
    console.log("");
    console.log("4. After consent, copy the ?code=… value and run:");
    console.log(
      "   pnpm --filter @cortex/adapter-spotify oauth -- --code=PASTE_CODE",
    );
    console.log("");
    console.log("Scopes:", SPOTIFY_SCOPES.join("\n  "));
    return;
  }

  const tokens = await exchangeSpotifyCode(
    { clientId, clientSecret, redirectUri },
    code,
  );
  console.log("Tokens received. Add to .env (never commit):");
  console.log("");
  if (tokens.refresh_token) {
    console.log(`SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}`);
  } else {
    console.log(
      "# No refresh_token returned — revoke prior grants and re-consent,",
    );
    console.log("# or reuse an existing refresh token with offline access.");
  }
  if (tokens.scope) console.log(`# scope=${tokens.scope}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
