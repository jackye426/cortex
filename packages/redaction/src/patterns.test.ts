/**
 * Redaction pattern tests — AI transcript risk samples (Phase 7).
 * Run: pnpm --filter @cortex/redaction test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactText } from "./patterns.js";

describe("redaction patterns", () => {
  it("redacts OpenAI sk- and sk-proj keys", () => {
    const sample =
      "key sk-abcdefghijklmnopqrstuvwxyz012345 and sk-proj-abcdefghijklmnopqrstuvwxyz012345";
    const result = redactText(sample);
    assert.equal(result.redacted, true);
    assert.match(result.text, /\[REDACTED:openai_api_key\]/);
    assert.doesNotMatch(result.text, /sk-abcdefghijklmnopqrstuvwxyz012345/);
    assert.doesNotMatch(result.text, /sk-proj-abcdefghijklmnopqrstuvwxyz012345/);
  });

  it("redacts Anthropic keys before generic sk-", () => {
    const sample = "export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
    const result = redactText(sample);
    assert.ok(result.hits.some((h) => h.patternId === "anthropic-key"));
    assert.match(result.text, /\[REDACTED:anthropic_api_key\]/);
  });

  it("redacts AWS AKIA and ASIA access keys", () => {
    const sample =
      "creds AKIAIOSFODNN7EXAMPLE and temp ASIAY34FZKRIERQXGZLG leaked in chat";
    const result = redactText(sample);
    assert.ok(result.hits.some((h) => h.patternId === "aws-access-key"));
    assert.equal(
      (result.hits.find((h) => h.patternId === "aws-access-key")?.count ?? 0) >= 2,
      true,
    );
    assert.doesNotMatch(result.text, /AKIAIOSFODNN7EXAMPLE/);
    assert.doesNotMatch(result.text, /ASIAY34FZKRIERQXGZLG/);
  });

  it("redacts AWS secret assignment variants from transcripts", () => {
    const sample =
      'SecretAccessKey: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const result = redactText(sample);
    assert.ok(result.hits.some((h) => h.patternId === "aws-secret-key"));
    assert.match(result.text, /\[REDACTED:aws_secret_key\]/);
  });

  it("redacts PEM private key blocks", () => {
    const sample = `before
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF6PZGFw
-----END RSA PRIVATE KEY-----
after`;
    const result = redactText(sample);
    assert.ok(result.hits.some((h) => h.patternId === "private-key-block"));
    assert.match(result.text, /\[REDACTED:private_key\]/);
    assert.doesNotMatch(result.text, /MIIEowIBAAKCAQEA/);
  });

  it("redacts Google API keys common in tool output", () => {
    const sample = "maps key AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe";
    const result = redactText(sample);
    assert.ok(result.hits.some((h) => h.patternId === "google-api-key"));
    assert.match(result.text, /\[REDACTED:google_api_key\]/);
  });

  it("redacts Hugging Face and npm tokens", () => {
    const sample =
      "hf_abcdefghijklmnopqrstuvwxyz12 npm_abcdefghijklmnopqrstuvwxyz0123456789ab";
    const result = redactText(sample);
    assert.ok(result.hits.some((h) => h.patternId === "huggingface-token"));
    assert.ok(result.hits.some((h) => h.patternId === "npm-token"));
  });

  it("redacts GitHub PATs and Stripe keys", () => {
    // Build sample at runtime so the file never contains a scanner-looking Stripe literal.
    const stripeLive = ["sk", "live", "abcdefghijklmnopqrstuvwxyz"].join("_");
    const stripeTest = ["sk", "test", "abcdefghijklmnopqrstuvwxyz"].join("_");
    const sample = `ghp_abcdefghijklmnopqrstuvwxyz012345 ${stripeLive} ${stripeTest}`;
    const result = redactText(sample);
    assert.ok(result.hits.some((h) => h.patternId === "github-pat"));
    assert.ok(result.hits.some((h) => h.patternId === "stripe-key"));
  });
});
