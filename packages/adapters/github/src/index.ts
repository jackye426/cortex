import { hostname } from "node:os";
import type {
  AdapterPage,
  GithubSyncCheckpointCursor,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import {
  etagKey,
  emptyGithubCursor,
  parseGithubCursor,
  serializeGithubCursor,
  toSyncCheckpoint,
} from "./checkpoint.js";
import {
  GithubAuthError,
  GithubClient,
  resolveGithubToken,
  type GhRepo,
} from "./client.js";
import {
  isPureIssue,
  isUpdatedSince,
  mapCommit,
  mapIssue,
  mapPull,
  mapRepo,
  parseOwnerRepo,
} from "./map.js";

export type {
  GithubCommitBody,
  GithubCommitSummary,
  GithubEnvelopeKind,
  GithubIssueBody,
  GithubIssueSummary,
  GithubPrBody,
  GithubPrSummary,
  GithubRepoBody,
  GithubRepoSummary,
} from "./map.js";
export {
  commitSourceRecordId,
  issueSourceRecordId,
  mapCommit,
  mapIssue,
  mapPull,
  mapRepo,
  prSourceRecordId,
  repoSourceRecordId,
} from "./map.js";
export {
  emptyGithubCursor,
  parseGithubCursor,
  serializeGithubCursor,
  toSyncCheckpoint,
} from "./checkpoint.js";
export {
  GithubApiError,
  GithubAuthError,
  GithubClient,
  resolveGithubToken,
} from "./client.js";

export interface GithubAdapterOptions {
  /** Explicit token; defaults to `process.env.GITHUB_TOKEN`. */
  token?: string;
  /** GitHub API base (GHES). */
  baseUrl?: string;
  pageSize?: number;
  /** Hard cap on envelopes (dry-run / smoke). */
  limit?: number;
  /** Max repos to scan for issues/PRs/commits (after listing). */
  maxRepos?: number;
  /** Include commit history (can be large). Default true. */
  includeCommits?: boolean;
  /** Include issues. Default true. */
  includeIssues?: boolean;
  /** Include pull requests. Default true. */
  includePulls?: boolean;
  /** ISO-8601 lower bound for issues/commits (+ PR updated_at filter). */
  since?: string;
  collectorName?: string;
}

/**
 * GitHub work-history adapter.
 * Scope: repos, issues, PRs, commits (+ metadata). No notifications,
 * Discussions, or Copilot.
 */
export class GithubAdapter implements SourceAdapter {
  readonly source = "github" as const;

  private readonly token: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly maxRepos: number | undefined;
  private readonly includeCommits: boolean;
  private readonly includeIssues: boolean;
  private readonly includePulls: boolean;
  private readonly since: string | undefined;
  private readonly collectorName: string;
  private client: GithubClient | null = null;
  private loginCache: string | null = null;

  constructor(options: GithubAdapterOptions = {}) {
    this.token = resolveGithubToken(options.token);
    this.baseUrl = options.baseUrl ?? process.env.GITHUB_API_BASE;
    this.pageSize = options.pageSize ?? 50;
    this.limit = options.limit;
    this.maxRepos = options.maxRepos;
    this.includeCommits = options.includeCommits !== false;
    this.includeIssues = options.includeIssues !== false;
    this.includePulls = options.includePulls !== false;
    this.since = options.since;
    this.collectorName = options.collectorName ?? "adapter-github";
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.token) {
      return {
        ok: false,
        detail:
          "GITHUB_TOKEN is not set. Create a fine-grained PAT (docs/github.md) and set GITHUB_TOKEN in .env",
      };
    }
    try {
      const client = this.getClient();
      const user = await client.getAuthenticatedUser();
      this.loginCache = user.login;
      return {
        ok: true,
        detail: `authenticated as ${user.login}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: msg };
    }
  }

  /**
   * One logical API page: repos page, or one issues/pulls/commits page for
   * the current repo. Cursor is a `GithubSyncCheckpointCursor` JSON string.
   */
  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    const client = this.getClient();
    const login = await this.ensureLogin(client);
    let state = parseGithubCursor(checkpoint);
    if (this.since && !state.since) state.since = this.since;
    state.login = login;

    if (state.phase === "done") {
      return { items: [], nextCursor: null, hasMore: false };
    }

    if (state.phase === "repos") {
      return this.fetchReposPage(client, state, login);
    }

    if (!state.currentRepo) {
      state = this.advanceToNextRepoOrDone(state);
      if (state.phase === "done") {
        return {
          items: [],
          nextCursor: null,
          hasMore: false,
        };
      }
    }

    if (state.phase === "issues") {
      return this.fetchIssuesPage(client, state, login);
    }
    if (state.phase === "pulls") {
      return this.fetchPullsPage(client, state, login);
    }
    if (state.phase === "commits") {
      return this.fetchCommitsPage(client, state, login);
    }

    return { items: [], nextCursor: null, hasMore: false };
  }

  /** Full backfill respecting limit / maxRepos. */
  async backfillAll(): Promise<RawEnvelope[]> {
    const out: RawEnvelope[] = [];
    let checkpoint: SyncCheckpoint | undefined = toSyncCheckpoint(
      emptyGithubCursor(this.since),
      "pending",
    );

    while (true) {
      const page = await this.fetchPage(checkpoint);
      for (const item of page.items) {
        out.push(item);
        if (this.limit != null && out.length >= this.limit) {
          return out;
        }
      }
      if (!page.hasMore || !page.nextCursor) break;
      const prev = parseGithubCursor(checkpoint);
      checkpoint = {
        source: "github",
        accountKey: prev.login ?? "github",
        cursor: page.nextCursor,
        updatedAt: new Date().toISOString(),
        metadata: { since: prev.since },
      };
    }

    return out;
  }

  /** Build a SyncCheckpoint snapshot from the latest cursor string. */
  checkpointFromCursor(
    cursor: string,
    accountKey: string,
  ): SyncCheckpoint {
    return {
      source: "github",
      accountKey,
      cursor,
      updatedAt: new Date().toISOString(),
      metadata: parseGithubCursor({
        source: "github",
        accountKey,
        cursor,
        updatedAt: new Date().toISOString(),
      }).since
        ? {
            since: parseGithubCursor({
              source: "github",
              accountKey,
              cursor,
              updatedAt: new Date().toISOString(),
            }).since,
          }
        : undefined,
    };
  }

  private getClient(): GithubClient {
    if (!this.token) {
      throw new GithubAuthError(
        "GITHUB_TOKEN is not set. Create a fine-grained PAT (see docs/github.md) and set GITHUB_TOKEN in .env",
      );
    }
    if (!this.client) {
      this.client = new GithubClient({
        token: this.token,
        baseUrl: this.baseUrl,
      });
    }
    return this.client;
  }

  private async ensureLogin(client: GithubClient): Promise<string> {
    if (this.loginCache) return this.loginCache;
    const user = await client.getAuthenticatedUser();
    this.loginCache = user.login;
    return user.login;
  }

  private async fetchReposPage(
    client: GithubClient,
    state: GithubSyncCheckpointCursor,
    login: string,
  ): Promise<AdapterPage> {
    const key = etagKey("repos");
    const res = await client.listUserRepos({
      page: state.page,
      perPage: this.pageSize,
      etag: state.etags?.[key],
    });

    const etags = { ...(state.etags ?? {}) };
    if (res.etag) etags[key] = res.etag;

    if (res.notModified) {
      // Nothing new on this page — jump to processing queued repos or finish.
      const next = this.afterReposList(state, [], etags, false);
      return {
        items: [],
        nextCursor:
          next.phase === "done" ? null : serializeGithubCursor(next),
        hasMore: next.phase !== "done",
      };
    }

    const repos = res.data ?? [];
    let queue = [...(state.repoQueue ?? [])];
    for (const r of repos) {
      queue.push(r.full_name);
    }
    if (this.maxRepos != null && queue.length > this.maxRepos) {
      queue = queue.slice(0, this.maxRepos);
    }

    const items = repos.map((r) => this.envelopeRepo(r, login));
    const hasMorePages = Boolean(res.linkNext) || repos.length >= this.pageSize;

    if (hasMorePages && (this.maxRepos == null || queue.length < this.maxRepos)) {
      const next: GithubSyncCheckpointCursor = {
        ...state,
        phase: "repos",
        page: state.page + 1,
        repoQueue: queue,
        etags,
        login,
      };
      return {
        items,
        nextCursor: serializeGithubCursor(next),
        hasMore: true,
      };
    }

    const next = this.afterReposList(state, queue, etags, true);
    return {
      items,
      nextCursor: next.phase === "done" ? null : serializeGithubCursor(next),
      hasMore: next.phase !== "done",
    };
  }

  private afterReposList(
    state: GithubSyncCheckpointCursor,
    queue: string[],
    etags: Record<string, string>,
    mergeQueue: boolean,
  ): GithubSyncCheckpointCursor {
    const repoQueue = mergeQueue
      ? queue
      : [...(state.repoQueue ?? []), ...queue];
    const capped =
      this.maxRepos != null ? repoQueue.slice(0, this.maxRepos) : repoQueue;

    if (capped.length === 0) {
      return { ...state, phase: "done", page: 1, repoQueue: [], etags };
    }

    const [currentRepo, ...rest] = capped;
    const nextPhase = this.firstItemPhase();
    if (!nextPhase) {
      return { ...state, phase: "done", page: 1, repoQueue: [], etags };
    }

    return {
      ...state,
      phase: nextPhase,
      page: 1,
      currentRepo,
      repoQueue: rest,
      etags,
    };
  }

  private firstItemPhase():
    | "issues"
    | "pulls"
    | "commits"
    | null {
    if (this.includeIssues) return "issues";
    if (this.includePulls) return "pulls";
    if (this.includeCommits) return "commits";
    return null;
  }

  private nextPhaseAfter(
    phase: "issues" | "pulls" | "commits",
  ): "issues" | "pulls" | "commits" | "next_repo" {
    if (phase === "issues") {
      if (this.includePulls) return "pulls";
      if (this.includeCommits) return "commits";
      return "next_repo";
    }
    if (phase === "pulls") {
      if (this.includeCommits) return "commits";
      return "next_repo";
    }
    return "next_repo";
  }

  private advanceToNextRepoOrDone(
    state: GithubSyncCheckpointCursor,
  ): GithubSyncCheckpointCursor {
    const queue = [...(state.repoQueue ?? [])];
    if (queue.length === 0) {
      return { ...state, phase: "done", currentRepo: undefined, page: 1 };
    }
    const [currentRepo, ...rest] = queue;
    const phase = this.firstItemPhase();
    if (!phase) {
      return { ...state, phase: "done", currentRepo: undefined, page: 1 };
    }
    return {
      ...state,
      phase,
      page: 1,
      currentRepo,
      repoQueue: rest,
    };
  }

  private advanceAfterRepoResource(
    state: GithubSyncCheckpointCursor,
    phase: "issues" | "pulls" | "commits",
    etags: Record<string, string>,
  ): GithubSyncCheckpointCursor {
    const next = this.nextPhaseAfter(phase);
    if (next === "next_repo") {
      return this.advanceToNextRepoOrDone({ ...state, etags });
    }
    return {
      ...state,
      phase: next,
      page: 1,
      etags,
    };
  }

  private async fetchIssuesPage(
    client: GithubClient,
    state: GithubSyncCheckpointCursor,
    login: string,
  ): Promise<AdapterPage> {
    const repoFullName = state.currentRepo!;
    const { owner, repo } = parseOwnerRepo(repoFullName);
    const key = etagKey("issues", repoFullName);
    const res = await client.listRepoIssues({
      owner,
      repo,
      page: state.page,
      perPage: this.pageSize,
      since: state.since,
      etag: state.etags?.[key],
    });

    const etags = { ...(state.etags ?? {}) };
    if (res.etag) etags[key] = res.etag;

    if (res.notModified) {
      const next = this.advanceAfterRepoResource(state, "issues", etags);
      return {
        items: [],
        nextCursor:
          next.phase === "done" ? null : serializeGithubCursor(next),
        hasMore: next.phase !== "done",
      };
    }

    const raw = res.data ?? [];
    const issues = raw.filter(isPureIssue);
    const items = issues.map((i) => this.envelopeIssue(repoFullName, i, login));
    const hasMorePages = Boolean(res.linkNext) || raw.length >= this.pageSize;

    if (hasMorePages) {
      const next: GithubSyncCheckpointCursor = {
        ...state,
        page: state.page + 1,
        etags,
        login,
      };
      return { items, nextCursor: serializeGithubCursor(next), hasMore: true };
    }

    const next = this.advanceAfterRepoResource(state, "issues", etags);
    return {
      items,
      nextCursor: next.phase === "done" ? null : serializeGithubCursor(next),
      hasMore: next.phase !== "done",
    };
  }

  private async fetchPullsPage(
    client: GithubClient,
    state: GithubSyncCheckpointCursor,
    login: string,
  ): Promise<AdapterPage> {
    const repoFullName = state.currentRepo!;
    const { owner, repo } = parseOwnerRepo(repoFullName);
    const key = etagKey("pulls", repoFullName);
    const res = await client.listRepoPulls({
      owner,
      repo,
      page: state.page,
      perPage: this.pageSize,
      etag: state.etags?.[key],
    });

    const etags = { ...(state.etags ?? {}) };
    if (res.etag) etags[key] = res.etag;

    if (res.notModified) {
      const next = this.advanceAfterRepoResource(state, "pulls", etags);
      return {
        items: [],
        nextCursor:
          next.phase === "done" ? null : serializeGithubCursor(next),
        hasMore: next.phase !== "done",
      };
    }

    const raw = res.data ?? [];
    const pulls = raw.filter((p) => isUpdatedSince(p.updated_at, state.since));
    const items = pulls.map((p) => this.envelopePull(repoFullName, p, login));
    const hasMorePages = Boolean(res.linkNext) || raw.length >= this.pageSize;

    // If since filter emptied the page but API has older pages, still advance
    // page when hasMore — until a page is fully older than since.
    if (hasMorePages) {
      const oldest = raw[raw.length - 1]?.updated_at;
      const allOlder =
        Boolean(state.since) &&
        Boolean(oldest) &&
        !isUpdatedSince(oldest, state.since);
      if (!allOlder) {
        const next: GithubSyncCheckpointCursor = {
          ...state,
          page: state.page + 1,
          etags,
          login,
        };
        return {
          items,
          nextCursor: serializeGithubCursor(next),
          hasMore: true,
        };
      }
    }

    const next = this.advanceAfterRepoResource(state, "pulls", etags);
    return {
      items,
      nextCursor: next.phase === "done" ? null : serializeGithubCursor(next),
      hasMore: next.phase !== "done",
    };
  }

  private async fetchCommitsPage(
    client: GithubClient,
    state: GithubSyncCheckpointCursor,
    login: string,
  ): Promise<AdapterPage> {
    const repoFullName = state.currentRepo!;
    const { owner, repo } = parseOwnerRepo(repoFullName);
    const key = etagKey("commits", repoFullName);
    const res = await client.listRepoCommits({
      owner,
      repo,
      page: state.page,
      perPage: this.pageSize,
      since: state.since,
      etag: state.etags?.[key],
    });

    const etags = { ...(state.etags ?? {}) };
    if (res.etag) etags[key] = res.etag;

    if (res.notModified) {
      const next = this.advanceAfterRepoResource(state, "commits", etags);
      return {
        items: [],
        nextCursor:
          next.phase === "done" ? null : serializeGithubCursor(next),
        hasMore: next.phase !== "done",
      };
    }

    const commits = res.data ?? [];
    const items = commits.map((c) =>
      this.envelopeCommit(repoFullName, c, login),
    );
    const hasMorePages =
      Boolean(res.linkNext) || commits.length >= this.pageSize;

    if (hasMorePages) {
      const next: GithubSyncCheckpointCursor = {
        ...state,
        page: state.page + 1,
        etags,
        login,
      };
      return { items, nextCursor: serializeGithubCursor(next), hasMore: true };
    }

    const next = this.advanceAfterRepoResource(state, "commits", etags);
    return {
      items,
      nextCursor: next.phase === "done" ? null : serializeGithubCursor(next),
      hasMore: next.phase !== "done",
    };
  }

  private envelopeRepo(repo: GhRepo, login: string): RawEnvelope {
    const { sourceRecordId, body, summary } = mapRepo(repo);
    return {
      source: "github",
      sourceRecordId,
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: repo.full_name,
        extra: {
          kind: "github_repo_summary",
          account: login,
          summary,
        },
      },
    };
  }

  private envelopeIssue(
    repoFullName: string,
    issue: Parameters<typeof mapIssue>[1],
    login: string,
  ): RawEnvelope {
    const { sourceRecordId, body, summary } = mapIssue(repoFullName, issue);
    return {
      source: "github",
      sourceRecordId,
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: repoFullName,
        extra: {
          kind: "github_issue_summary",
          account: login,
          summary,
        },
      },
    };
  }

  private envelopePull(
    repoFullName: string,
    pr: Parameters<typeof mapPull>[1],
    login: string,
  ): RawEnvelope {
    const { sourceRecordId, body, summary } = mapPull(repoFullName, pr);
    return {
      source: "github",
      sourceRecordId,
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: repoFullName,
        extra: {
          kind: "github_pr_summary",
          account: login,
          summary,
        },
      },
    };
  }

  private envelopeCommit(
    repoFullName: string,
    commit: Parameters<typeof mapCommit>[1],
    login: string,
  ): RawEnvelope {
    const { sourceRecordId, body, summary } = mapCommit(repoFullName, commit);
    return {
      source: "github",
      sourceRecordId,
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: repoFullName,
        extra: {
          kind: "github_commit_summary",
          account: login,
          summary,
        },
      },
    };
  }
}

export function createGithubAdapter(
  options?: GithubAdapterOptions,
): GithubAdapter {
  return new GithubAdapter(options);
}
