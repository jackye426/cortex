import type { CompanyBrainConfig } from "./env.js";

export type ScopeDecision =
  | { ok: true }
  | {
      ok: false;
      code: "out_of_scope" | "pre_cutover" | "missing_timestamp";
      detail: string;
    };

export function parseIso(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeRepo(fullName: string | undefined): string | null {
  if (!fullName) return null;
  const normalized = fullName.trim().toLowerCase();
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(normalized) ? normalized : null;
}

export function assertGithubScope(
  config: CompanyBrainConfig,
  input: {
    repoFullName?: string;
    installationId?: string | number;
    sourceActionAt?: string | null;
  },
): ScopeDecision {
  const repo = normalizeRepo(input.repoFullName);
  if (!repo || !config.github.allowedRepos.includes(repo)) {
    return {
      ok: false,
      code: "out_of_scope",
      detail: `repository ${input.repoFullName ?? "(missing)"} is not allowlisted`,
    };
  }

  if (config.github.allowedInstallationIds.length > 0) {
    const installationId = String(input.installationId ?? "");
    if (!config.github.allowedInstallationIds.includes(installationId)) {
      return {
        ok: false,
        code: "out_of_scope",
        detail: `installation ${installationId || "(missing)"} is not allowlisted`,
      };
    }
  }

  const actionAt = parseIso(input.sourceActionAt ?? undefined);
  if (!actionAt) {
    return {
      ok: false,
      code: "missing_timestamp",
      detail: "source action time is required",
    };
  }
  if (actionAt.getTime() < config.cutoverAt.getTime()) {
    return {
      ok: false,
      code: "pre_cutover",
      detail: `source action ${actionAt.toISOString()} is before cutover ${config.cutoverAt.toISOString()}`,
    };
  }
  return { ok: true };
}
