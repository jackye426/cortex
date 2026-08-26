import { createHmac, timingSafeEqual } from "node:crypto";
import type { CompanyBrainConfig } from "./env.js";
import { assertGithubScope, normalizeRepo } from "./policy.js";

export const GITHUB_EVENTS = new Set([
  "pull_request",
  "pull_request_review",
  "issues",
  "check_run",
  "check_suite",
  "workflow_run",
  "deployment",
  "deployment_status",
]);

export interface GithubMappedEvent {
  externalEventId: string;
  entityKey: string;
  versionKey: string;
  repoFullName: string;
  sourceActionAt: string;
  payload: Record<string, unknown>;
  classification: "hard_fact" | "observation";
  statement: string;
  stateKey: string;
  epistemicClass: "fact" | "observation";
  autoApply: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret) return false;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length).trim();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(received, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  return verifySignature(rawBody, signatureHeader, secret);
}

function repoFromPayload(payload: Record<string, unknown>): string | undefined {
  const repo = payload.repository;
  if (!isRecord(repo)) return undefined;
  return str(repo.full_name);
}

function installationId(payload: Record<string, unknown>): string | undefined {
  const installation = payload.installation;
  if (!isRecord(installation)) return undefined;
  const id = installation.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : undefined;
}

export function mapGithubWebhook(input: {
  config: CompanyBrainConfig;
  eventName: string;
  deliveryId: string | undefined;
  rawBody: string;
  signatureHeader: string | undefined;
  payload: unknown;
}):
  | { ok: true; mapped: GithubMappedEvent }
  | {
      ok: false;
      code:
        | "unsigned"
        | "bad_signature"
        | "out_of_scope"
        | "pre_cutover"
        | "missing_timestamp"
        | "unsupported";
      detail: string;
    } {
  if (!input.config.github.webhookSecret) {
    return { ok: false, code: "unsigned", detail: "webhook secret is required" };
  }
  if (!input.signatureHeader) {
    return { ok: false, code: "unsigned", detail: "X-Hub-Signature-256 missing" };
  }
  if (
    !verifySignature(
      input.rawBody,
      input.signatureHeader,
      input.config.github.webhookSecret,
    )
  ) {
    return { ok: false, code: "bad_signature", detail: "signature mismatch" };
  }
  if (!input.deliveryId) {
    return { ok: false, code: "unsupported", detail: "X-GitHub-Delivery missing" };
  }
  if (!GITHUB_EVENTS.has(input.eventName)) {
    return {
      ok: false,
      code: "unsupported",
      detail: `event ${input.eventName} is not ingested`,
    };
  }
  if (!isRecord(input.payload)) {
    return { ok: false, code: "unsupported", detail: "payload is not an object" };
  }

  const repoFullName = repoFromPayload(input.payload);
  const mapped = mapEvent(input.eventName, input.deliveryId, input.payload);
  if (!mapped) {
    return {
      ok: false,
      code: "unsupported",
      detail: `event ${input.eventName} had no admissible body`,
    };
  }

  const scope = assertGithubScope(input.config, {
    repoFullName,
    installationId: installationId(input.payload),
    sourceActionAt: mapped.sourceActionAt,
  });
  if (!scope.ok) {
    return { ok: false, code: scope.code, detail: scope.detail };
  }

  const repo = normalizeRepo(repoFullName) ?? "unknown/unknown";
  return {
    ok: true,
    mapped: {
      ...mapped,
      repoFullName: repo,
    },
  };
}

