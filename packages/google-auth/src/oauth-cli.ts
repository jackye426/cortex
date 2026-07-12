/**
 * Manual OAuth helper for Workspace / personal YouTube testing mode.
 *
 * Usage:
 *   pnpm --filter @cortex/google-auth oauth
 *   pnpm --filter @cortex/google-auth oauth -- --code=AUTH_CODE
 *   pnpm --filter @cortex/google-auth oauth -- --bundle=youtube --login_hint=you@gmail.com
 *
 * Workspace path: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.
 * Personal YouTube path (--bundle=youtube / --login_hint / --youtube-token):
 *   prefers GOOGLE_YOUTUBE_CLIENT_ID/SECRET, else falls back to GOOGLE_CLIENT_*.
 * Does not open a browser automatically — paste the printed URL yourself.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOAuth2Client, exchangeCodeForTokens, getAuthUrl } from "./client.js";
import type { GoogleAuthConfig } from "./config.js";
import { WORKSPACE_SCOPES } from "./scopes.js";

function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(here, "../../../.env"),
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

function partialConfig(preferYoutubeClient: boolean): GoogleAuthConfig | null {
  const clientId = preferYoutubeClient
    ? process.env.GOOGLE_YOUTUBE_CLIENT_ID?.trim() ||
      process.env.GOOGLE_CLIENT_ID?.trim()
    : process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = preferYoutubeClient
    ? process.env.GOOGLE_YOUTUBE_CLIENT_SECRET?.trim() ||
      process.env.GOOGLE_CLIENT_SECRET?.trim()
    : process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI?.trim() ||
      "http://127.0.0.1:8765/oauth2callback",
    refreshToken:
      (preferYoutubeClient
        ? process.env.GOOGLE_YOUTUBE_REFRESH_TOKEN?.trim()
        : undefined) ||
      process.env.GOOGLE_REFRESH_TOKEN?.trim() ||
      "pending",
  };
}

function argValue(prefix: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length) || undefined;
}

/** Personal YouTube path: do not overwrite Workspace GOOGLE_REFRESH_TOKEN. */
function youtubeTokenPath(
  bundle: keyof typeof WORKSPACE_SCOPES,
  loginHint: string | undefined,
): boolean {
  if (process.argv.includes("--youtube-token")) return true;
  if (bundle === "youtube") return true;
  if (loginHint) return true;
  return false;
}

async function main(): Promise<void> {
  loadDotEnv();
  const code = argValue("--code=");
  const bundleRaw = argValue("--bundle=") ?? "all";
  const bundle =
    bundleRaw in WORKSPACE_SCOPES
      ? (bundleRaw as keyof typeof WORKSPACE_SCOPES)
      : "all";
  const loginHint = argValue("--login_hint=");
  const storeAsYoutube = youtubeTokenPath(bundle, loginHint);
  const config = partialConfig(storeAsYoutube);
  if (!config) {
    if (storeAsYoutube) {
      console.error(
        "Set GOOGLE_YOUTUBE_CLIENT_ID + GOOGLE_YOUTUBE_CLIENT_SECRET",
      );
      console.error(
        "(or fall back: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) first.",
      );
      console.error(
        "Personal Gmail needs an External consent-screen client — see docs/google.md.",
      );
    } else {
      console.error(
        "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Workspace OAuth client) first.",
      );
    }
    process.exit(1);
  }

  const usingYoutubeClient = Boolean(
    storeAsYoutube && process.env.GOOGLE_YOUTUBE_CLIENT_ID?.trim(),
  );
  const client = createOAuth2Client(config);
  const refreshEnvName = storeAsYoutube
    ? "GOOGLE_YOUTUBE_REFRESH_TOKEN"
    : "GOOGLE_REFRESH_TOKEN";

  if (!code) {
    const url = getAuthUrl(client, bundle, { loginHint });
    console.log("Cortex Google OAuth (testing mode)");
    console.log("");
    if (storeAsYoutube) {
      console.log("Personal YouTube path:");
      console.log("1. OAuth consent screen must be External + Testing (not");
      console.log("   Internal / Workspace-only). Add yulongye426@gmail.com");
      console.log("   (or your Gmail) as a test user.");
      console.log(
        usingYoutubeClient
          ? "2. Using GOOGLE_YOUTUBE_CLIENT_ID/SECRET."
          : "2. Using GOOGLE_CLIENT_ID/SECRET (set GOOGLE_YOUTUBE_CLIENT_* for a separate External client).",
      );
    } else {
      console.log("1. Ensure the OAuth client is External + Testing, and EVERY");
      console.log("   Google account you will consent with is on the test-users");
      console.log("   list (Workspace + personal Gmail if YouTube is personal).");
    }
    if (loginHint) {
      console.log(`3. Open this URL (login_hint=${loginHint}).`);
      console.log("   If the wrong account appears, use a private window or");
      console.log("   switch accounts before consent.");
    } else {
      console.log("3. Open this URL in a browser signed into the right account.");
      console.log("   Tip: --login_hint=you@gmail.com to prefer that account.");
    }
    console.log("");
    console.log(url);
    console.log("");
    console.log("4. After consent, copy the ?code=… value and run:");
    console.log(
      "   pnpm --filter @cortex/google-auth oauth -- --code=PASTE_CODE" +
        (storeAsYoutube
          ? ` --bundle=${bundle}${loginHint ? ` --login_hint=${loginHint}` : ""}`
          : ""),
    );
    console.log("");
    console.log(
      `Bundle: ${bundle} (override with --bundle=youtube|allWithYoutube|…)`,
    );
    if (loginHint) console.log(`login_hint: ${loginHint}`);
    console.log(`OAuth client: ${usingYoutubeClient ? "GOOGLE_YOUTUBE_CLIENT_*" : "GOOGLE_CLIENT_*"}`);
    console.log(`Will print refresh token as: ${refreshEnvName}`);
    if (storeAsYoutube) {
      console.log(
        "   (keeps Workspace GOOGLE_REFRESH_TOKEN for Calendar/Drive/Gmail)",
      );
    }
    console.log("Scopes:", WORKSPACE_SCOPES[bundle].join("\n  "));
    console.log("Redirect:", config.redirectUri);
    return;
  }

  const tokens = await exchangeCodeForTokens(client, code);
  console.log("Tokens received. Add to .env (never commit):");
  console.log("");
  if (tokens.refresh_token) {
    console.log(`${refreshEnvName}=${tokens.refresh_token}`);
    if (storeAsYoutube) {
      console.log(
        "# Do NOT replace GOOGLE_REFRESH_TOKEN — that is Workspace Calendar/Drive/Gmail.",
      );
      if (usingYoutubeClient) {
        console.log(
          "# Keep GOOGLE_YOUTUBE_CLIENT_ID / GOOGLE_YOUTUBE_CLIENT_SECRET for token refresh.",
        );
      }
    }
  } else {
    console.log(
      "# No refresh_token returned — revoke prior grants and re-consent with prompt=consent,",
    );
    console.log("# or use an existing refresh token if you already authorized offline access.");
  }
  if (tokens.scope) console.log(`# scope=${tokens.scope}`);
  console.log("");
  if (storeAsYoutube) {
    console.log(
      "# Optional: GOOGLE_ACCOUNT_EMAIL stays Workspace; YouTube uses GOOGLE_YOUTUBE_*",
    );
  } else {
    console.log("Optional: GOOGLE_ACCOUNT_EMAIL=you@your-workspace.com");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
