/**
 * Minimal GitHub REST client (work-history only).
 * Uses fetch + fine-grained PAT / classic token from env.
 */

export class GithubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubAuthError";
  }
}

export class GithubApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, path: string) {
    super(`GitHub API ${status} for ${path}: ${body.slice(0, 200)}`);
    this.name = "GithubApiError";
    this.status = status;
    this.body = body;
  }
}

export interface GithubClientOptions {
  token: string;
  /** API base, default https://api.github.com */
  baseUrl?: string;
  /** User-Agent required by GitHub. */
  userAgent?: string;
  /** Max retries on 403 secondary rate limit / 502–504. */
  maxRetries?: number;
}

export interface GithubRequestOptions {
  path: string;
  query?: Record<string, string | number | undefined>;
  /** If-None-Match */
  etag?: string;
  /** Abort after this many ms (default 60s). */
  timeoutMs?: number;
}

export interface GithubResponse<T> {
  status: number;
  /** 304 Not Modified */
  notModified: boolean;
  etag?: string;
  linkNext?: string;
  data: T | null;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

export interface GhUser {
  login: string;
  id: number;
  name?: string | null;
  html_url?: string;
}

export interface GhRepo {
  id: number;
  node_id?: string;
  name: string;
  full_name: string;
  private: boolean;
  description?: string | null;
  html_url: string;
  default_branch?: string;
  language?: string | null;
  fork: boolean;
  archived?: boolean;
  disabled?: boolean;
  pushed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  owner?: { login: string; id?: number };
  topics?: string[];
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  visibility?: string;
}

export interface GhIssue {
  id: number;
  number: number;
  node_id?: string;
  title: string;
  state: string;
  body?: string | null;
  html_url: string;
  user?: { login: string } | null;
  labels?: Array<string | { name?: string }>;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  pull_request?: { url?: string };
  comments?: number;
}

export interface GhPull {
  id: number;
  number: number;
  node_id?: string;
  title: string;
  state: string;
  body?: string | null;
  html_url: string;
  user?: { login: string } | null;
  draft?: boolean;
  merged_at?: string | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string; sha?: string };
  labels?: Array<{ name?: string }>;
}

