import type {
  GhCommit,
  GhIssue,
  GhPull,
  GhRepo,
} from "./client.js";

export type GithubEnvelopeKind =
  | "github_repo"
  | "github_issue"
  | "github_pr"
  | "github_commit";

export interface GithubRepoSummary {
  fullName: string;
  name: string;
  private: boolean;
  description?: string | null;
  htmlUrl: string;
  language?: string | null;
  updatedAt?: string;
  pushedAt?: string | null;
  occurredAt?: string;
}

export interface GithubIssueSummary {
  repoFullName: string;
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  updatedAt: string;
  occurredAt?: string;
}

export interface GithubPrSummary {
  repoFullName: string;
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  htmlUrl: string;
  updatedAt: string;
  occurredAt?: string;
}

export interface GithubCommitSummary {
  repoFullName: string;
  sha: string;
  messagePreview: string;
  htmlUrl: string;
  authorLogin?: string;
  occurredAt?: string;
}

export interface GithubRepoBody {
  kind: "github_repo";
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  description?: string | null;
  htmlUrl: string;
  defaultBranch?: string;
  language?: string | null;
  fork: boolean;
  archived?: boolean;
  pushedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  ownerLogin?: string;
  topics?: string[];
  stargazersCount?: number;
  forksCount?: number;
  openIssuesCount?: number;
  visibility?: string;
}

export interface GithubIssueBody {
  kind: "github_issue";
  id: number;
  repoFullName: string;
  number: number;
  title: string;
  state: string;
  body?: string | null;
  htmlUrl: string;
  userLogin?: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  comments?: number;
}

export interface GithubPrBody {
  kind: "github_pr";
  id: number;
  repoFullName: string;
  number: number;
  title: string;
  state: string;
  body?: string | null;
  htmlUrl: string;
  userLogin?: string;
  draft?: boolean;
  mergedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  headRef?: string;
  headSha?: string;
  baseRef?: string;
  baseSha?: string;
  labels: string[];
}

export interface GithubCommitBody {
  kind: "github_commit";
  sha: string;
  repoFullName: string;
  htmlUrl: string;
  message: string;
  authorLogin?: string;
  authorName?: string;
  authorEmail?: string;
  authoredAt?: string;
  committerLogin?: string;
  parentShas: string[];
}

function labelNames(
  labels: Array<string | { name?: string }> | undefined,
): string[] {
  if (!labels) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : l.name ?? ""))
    .filter(Boolean);
}

/** Idempotency: `repo:{full_name}` */
export function repoSourceRecordId(fullName: string): string {
  return `repo:${fullName}`;
}

/** Idempotency: `issue:{full_name}#{number}` */
export function issueSourceRecordId(
  repoFullName: string,
  number: number,
): string {
  return `issue:${repoFullName}#${number}`;
}

/** Idempotency: `pr:{full_name}#{number}` */
export function prSourceRecordId(
  repoFullName: string,
  number: number,
): string {
  return `pr:${repoFullName}#${number}`;
}

/** Idempotency: `commit:{full_name}@{sha}` */
export function commitSourceRecordId(
  repoFullName: string,
  sha: string,
): string {
  return `commit:${repoFullName}@${sha}`;
}

export function mapRepo(repo: GhRepo): {
  sourceRecordId: string;
  body: GithubRepoBody;
  summary: GithubRepoSummary;
} {
  const body: GithubRepoBody = {
    kind: "github_repo",
    id: repo.id,
    fullName: repo.full_name,
    name: repo.name,
    private: repo.private,
    description: repo.description,
    htmlUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    language: repo.language,
    fork: repo.fork,
    archived: repo.archived,
    pushedAt: repo.pushed_at,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    ownerLogin: repo.owner?.login,
    topics: repo.topics,
    stargazersCount: repo.stargazers_count,
    forksCount: repo.forks_count,
    openIssuesCount: repo.open_issues_count,
    visibility: repo.visibility,
  };
  const summary: GithubRepoSummary = {
    fullName: repo.full_name,
    name: repo.name,
    private: repo.private,
    description: repo.description,
    htmlUrl: repo.html_url,
    language: repo.language,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    occurredAt: repo.updated_at ?? repo.pushed_at ?? repo.created_at,
  };
  return {
    sourceRecordId: repoSourceRecordId(repo.full_name),
    body,
    summary,
  };
}

