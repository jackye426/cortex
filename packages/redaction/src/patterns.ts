/**
 * Secret / credential patterns applied before vault upload.
 * Matches are replaced with a typed placeholder; originals never leave the host.
 */

export interface RedactionPattern {
  /** Stable id for logging / tuning. */
  id: string;
  /** Human description. */
  description: string;
  /** Global regex; capture group optional. */
  pattern: RegExp;
  /** Replacement token written into redacted text. */
  replacement: string;
}

export const SECRET_PATTERNS: RedactionPattern[] = [
  {
    id: "anthropic-key",
    description: "Anthropic API keys",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED:anthropic_api_key]",
  },
  {
    id: "openai-project-key",
    description: "OpenAI project-scoped API keys",
    pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED:openai_api_key]",
  },
  {
    id: "openai-sk",
    description: "OpenAI / OpenAI-compatible API keys",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED:openai_api_key]",
  },
  {
    id: "github-pat",
    description: "GitHub personal access tokens (classic + fine-grained)",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
    replacement: "[REDACTED:github_token]",
  },
  {
    id: "github-fine-grained",
    description: "GitHub fine-grained PAT prefix",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: "[REDACTED:github_token]",
  },
  {
    id: "aws-access-key",
    description: "AWS access key id (AKIA long-term / ASIA temporary)",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED:aws_access_key]",
  },
  {
    id: "aws-secret-key",
    description: "AWS secret access key assignment",
    pattern:
      /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key|SecretAccessKey|aws_secret_key)\s*[=:]\s*["']?[A-Za-z0-9/+=]{30,}["']?/gi,
    replacement: "[REDACTED:aws_secret_key]",
  },
  {
    id: "google-api-key",
    description: "Google API keys (AIza…) common in AI transcripts",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: "[REDACTED:google_api_key]",
  },
  {
    id: "huggingface-token",
    description: "Hugging Face access tokens",
    pattern: /\bhf_[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED:huggingface_token]",
  },
  {
    id: "npm-token",
    description: "npm access tokens",
    pattern: /\bnpm_[A-Za-z0-9]{36,}\b/g,
    replacement: "[REDACTED:npm_token]",
  },
  {
    id: "jwt",
    description: "JWT-ish bearer tokens (three base64url segments)",
    pattern:
      /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: "[REDACTED:jwt]",
  },
  {
    id: "bearer-header",
    description: "Authorization Bearer header values",
    pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
    replacement: "Bearer [REDACTED:bearer_token]",
  },
  {
    id: "env-assignment",
    description: ".env-style secret assignments (KEY=value)",
    pattern:
      /\b(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|DATABASE_URL|SUPABASE_(?:SERVICE_ROLE|ANON)_KEY)\s*=\s*["']?[^\s"'#]+["']?/gi,
    replacement: "[REDACTED:env_assignment]",
  },
  {
    id: "private-key-block",
    description: "PEM private key headers / blocks",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
    replacement: "[REDACTED:private_key]",
  },
  {
    id: "slack-token",
    description: "Slack bot / user tokens",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[REDACTED:slack_token]",
  },
  {
    id: "stripe-key",
    description: "Stripe secret keys",
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED:stripe_key]",
  },
  {
    id: "supabase-service-role",
    description: "Supabase service_role JWT-looking keys in prose",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED:supabase_secret]",
  },
];
export interface RedactionHit {
  patternId: string;
  count: number;
}

export interface RedactResult {
  text: string;
  hits: RedactionHit[];
  redacted: boolean;
}

/**
 * Apply all secret patterns to a string. Order is as defined in SECRET_PATTERNS.
 */
export function redactText(
  input: string,
  patterns: RedactionPattern[] = SECRET_PATTERNS,
): RedactResult {
  let text = input;
  const hits: RedactionHit[] = [];

  for (const p of patterns) {
    const re = new RegExp(p.pattern.source, p.pattern.flags.includes("g") ? p.pattern.flags : `${p.pattern.flags}g`);
    let count = 0;
    text = text.replace(re, () => {
      count += 1;
      return p.replacement;
    });
    if (count > 0) {
      hits.push({ patternId: p.id, count });
    }
  }

  return {
    text,
    hits,
    redacted: hits.length > 0,
  };
}

/**
 * Deep-redact strings inside JSON-compatible values.
 */
export function redactValue(value: unknown): { value: unknown; hits: RedactionHit[] } {
  const merged = new Map<string, number>();

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const result = redactText(node);
      for (const hit of result.hits) {
        merged.set(hit.patternId, (merged.get(hit.patternId) ?? 0) + hit.count);
      }
      return result.text;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };

  const next = walk(value);
  const hits = [...merged.entries()].map(([patternId, count]) => ({ patternId, count }));
  return { value: next, hits };
}
