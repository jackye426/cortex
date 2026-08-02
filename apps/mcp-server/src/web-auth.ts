import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const DEFAULT_COOKIE_NAME = "cortex_session";
const DEFAULT_TTL_SECONDS = 60 * 60 * 12;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7;

export type WebSession = {
  sub: "jack";
  iat: number;
  exp: number;
  nonce: string;
};

export type WebAuthConfig = {
  passwordHash: string;
  sessionSecret: string;
  allowedOrigins: ReadonlySet<string>;
  cookieName: string;
  cookieSecure: boolean;
  ttlSeconds: number;
};

function clampTtl(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(parsed), MAX_TTL_SECONDS);
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!url.origin || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveAllowedWebOrigins(
  raw = process.env.CORTEX_WEB_ORIGINS,
): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const value of raw?.split(",") ?? []) {
    const origin = normalizedOrigin(value);
    if (origin) origins.add(origin);
  }
  return origins;
}

export function isAllowedWebOrigin(
  origin: string | undefined,
  allowedOrigins = resolveAllowedWebOrigins(),
): boolean {
  if (!origin) return false;
  const normalized = normalizedOrigin(origin);
  return normalized !== null && allowedOrigins.has(normalized);
}

export function resolveWebAuthConfig(): WebAuthConfig | null {
  const passwordHash = process.env.CORTEX_WEB_PASSWORD_HASH?.trim();
  const sessionSecret = process.env.CORTEX_WEB_SESSION_SECRET?.trim();
  const allowedOrigins = resolveAllowedWebOrigins();
  if (
    !passwordHash ||
    !sessionSecret ||
    sessionSecret.length < 32 ||
    allowedOrigins.size === 0
  ) {
    return null;
  }
  const production = process.env.NODE_ENV === "production";
  const insecureDevCookie =
    !production && process.env.CORTEX_WEB_COOKIE_SECURE === "0";
  return {
    passwordHash,
    sessionSecret,
    allowedOrigins,
    cookieName:
      process.env.CORTEX_WEB_COOKIE_NAME?.trim() || DEFAULT_COOKIE_NAME,
    cookieSecure: !insecureDevCookie,
    ttlSeconds: clampTtl(process.env.CORTEX_WEB_SESSION_TTL_SECONDS),
  };
}

/** Format: scrypt$<16+ byte salt hex>$<64 byte derived-key hex>. */
export function hashWebPassword(password: string, salt?: Buffer): string {
  const actualSalt = salt ?? randomBytes(16);
  const derived = scryptSync(password, actualSalt, 64);
  return `scrypt$${actualSalt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyWebPassword(password: string, encoded: string): boolean {
  const [scheme, saltHex, hashHex, ...rest] = encoded.split("$");
  if (scheme !== "scrypt" || rest.length > 0) return false;
  if (!/^[0-9a-f]{32,}$/i.test(saltHex ?? "")) return false;
  if (!/^[0-9a-f]{128}$/i.test(hashHex ?? "")) return false;
  try {
    const salt = Buffer.from(saltHex!, "hex");
    const expected = Buffer.from(hashHex!, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sessionSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

export function createWebSession(
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
): { token: string; session: WebSession } {
  const session: WebSession = {
    sub: "jack",
    iat: nowSeconds,
    exp: nowSeconds + Math.min(Math.max(1, ttlSeconds), MAX_TTL_SECONDS),
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = base64UrlJson(session);
  return {
    token: `${payload}.${sessionSignature(payload, secret)}`,
    session,
  };
}

export function verifyWebSession(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebSession | null {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sessionSignature(payload, secret), "utf8");
  const received = Buffer.from(signature, "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<WebSession>;
    if (
      parsed.sub !== "jack" ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number" ||
      typeof parsed.nonce !== "string" ||
      parsed.iat > nowSeconds + 60 ||
      parsed.exp <= nowSeconds ||
      parsed.exp - parsed.iat > MAX_TTL_SECONDS
    ) {
      return null;
    }
    return parsed as WebSession;
  } catch {
    return null;
  }
}

export function cookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  for (const part of cookieHeader?.split(";") ?? []) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return part.slice(index + 1).trim() || null;
  }
  return null;
}

export function sessionCookie(
  config: WebAuthConfig,
  token: string,
): string {
  return [
    `${config.cookieName}=${token}`,
    "Path=/",
    "HttpOnly",
    config.cookieSecure ? "Secure" : "",
    "SameSite=Lax",
    `Max-Age=${config.ttlSeconds}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function expiredSessionCookie(config: WebAuthConfig): string {
  return [
    `${config.cookieName}=`,
    "Path=/",
    "HttpOnly",
    config.cookieSecure ? "Secure" : "",
    "SameSite=Lax",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

export function webSessionFromCookie(
  cookieHeader: string | undefined,
  config: WebAuthConfig,
  nowSeconds?: number,
): WebSession | null {
  const token = cookieValue(cookieHeader, config.cookieName);
  return token
    ? verifyWebSession(token, config.sessionSecret, nowSeconds)
    : null;
}