export function mapIssue(
  repoFullName: string,
  issue: GhIssue,
): {
  sourceRecordId: string;
  body: GithubIssueBody;
  summary: GithubIssueSummary;
} {
  const body: GithubIssueBody = {
    kind: "github_issue",
    id: issue.id,
    repoFullName,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body,
    htmlUrl: issue.html_url,
    userLogin: issue.user?.login,
    labels: labelNames(issue.labels),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    comments: issue.comments,
  };
  const summary: GithubIssueSummary = {
    repoFullName,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    htmlUrl: issue.html_url,
    updatedAt: issue.updated_at,
    occurredAt: issue.updated_at ?? issue.created_at,
  };
  return {
    sourceRecordId: issueSourceRecordId(repoFullName, issue.number),
    body,
    summary,
  };
}

export function mapPull(
  repoFullName: string,
  pr: GhPull,
): {
  sourceRecordId: string;
  body: GithubPrBody;
  summary: GithubPrSummary;
} {
  const body: GithubPrBody = {
    kind: "github_pr",
    id: pr.id,
    repoFullName,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    body: pr.body,
    htmlUrl: pr.html_url,
    userLogin: pr.user?.login,
    draft: pr.draft,
    mergedAt: pr.merged_at,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    closedAt: pr.closed_at,
    headRef: pr.head?.ref,
    headSha: pr.head?.sha,
    baseRef: pr.base?.ref,
    baseSha: pr.base?.sha,
    labels: labelNames(pr.labels),
  };
  const summary: GithubPrSummary = {
    repoFullName,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    htmlUrl: pr.html_url,
    updatedAt: pr.updated_at,
    occurredAt: pr.updated_at ?? pr.created_at,
  };
  return {
    sourceRecordId: prSourceRecordId(repoFullName, pr.number),
    body,
    summary,
  };
}

export function mapCommit(
  repoFullName: string,
  commit: GhCommit,
): {
  sourceRecordId: string;
  body: GithubCommitBody;
  summary: GithubCommitSummary;
} {
  const message = commit.commit.message ?? "";
  const body: GithubCommitBody = {
    kind: "github_commit",
    sha: commit.sha,
    repoFullName,
    htmlUrl: commit.html_url,
    message,
    authorLogin: commit.author?.login,
    authorName: commit.commit.author?.name,
    authorEmail: commit.commit.author?.email,
    authoredAt: commit.commit.author?.date,
    committerLogin: commit.committer?.login,
    parentShas: (commit.parents ?? []).map((p) => p.sha),
  };
  const summary: GithubCommitSummary = {
    repoFullName,
    sha: commit.sha,
    messagePreview: message.split("\n")[0]?.slice(0, 80) ?? "",
    htmlUrl: commit.html_url,
    authorLogin: commit.author?.login,
    occurredAt: commit.commit.author?.date,
  };
  return {
    sourceRecordId: commitSourceRecordId(repoFullName, commit.sha),
    body,
    summary,
  };
}

export function parseOwnerRepo(fullName: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo, ...rest] = fullName.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid repo full_name: ${fullName}`);
  }
  return { owner, repo };
}

/** Filter PR-shaped rows out of the Issues API (GitHub includes PRs there). */
export function isPureIssue(issue: GhIssue): boolean {
  return !issue.pull_request;
}

/** Client-side filter when pulls API has no `since` (compare updated_at). */
export function isUpdatedSince(
  updatedAt: string | undefined,
  since: string | undefined,
): boolean {
  if (!since) return true;
  if (!updatedAt) return true;
  return Date.parse(updatedAt) >= Date.parse(since);
}
