/**
 * Map GitHub webhook events → Cortex RawEnvelope stubs (work-history only).
 * Ignores notifications / discussions / copilot-related events.
 */

import type { RawEnvelope } from "@cortex/core";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function repoFullName(payload: Record<string, unknown>): string | undefined {
  const repo = payload.repository;
  if (!isRecord(repo)) return undefined;
  return str(repo.full_name);
}

/** Events Cortex accepts for work-history ingest. */
export const GITHUB_WEBHOOK_EVENTS = new Set([
  "ping",
  "push",
  "issues",
  "pull_request",
  "repository",
  "create", // branch/tag — metadata only via push preferred; still accept
]);

export function mapGithubWebhookToEnvelopes(
  event: string,
  deliveryId: string | undefined,
  payload: unknown,
): RawEnvelope[] {
  if (!GITHUB_WEBHOOK_EVENTS.has(event)) {
    return [];
  }

  if (!isRecord(payload)) return [];

  if (event === "ping") {
    return [
      {
        source: "github",
        sourceRecordId: `webhook:ping:${deliveryId ?? "unknown"}`,
        occurredAt: new Date().toISOString(),
        mimeType: "application/json",
        body: {
          kind: "github_webhook_ping",
          zen: str(payload.zen),
          hookId: isRecord(payload.hook) ? payload.hook.id : null,
        },
        provenance: {
          collector: "api-github-webhook",
          extra: { event, deliveryId },
        },
      },
    ];
  }

  const fullName = repoFullName(payload);

  if (event === "repository") {
    const repo = isRecord(payload.repository) ? payload.repository : null;
    if (!repo || !fullName) return [];
    const action = str(payload.action) ?? "unknown";
    return [
      {
        source: "github",
        sourceRecordId: `repo:${fullName}`,
        occurredAt: str(repo.updated_at) ?? new Date().toISOString(),
        mimeType: "application/json",
        body: {
          kind: "github_repo",
          id: num(repo.id),
          fullName,
          name: str(repo.name),
          private: repo.private === true,
          description: str(repo.description) ?? null,
          htmlUrl: str(repo.html_url) ?? "",
          defaultBranch: str(repo.default_branch),
          language: str(repo.language) ?? null,
          fork: repo.fork === true,
          archived: repo.archived === true,
          pushedAt: str(repo.pushed_at) ?? null,
          createdAt: str(repo.created_at),
          updatedAt: str(repo.updated_at),
          ownerLogin: isRecord(repo.owner) ? str(repo.owner.login) : undefined,
          webhookAction: action,
        },
        provenance: {
          collector: "api-github-webhook",
          workspace: fullName,
          extra: {
            event,
            deliveryId,
            action,
            summary: {
              fullName,
              name: str(repo.name),
              private: repo.private === true,
              htmlUrl: str(repo.html_url),
              occurredAt: str(repo.updated_at),
            },
          },
        },
      },
    ];
  }

  if (event === "issues") {
    const issue = isRecord(payload.issue) ? payload.issue : null;
    if (!issue || !fullName) return [];
    // Skip PR-linked issue payloads
    if (issue.pull_request) return [];
    const number = num(issue.number);
    if (number == null) return [];
    const action = str(payload.action) ?? "unknown";
    return [
      {
        source: "github",
        sourceRecordId: `issue:${fullName}#${number}`,
        occurredAt: str(issue.updated_at) ?? new Date().toISOString(),
        mimeType: "application/json",
        body: {
          kind: "github_issue",
          id: num(issue.id),
          repoFullName: fullName,
          number,
          title: str(issue.title) ?? "",
          state: str(issue.state) ?? "",
          body: str(issue.body) ?? null,
          htmlUrl: str(issue.html_url) ?? "",
          userLogin: isRecord(issue.user) ? str(issue.user.login) : undefined,
          labels: Array.isArray(issue.labels)
            ? issue.labels
                .map((l) =>
                  typeof l === "string"
                    ? l
                    : isRecord(l)
                      ? str(l.name) ?? ""
                      : "",
                )
                .filter(Boolean)
            : [],
          createdAt: str(issue.created_at) ?? "",
          updatedAt: str(issue.updated_at) ?? "",
          closedAt: str(issue.closed_at) ?? null,
          webhookAction: action,
        },
        provenance: {
          collector: "api-github-webhook",
          workspace: fullName,
          extra: {
            event,
            deliveryId,
            action,
            summary: {
              repoFullName: fullName,
              number,
              title: str(issue.title),
              state: str(issue.state),
              htmlUrl: str(issue.html_url),
              updatedAt: str(issue.updated_at),
              occurredAt: str(issue.updated_at),
            },
          },
        },
      },
    ];
  }

  if (event === "pull_request") {
    const pr = isRecord(payload.pull_request) ? payload.pull_request : null;
    if (!pr || !fullName) return [];
    const number = num(pr.number);
    if (number == null) return [];
    const action = str(payload.action) ?? "unknown";
    const head = isRecord(pr.head) ? pr.head : null;
    const base = isRecord(pr.base) ? pr.base : null;
    return [
      {
        source: "github",
        sourceRecordId: `pr:${fullName}#${number}`,
        occurredAt: str(pr.updated_at) ?? new Date().toISOString(),
        mimeType: "application/json",
        body: {
          kind: "github_pr",
          id: num(pr.id),
          repoFullName: fullName,
          number,
          title: str(pr.title) ?? "",
          state: str(pr.state) ?? "",
          body: str(pr.body) ?? null,
          htmlUrl: str(pr.html_url) ?? "",
          userLogin: isRecord(pr.user) ? str(pr.user.login) : undefined,
          draft: pr.draft === true,
          mergedAt: str(pr.merged_at) ?? null,
          createdAt: str(pr.created_at) ?? "",
          updatedAt: str(pr.updated_at) ?? "",
          closedAt: str(pr.closed_at) ?? null,
          headRef: head ? str(head.ref) : undefined,
          headSha: head ? str(head.sha) : undefined,
          baseRef: base ? str(base.ref) : undefined,
          baseSha: base ? str(base.sha) : undefined,
          labels: Array.isArray(pr.labels)
            ? pr.labels
                .map((l) => (isRecord(l) ? str(l.name) ?? "" : ""))
                .filter(Boolean)
            : [],
          webhookAction: action,
        },
        provenance: {
          collector: "api-github-webhook",
          workspace: fullName,
          extra: {
            event,
            deliveryId,
            action,
            summary: {
              repoFullName: fullName,
              number,
              title: str(pr.title),
              state: str(pr.state),
              draft: pr.draft === true,
              htmlUrl: str(pr.html_url),
              updatedAt: str(pr.updated_at),
              occurredAt: str(pr.updated_at),
            },
          },
        },
      },
    ];
  }

  if (event === "push") {
    if (!fullName) return [];
    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    const envelopes: RawEnvelope[] = [];
    for (const c of commits) {
      if (!isRecord(c)) continue;
      const sha = str(c.id) ?? str(c.sha);
      if (!sha) continue;
      const message = str(c.message) ?? "";
      const author = isRecord(c.author) ? c.author : null;
      envelopes.push({
        source: "github",
        sourceRecordId: `commit:${fullName}@${sha}`,
        occurredAt: str(c.timestamp) ?? new Date().toISOString(),
        mimeType: "application/json",
        body: {
          kind: "github_commit",
          sha,
          repoFullName: fullName,
          htmlUrl: str(c.url) ?? `https://github.com/${fullName}/commit/${sha}`,
          message,
          authorName: author ? str(author.name) : undefined,
          authorEmail: author ? str(author.email) : undefined,
          authoredAt: str(c.timestamp),
          parentShas: str(payload.before) ? [String(payload.before)] : [],
          webhookRef: str(payload.ref),
        },
        provenance: {
          collector: "api-github-webhook",
          workspace: fullName,
          extra: {
            event,
            deliveryId,
            summary: {
              repoFullName: fullName,
              sha,
              messagePreview: message.split("\n")[0]?.slice(0, 80) ?? "",
              htmlUrl:
                str(c.url) ?? `https://github.com/${fullName}/commit/${sha}`,
              occurredAt: str(c.timestamp),
            },
          },
        },
      });
    }
    return envelopes;
  }

  // create (branch/tag) — light metadata only
  if (event === "create" && fullName) {
    const ref = str(payload.ref);
    const refType = str(payload.ref_type);
    return [
      {
        source: "github",
        sourceRecordId: `webhook:create:${fullName}:${refType ?? "ref"}:${ref ?? "unknown"}`,
        occurredAt: new Date().toISOString(),
        mimeType: "application/json",
        body: {
          kind: "github_webhook_create",
          repoFullName: fullName,
          ref,
          refType,
          masterBranch: str(payload.master_branch),
        },
        provenance: {
          collector: "api-github-webhook",
          workspace: fullName,
          extra: { event, deliveryId },
        },
      },
    ];
  }

  return [];
}
