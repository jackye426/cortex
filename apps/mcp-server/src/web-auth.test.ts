import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cookieValue,
  createWebSession,
  hashWebPassword,
  isAllowedWebOrigin,
  resolveAllowedWebOrigins,
  sessionCookie,
  verifyWebPassword,
  verifyWebSession,
} from "./web-auth.js";

describe("web auth", () => {
  it("verifies scrypt password hashes without accepting another password", () => {
    const encoded = hashWebPassword("correct horse", Buffer.alloc(16, 7));
    assert.equal(verifyWebPassword("correct horse", encoded), true);
    assert.equal(verifyWebPassword("wrong horse", encoded), false);
    assert.equal(verifyWebPassword("correct horse", "sha256$bad$bad"), false);
  });

  it("signs sessions and rejects tampering and expiry", () => {
    const secret = "s".repeat(40);
    const { token, session } = createWebSession(secret, 300, 1_000);
    assert.deepEqual(verifyWebSession(token, secret, 1_001), session);
    assert.equal(verifyWebSession(`${token}x`, secret, 1_001), null);
    assert.equal(verifyWebSession(token, "x".repeat(40), 1_001), null);
    assert.equal(verifyWebSession(token, secret, 1_301), null);
  });

  it("matches exact normalized web origins", () => {
    const origins = resolveAllowedWebOrigins(
      "https://jackye.wiki, https://www.jackye.wiki,not-a-url",
    );
    assert.equal(isAllowedWebOrigin("https://jackye.wiki", origins), true);
    assert.equal(isAllowedWebOrigin("https://jackye.wiki.evil.test", origins), false);
    assert.equal(isAllowedWebOrigin("http://jackye.wiki", origins), false);
  });

  it("reads only the exact cookie name", () => {
    assert.equal(cookieValue("other=x; cortex_session=abc.def", "cortex_session"), "abc.def");
    assert.equal(cookieValue("my_cortex_session=x", "cortex_session"), null);
  });

  it("uses a host-only secure HttpOnly production cookie", () => {
    const cookie = sessionCookie(
      {
        passwordHash: "unused",
        sessionSecret: "s".repeat(40),
        allowedOrigins: new Set(["https://jackye.wiki"]),
        cookieName: "cortex_session",
        cookieSecure: true,
        ttlSeconds: 3600,
      },
      "payload.signature",
    );
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Domain=/);
  });
});
