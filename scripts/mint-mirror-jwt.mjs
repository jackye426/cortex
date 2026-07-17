#!/usr/bin/env node
/**
 * Mint a long-lived Supabase JWT with role claim `cortex_mirror`.
 *
 * Requires the project JWT secret (Dashboard → Project Settings → API → JWT Secret).
 * Never commit the secret or the minted key.
 *
 *   SUPABASE_JWT_SECRET='...' node scripts/mint-mirror-jwt.mjs
 *
 * Paste the printed token into:
 *   - local .env as SUPABASE_MIRROR_KEY=
 *   - Railway MCP as SUPABASE_MIRROR_KEY
 */
import { createHmac } from "node:crypto";

const secret = process.env.SUPABASE_JWT_SECRET?.trim();
if (!secret) {
  console.error(
    "Set SUPABASE_JWT_SECRET (Supabase Dashboard → Project Settings → API → JWT Secret).",
  );
  process.exit(1);
}

const years = Number(process.env.CORTEX_MIRROR_JWT_YEARS || "10");
const now = Math.floor(Date.now() / 1000);
const exp = now + Math.floor(years * 365.25 * 24 * 60 * 60);

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const payload = b64url(
  JSON.stringify({
    role: "cortex_mirror",
    iss: "supabase",
    iat: now,
    exp,
  }),
);
const data = `${header}.${payload}`;
const sig = createHmac("sha256", secret)
  .update(data)
  .digest("base64")
  .replace(/=/g, "")
  .replace(/\+/g, "-")
  .replace(/\//g, "_");

const token = `${data}.${sig}`;
console.log(token);
console.error(
  `\nMinted cortex_mirror JWT (exp ~${years}y). Set SUPABASE_MIRROR_KEY to this value.`,
);
console.error(
  "Note: MCP does not switch Mirror handlers to this key until the dual-client wiring lands;",
);
console.error(
  "creating the role + key now is still the correct prep step.",
);
