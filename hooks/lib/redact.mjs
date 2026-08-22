/**
 * Dependency-free port of @cortex/redaction SECRET_PATTERNS for hooks.
 * Order matches packages/redaction/src/patterns.ts (sk-ant / sk-proj before sk-).
 */

const SECRET_PATTERNS = [
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:anthropic_api_key]"],
  [/\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:openai_api_key]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:openai_api_key]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED:github_token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED:github_token]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED:aws_access_key]"],
  [
    /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key|SecretAccessKey|aws_secret_key)\s*[=:]\s*["']?[A-Za-z0-9/+=]{30,}["']?/gi,
    "[REDACTED:aws_secret_key]",
  ],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED:google_api_key]"],
  [/\bhf_[A-Za-z0-9]{20,}\b/g, "[REDACTED:huggingface_token]"],
  [/\bnpm_[A-Za-z0-9]{36,}\b/g, "[REDACTED:npm_token]"],
  [/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED:jwt]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, "Bearer [REDACTED:bearer_token]"],
  [
    /\b(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|DATABASE_URL|SUPABASE_(?:SERVICE_ROLE|ANON)_KEY)\s*=\s*["']?[^\s"'#]+["']?/gi,
    "[REDACTED:env_assignment]",
  ],
  [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
    "[REDACTED:private_key]",
  ],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED:slack_token]"],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g, "[REDACTED:stripe_key]"],
  [/\bsb_secret_[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:supabase_secret]"],
];

export function redactText(input) {
  let text = String(input ?? "");
  let hitCount = 0;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    text = text.replace(re, () => {
      hitCount += 1;
      return replacement;
    });
  }
  return { text, hitCount, redacted: hitCount > 0 };
}

export function redactValue(value) {
  let hitCount = 0;
  const walk = (node) => {
    if (typeof node === "string") {
      const result = redactText(node);
      hitCount += result.hitCount;
      return result.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };
  return { value: walk(value), hitCount, redacted: hitCount > 0 };
}
