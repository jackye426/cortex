import { timingSafeEqual } from "node:crypto";

export type StoreMode = "memory" | "supabase";

export interface CompanyBrainConfig {
  storeMode: StoreMode;
  cutoverAt: Date;
  supabase?: {
    url: string;
    serviceRoleKey: string;
    projectRef: string;
  };
  github: {
    allowedRepos: string[];
    allowedInstallationIds: string[];
    webhookSecret: string;
  };
  tokens: {
    ingest: string;
    agent: string;
    founders: { jack: string; eric: string };
  };
}

export class CompanyBrainConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyBrainConfigError";
  }
}

function req(env: NodeJS.Dict<string>, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new CompanyBrainConfigError(`${key} is required`);
  }
  return value;
}

function strongSecret(env: NodeJS.Dict<string>, key: string): string {
  const value = req(env, key);
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new CompanyBrainConfigError(`${key} must be at least 32 bytes`);
  }
  return value;
}

function projectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function distinct(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new CompanyBrainConfigError(`${label} must be unique`);
    }
    seen.add(value);
  }
}

/**
 * Fail-closed loader. Reads only COMPANY_BRAIN_* keys. Never falls back to
 * Cortex/generic SUPABASE_*, CORTEX_*, or GITHUB_* credentials.
 */
export function loadCompanyBrainConfig(
  env: NodeJS.Dict<string> = process.env,
): CompanyBrainConfig {
  const storeModeRaw = req(env, "COMPANY_BRAIN_STORE");
  if (storeModeRaw !== "memory" && storeModeRaw !== "supabase") {
    throw new CompanyBrainConfigError(
      "COMPANY_BRAIN_STORE must be memory or supabase",
    );
  }
  const storeMode: StoreMode = storeModeRaw;

  if (storeMode === "supabase") {
    if (!env.COMPANY_BRAIN_SUPABASE_URL?.trim() && env.SUPABASE_URL?.trim()) {
      throw new CompanyBrainConfigError(
        "generic SUPABASE_URL is present; Company Brain refuses Cortex credential fallbacks",
      );
    }
    if (
      !env.COMPANY_BRAIN_SUPABASE_SERVICE_ROLE_KEY?.trim() &&
      env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    ) {
      throw new CompanyBrainConfigError(
        "generic SUPABASE_SERVICE_ROLE_KEY is present; Company Brain refuses Cortex credential fallbacks",
      );
    }
  }

  const cutoverRaw = req(env, "COMPANY_BRAIN_CUTOVER_AT");
  const cutoverAt = new Date(cutoverRaw);
  if (Number.isNaN(cutoverAt.getTime())) {
    throw new CompanyBrainConfigError(
      "COMPANY_BRAIN_CUTOVER_AT must be a valid ISO timestamp",
    );
  }

  const allowedRepos = req(env, "COMPANY_BRAIN_GITHUB_ALLOWED_REPOS")
    .split(",")
    .map((repo) => repo.trim().toLowerCase())
    .filter(Boolean);
  if (allowedRepos.length === 0) {
    throw new CompanyBrainConfigError(
      "COMPANY_BRAIN_GITHUB_ALLOWED_REPOS must list at least one owner/name",
    );
  }

  const allowedInstallationIds = (
    env.COMPANY_BRAIN_GITHUB_INSTALLATION_IDS ?? ""
  )
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const webhookSecret = strongSecret(
    env,
    "COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET",
  );
  const ingest = strongSecret(env, "COMPANY_BRAIN_INGEST_TOKEN");
  const agent = strongSecret(env, "COMPANY_BRAIN_AGENT_TOKEN");
  const jack = strongSecret(env, "COMPANY_BRAIN_FOUNDER_JACK_TOKEN");
  const eric = strongSecret(env, "COMPANY_BRAIN_FOUNDER_ERIC_TOKEN");
  distinct([ingest, agent, jack, eric], "Company Brain tokens");

  for (const [genericKey, companyToken] of [
    ["CORTEX_INGEST_TOKEN", ingest],
    ["CORTEX_MCP_TOKEN", agent],
    ["GITHUB_WEBHOOK_SECRET", webhookSecret],
  ] as const) {
    const generic = env[genericKey]?.trim();
    if (generic && generic === companyToken) {
      throw new CompanyBrainConfigError(
        `${genericKey} must not equal the Company Brain token`,
      );
    }
  }

  let supabase: CompanyBrainConfig["supabase"];
  if (storeMode === "supabase") {
    const url = req(env, "COMPANY_BRAIN_SUPABASE_URL");
    const serviceRoleKey = req(env, "COMPANY_BRAIN_SUPABASE_SERVICE_ROLE_KEY");
    const projectRef = req(env, "COMPANY_BRAIN_SUPABASE_PROJECT_REF").toLowerCase();
    const fromUrl = projectRefFromUrl(url);
    if (!fromUrl || fromUrl !== projectRef) {
      throw new CompanyBrainConfigError(
        "COMPANY_BRAIN_SUPABASE_URL does not match COMPANY_BRAIN_SUPABASE_PROJECT_REF",
      );
    }
    supabase = { url, serviceRoleKey, projectRef };
  }

  return {
    storeMode,
    cutoverAt,
    supabase,
    github: {
      allowedRepos,
      allowedInstallationIds,
      webhookSecret,
    },
    tokens: {
      ingest,
      agent,
      founders: { jack, eric },
    },
  };
}

export type ResolvedActor =
  | { ok: true; actor: import("./types.js").Actor }
  | { ok: false };

export function resolveActorFromToken(
  config: CompanyBrainConfig,
  token: string | undefined,
): ResolvedActor {
  if (!token) return { ok: false };
  const equals = (expected: string): boolean => {
    const received = Buffer.from(token, "utf8");
    const wanted = Buffer.from(expected, "utf8");
    return received.length === wanted.length && timingSafeEqual(received, wanted);
  };
  if (equals(config.tokens.ingest)) {
    return {
      ok: true,
      actor: { id: "ingest", kind: "ingest", displayName: "GitHub ingest" },
    };
  }
  if (equals(config.tokens.agent)) {
    return {
      ok: true,
      actor: { id: "agent", kind: "agent", displayName: "Company Brain agent" },
    };
  }
  if (equals(config.tokens.founders.jack)) {
    return {
      ok: true,
      actor: {
        id: "jack",
        kind: "founder",
        displayName: "Jack",
        founderKey: "jack",
      },
    };
  }
  if (equals(config.tokens.founders.eric)) {
    return {
      ok: true,
      actor: {
        id: "eric",
        kind: "founder",
        displayName: "Eric",
        founderKey: "eric",
      },
    };
  }
  return { ok: false };
}