export interface GhCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { name?: string; email?: string; date?: string } | null;
    committer?: { name?: string; email?: string; date?: string } | null;
  };
  author?: { login?: string } | null;
  committer?: { login?: string } | null;
  parents?: Array<{ sha: string }>;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const url = new URL(
    path.startsWith("http") ? path : `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`,
  );
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function parseLinkNext(link: string | null): string | undefined {
  if (!link) return undefined;
  // <url>; rel="next", <url>; rel="last"
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class GithubClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly maxRetries: number;

  constructor(options: GithubClientOptions) {
    if (!options.token?.trim()) {
      throw new GithubAuthError(
        "GITHUB_TOKEN is not set. Create a fine-grained PAT (see docs/github.md) and set GITHUB_TOKEN in .env",
      );
    }
    this.token = options.token.trim();
    this.baseUrl = (options.baseUrl ?? "https://api.github.com").replace(
      /\/$/,
      "",
    );
    this.userAgent = options.userAgent ?? "Cortex-GitHub-Adapter";
    this.maxRetries = options.maxRetries ?? 3;
  }

  async request<T>(opts: GithubRequestOptions): Promise<GithubResponse<T>> {
    const url = buildUrl(this.baseUrl, opts.path, opts.query);
    let attempt = 0;

    while (true) {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": this.userAgent,
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (opts.etag) {
        headers["If-None-Match"] = opts.etag;
      }

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        opts.timeoutMs ?? 60_000,
      );

      let res: Response;
      try {
        res = await fetch(url, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }

      const etag = res.headers.get("etag") ?? undefined;
      const linkNext = parseLinkNext(res.headers.get("link"));
      const rateLimitRemaining = Number(
        res.headers.get("x-ratelimit-remaining") ?? "",
      );
      const rateLimitReset = Number(res.headers.get("x-ratelimit-reset") ?? "");

      if (res.status === 304) {
        return {
          status: 304,
          notModified: true,
          etag,
          linkNext,
          data: null,
          rateLimitRemaining: Number.isFinite(rateLimitRemaining)
            ? rateLimitRemaining
            : undefined,
          rateLimitReset: Number.isFinite(rateLimitReset)
            ? rateLimitReset
            : undefined,
        };
      }

      if (
        (res.status === 403 || res.status === 429 || res.status >= 500) &&
        attempt < this.maxRetries
      ) {
        attempt += 1;
        const retryAfter = Number(res.headers.get("retry-after") ?? "");
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 500 * 2 ** attempt);
        await sleep(waitMs);
        continue;
      }

      if (res.status === 401) {
        throw new GithubAuthError(
          "GitHub API returned 401 — check GITHUB_TOKEN (expired or missing scopes). See docs/github.md",
        );
      }

      const text = await res.text();
      if (!res.ok) {
        throw new GithubApiError(res.status, text, opts.path);
      }

      let data: T | null = null;
      if (text) {
        data = JSON.parse(text) as T;
      }

      return {
        status: res.status,
        notModified: false,
        etag,
        linkNext,
        data,
        rateLimitRemaining: Number.isFinite(rateLimitRemaining)
          ? rateLimitRemaining
          : undefined,
        rateLimitReset: Number.isFinite(rateLimitReset)
          ? rateLimitReset
          : undefined,
      };
    }
  }

  async getAuthenticatedUser(): Promise<GhUser> {
    const res = await this.request<GhUser>({ path: "/user" });
    if (!res.data) throw new GithubApiError(res.status, "empty user", "/user");
    return res.data;
  }

  async listUserRepos(opts: {
    page: number;
    perPage: number;
    etag?: string;
    affiliation?: string;
  }): Promise<GithubResponse<GhRepo[]>> {
    return this.request<GhRepo[]>({
      path: "/user/repos",
      etag: opts.etag,
      query: {
        page: opts.page,
        per_page: opts.perPage,
        sort: "updated",
        direction: "desc",
        affiliation: opts.affiliation ?? "owner,collaborator,organization_member",
      },
    });
  }

  async listRepoIssues(opts: {
    owner: string;
    repo: string;
    page: number;
    perPage: number;
    since?: string;
    etag?: string;
  }): Promise<GithubResponse<GhIssue[]>> {
    return this.request<GhIssue[]>({
      path: `/repos/${opts.owner}/${opts.repo}/issues`,
      etag: opts.etag,
      query: {
        page: opts.page,
        per_page: opts.perPage,
        state: "all",
        sort: "updated",
        direction: "desc",
        since: opts.since,
      },
    });
  }

  async listRepoPulls(opts: {
    owner: string;
    repo: string;
    page: number;
    perPage: number;
    etag?: string;
  }): Promise<GithubResponse<GhPull[]>> {
    return this.request<GhPull[]>({
      path: `/repos/${opts.owner}/${opts.repo}/pulls`,
      etag: opts.etag,
      query: {
        page: opts.page,
        per_page: opts.perPage,
        state: "all",
        sort: "updated",
        direction: "desc",
      },
    });
  }

  async listRepoCommits(opts: {
    owner: string;
    repo: string;
    page: number;
    perPage: number;
    since?: string;
    etag?: string;
  }): Promise<GithubResponse<GhCommit[]>> {
    return this.request<GhCommit[]>({
      path: `/repos/${opts.owner}/${opts.repo}/commits`,
      etag: opts.etag,
      query: {
        page: opts.page,
        per_page: opts.perPage,
        since: opts.since,
      },
    });
  }
}

export function resolveGithubToken(
  explicit?: string,
): string | undefined {
  const t = explicit ?? process.env.GITHUB_TOKEN;
  return t?.trim() || undefined;
}