function mapEvent(
  eventName: string,
  deliveryId: string,
  payload: Record<string, unknown>,
): Omit<GithubMappedEvent, "repoFullName"> | null {
  const action = str(payload.action) ?? "unknown";
  const repo = str(isRecord(payload.repository) ? payload.repository.full_name : undefined);

  if (eventName === "pull_request") {
    const pr = isRecord(payload.pull_request) ? payload.pull_request : null;
    if (!pr) return null;
    const number = typeof pr.number === "number" ? pr.number : null;
    if (number == null || !repo) return null;
    const merged =
      pr.merged === true ||
      (action === "closed" && Boolean(str(pr.merged_at)));
    const sourceActionAt =
      (merged ? str(pr.merged_at) : str(pr.updated_at) ?? str(pr.created_at)) ?? "";
    const title = str(pr.title) ?? "";
    const entityKey = `pr:${repo.toLowerCase()}#${number}`;
    if (merged) {
      return {
        externalEventId: deliveryId,
        entityKey,
        versionKey: `merged:${str(pr.merged_at) ?? deliveryId}`,
        sourceActionAt,
        payload: { kind: "github_pr", action, repo, number, title, merged: true, pr },
        classification: "hard_fact",
        statement: `PR #${number} merged in ${repo}: ${title}`,
        stateKey: `github.pr.${repo.toLowerCase().replace("/", ".")}.${number}`,
        epistemicClass: "fact",
        autoApply: true,
      };
    }
    return {
      externalEventId: deliveryId,
      entityKey,
      versionKey: `${action}:${str(pr.updated_at) ?? deliveryId}`,
      sourceActionAt,
      payload: { kind: "github_pr", action, repo, number, title, merged: false, pr },
      classification: "observation",
      statement: `PR #${number} ${action} in ${repo}: ${title}`,
      stateKey: `engineering.working_on`,
      epistemicClass: "observation",
      autoApply: false,
    };
  }

  if (eventName === "pull_request_review") {
    const review = isRecord(payload.review) ? payload.review : null;
    const pr = isRecord(payload.pull_request) ? payload.pull_request : null;
    const number = pr && typeof pr.number === "number" ? pr.number : null;
    if (!review || number == null || !repo) return null;
    const sourceActionAt = str(review.submitted_at) ?? str(review.updated_at) ?? "";
    return {
      externalEventId: deliveryId,
      entityKey: `pr-review:${repo.toLowerCase()}#${number}:${str(review.id) ?? deliveryId}`,
      versionKey: deliveryId,
      sourceActionAt,
      payload: { kind: "github_pr_review", action, repo, number, review },
      classification: "observation",
      statement: `PR #${number} review ${str(review.state) ?? action} in ${repo}`,
      stateKey: `github.pr.${repo.toLowerCase().replace("/", ".")}.${number}`,
      epistemicClass: "observation",
      autoApply: false,
    };
  }

  if (eventName === "issues") {
    const issue = isRecord(payload.issue) ? payload.issue : null;
    if (!issue || issue.pull_request || !repo) return null;
    const number = typeof issue.number === "number" ? issue.number : null;
    if (number == null) return null;
    const sourceActionAt = str(issue.updated_at) ?? str(issue.created_at) ?? "";
    return {
      externalEventId: deliveryId,
      entityKey: `issue:${repo.toLowerCase()}#${number}`,
      versionKey: `${action}:${str(issue.updated_at) ?? deliveryId}`,
      sourceActionAt,
      payload: { kind: "github_issue", action, repo, number, issue },
      classification: "observation",
      statement: `Issue #${number} ${action} in ${repo}: ${str(issue.title) ?? ""}`,
      stateKey: `github.issue.${repo.toLowerCase().replace("/", ".")}.${number}`,
      epistemicClass: "observation",
      autoApply: false,
    };
  }

  if (eventName === "check_run" || eventName === "check_suite" || eventName === "workflow_run") {
    const node =
      (isRecord(payload.check_run) && payload.check_run) ||
      (isRecord(payload.check_suite) && payload.check_suite) ||
      (isRecord(payload.workflow_run) && payload.workflow_run) ||
      null;
    if (!node || !repo) return null;
    const sourceActionAt =
      str(node.completed_at) ?? str(node.updated_at) ?? str(node.started_at) ?? "";
    const conclusion = str(node.conclusion) ?? str(node.status) ?? action;
    return {
      externalEventId: deliveryId,
      entityKey: `ci:${repo.toLowerCase()}:${str(node.id) ?? deliveryId}`,
      versionKey: deliveryId,
      sourceActionAt,
      payload: { kind: `github_${eventName}`, action, repo, node },
      classification: "observation",
      statement: `CI ${eventName} ${conclusion} in ${repo}`,
      stateKey: `github.ci.${repo.toLowerCase().replace("/", ".")}`,
      epistemicClass: "observation",
      autoApply: false,
    };
  }

  if (eventName === "deployment" || eventName === "deployment_status") {
    const deployment = isRecord(payload.deployment) ? payload.deployment : payload;
    if (!isRecord(deployment) || !repo) return null;
    const sourceActionAt =
      str(deployment.updated_at) ?? str(deployment.created_at) ?? "";
    return {
      externalEventId: deliveryId,
      entityKey: `deploy:${repo.toLowerCase()}:${str(deployment.id) ?? deliveryId}`,
      versionKey: deliveryId,
      sourceActionAt,
      payload: { kind: `github_${eventName}`, action, repo, deployment },
      classification: "observation",
      statement: `Deployment ${eventName} in ${repo}`,
      stateKey: `github.deploy.${repo.toLowerCase().replace("/", ".")}`,
      epistemicClass: "observation",
      autoApply: false,
    };
  }

  return null;
}
