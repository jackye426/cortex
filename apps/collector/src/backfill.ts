/**
 * Cortex backfill CLI — Claude + Codex + Cursor + Calibre + Browser + GitHub
 * + Google Workspace (Calendar / Drive / Gmail) + Spotify / YouTube
 * (+ ChatGPT export).
 *
 * Usage:
 *   pnpm --filter @cortex/collector backfill -- --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=claude --limit=5
 *   pnpm --filter @cortex/collector backfill -- --source=cursor --limit=5 --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=calibre --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=browser --dry-run --limit=10
 *   pnpm --filter @cortex/collector backfill -- --source=github --dry-run --limit=20
 *   pnpm --filter @cortex/collector backfill -- --source=calendar --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=drive --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=gmail --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=spotify --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=youtube --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=spotify-export --path=C:\exports\spotify.zip --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=youtube-takeout --path=C:\exports\takeout.zip --dry-run
 *   pnpm --filter @cortex/collector backfill -- --source=chatgpt-export --path=C:\exports\chatgpt.zip --dry-run
 *
 * Env: CORTEX_INGEST_URL, CORTEX_INGEST_TOKEN
 * GitHub: GITHUB_TOKEN (required for --source=github)
 * Google: GOOGLE_* (optional — mock fixtures when unset; see docs/google.md)
 * Spotify: SPOTIFY_* (optional — mock when unset; see docs/sources.md)
 */

import { BrowserAdapter } from "@cortex/adapter-browser";
import { CalibreAdapter } from "@cortex/adapter-calibre";
import { CalendarAdapter } from "@cortex/adapter-calendar";
import { ChatgptExportAdapter } from "@cortex/adapter-chatgpt-export";
import { ClaudeCodeAdapter } from "@cortex/adapter-claude-code";
import { CodexAdapter } from "@cortex/adapter-codex";
import { CursorAdapter } from "@cortex/adapter-cursor";
import { DriveAdapter } from "@cortex/adapter-drive";
import { GithubAdapter } from "@cortex/adapter-github";
import { GmailAdapter } from "@cortex/adapter-gmail";
import {
  SpotifyAdapter,
  SpotifyExportAdapter,
} from "@cortex/adapter-spotify";
import {
  YoutubeAdapter,
  YoutubeTakeoutAdapter,
} from "@cortex/adapter-youtube";
import type { RawEnvelope } from "@cortex/core";
import { advanceCheckpoint, loadCheckpoint } from "./checkpoint-store.js";
import {
  getIngestConfig,
  loadDotEnv,
  postEnvelope,
} from "./ingest-client.js";

type SourceOpt =
  | "claude"
  | "codex"
  | "cursor"
  | "calibre"
  | "browser"
  | "github"
  | "calendar"
  | "drive"
  | "gmail"
  | "spotify"
  | "spotify-export"
  | "youtube"
  | "youtube-takeout"
  | "chatgpt-export"
  | "all";

interface CliOptions {
  source: SourceOpt;
  dryRun: boolean;
  limit?: number;
  pageSize?: number;
  skipSubagents?: boolean;
  noTranscripts?: boolean;
  /** ZIP / folder for chatgpt-export, spotify-export, youtube-takeout. */
  path?: string;
  /** ISO since for GitHub incremental. */
  since?: string;
  /** Max repos to scan for GitHub issues/PRs/commits. */
  maxRepos?: number;
  /** Skip GitHub commits (faster smoke). */
  noCommits?: boolean;
  /** Gmail list query override (default newer_than:365d). */
  query?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { source: "all", dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "-n") {
      opts.dryRun = true;
      continue;
    }
    if (arg === "--skip-subagents") {
      opts.skipSubagents = true;
      continue;
    }
    if (arg === "--no-transcripts") {
      opts.noTranscripts = true;
      continue;
    }
    if (arg === "--no-commits") {
      opts.noCommits = true;
      continue;
    }
    if (arg.startsWith("--source=")) {
      const v = arg.slice("--source=".length);
      if (v === "claude" || v === "claude-code") opts.source = "claude";
      else if (v === "codex") opts.source = "codex";
      else if (v === "cursor") opts.source = "cursor";
      else if (v === "calibre") opts.source = "calibre";
      else if (v === "browser") opts.source = "browser";
      else if (v === "github") opts.source = "github";
      else if (v === "calendar") opts.source = "calendar";
      else if (v === "drive") opts.source = "drive";
      else if (v === "gmail") opts.source = "gmail";
      else if (v === "spotify") opts.source = "spotify";
      else if (v === "spotify-export") opts.source = "spotify-export";
      else if (v === "youtube") opts.source = "youtube";
      else if (v === "youtube-takeout") opts.source = "youtube-takeout";
      else if (v === "chatgpt-export" || v === "chatgpt") {
        opts.source = "chatgpt-export";
      } else if (v === "all") opts.source = "all";
      else {
        throw new Error(
          `Unknown --source=${v} (use claude|codex|cursor|calibre|browser|github|calendar|drive|gmail|spotify|spotify-export|youtube|youtube-takeout|chatgpt-export|all)`,
        );
      }
      continue;
    }
    if (arg.startsWith("--path=")) {
      opts.path = arg.slice("--path=".length);
      continue;
    }
    if (arg.startsWith("--since=")) {
      opts.since = arg.slice("--since=".length);
      continue;
    }
    if (arg.startsWith("--max-repos=")) {
      opts.maxRepos = Number(arg.slice("--max-repos=".length));
      if (!Number.isFinite(opts.maxRepos) || opts.maxRepos < 0) {
        throw new Error(`Invalid --max-repos=${arg}`);
      }
      continue;
    }
    if (arg.startsWith("--limit=")) {
      opts.limit = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(opts.limit) || opts.limit < 0) {
        throw new Error(`Invalid --limit=${arg}`);
      }
      continue;
    }
    if (arg.startsWith("--page-size=")) {
      opts.pageSize = Number(arg.slice("--page-size=".length));
      continue;
    }
    if (arg.startsWith("--query=")) {
      opts.query = arg.slice("--query=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function printHelp(): void {
  console.log(`Cortex backfill

Options:
  --source=claude|codex|cursor|calibre|browser|github|calendar|drive|gmail|spotify|spotify-export|youtube|youtube-takeout|chatgpt-export|all
                          Which adapters to run (default: all)
                          Note: "all" = claude + codex + cursor + calibre + browser
                          (cloud / export sources need explicit --source)
  --path=ZIP_OR_FOLDER    Required for chatgpt-export | spotify-export | youtube-takeout
                          (spotify-export / youtube-takeout may omit --path in mock dry-run)
  --since=ISO             GitHub: incremental lower bound (issues/commits/PRs)
  --max-repos=N           GitHub: cap repos scanned for issues/PRs/commits
  --no-commits            GitHub: skip commit history
  --limit=N               Max envelopes per source
  --dry-run, -n           Parse + summarize only; do not POST
  --page-size=N           Adapter page size (optional)
  --skip-subagents        Cursor: skip isSubagent composers
  --no-transcripts        Cursor: skip agent-transcript merge
  --help                  Show this help

Env:
  CORTEX_INGEST_URL       Default http://localhost:8787
  CORTEX_INGEST_TOKEN     Bearer token for POST /v1/ingest
  GITHUB_TOKEN            Required for --source=github (fine-grained PAT)
  GOOGLE_CLIENT_ID        Workspace OAuth (calendar|drive|gmail)
  GOOGLE_CLIENT_SECRET
  GOOGLE_REFRESH_TOKEN    Optional — without these, Google Workspace sources use mocks
  GOOGLE_YOUTUBE_CLIENT_* Optional personal YouTube client (falls back to GOOGLE_CLIENT_*)
  GOOGLE_YOUTUBE_REFRESH_TOKEN  Optional; falls back to GOOGLE_REFRESH_TOKEN
  GOOGLE_MOCK=1           Force mock fixtures even if credentials are set
  SPOTIFY_CLIENT_ID       Spotify Web API (spotify)
  SPOTIFY_CLIENT_SECRET
  SPOTIFY_REFRESH_TOKEN   Optional — without these, Spotify uses mocks
  SPOTIFY_MOCK=1          Force Spotify mock fixtures
`);
}

function summaryLine(env: RawEnvelope): string {
  const extra = env.provenance.extra;
  const summary =
    extra && typeof extra === "object" && "summary" in extra
      ? (extra.summary as Record<string, unknown>)
      : {};
  const body =
    env.body && typeof env.body === "object"
      ? (env.body as Record<string, unknown>)
      : {};
  const kind = typeof body.kind === "string" ? body.kind : "";

  if (kind === "calibre_ebook" || env.source === "calibre") {
    const title =
      typeof summary.title === "string"
        ? summary.title.slice(0, 60)
        : typeof body.title === "string"
          ? body.title.slice(0, 60)
          : "";
    const formats = Array.isArray(summary.formats)
      ? summary.formats.join(",")
      : "";
    return `${env.source}:${env.sourceRecordId} ebook formats=${formats} ${title}`;
  }

  if (kind === "browser_bookmark") {
    const name =
      typeof summary.name === "string"
        ? summary.name.slice(0, 40)
        : typeof body.name === "string"
          ? body.name.slice(0, 40)
          : "";
    return `${env.source}:${env.sourceRecordId} bookmark ${name}`;
  }

  if (kind === "browser_search_query") {
    const term =
      typeof summary.normalizedTerm === "string"
        ? summary.normalizedTerm.slice(0, 40)
        : typeof body.normalizedTerm === "string"
          ? String(body.normalizedTerm).slice(0, 40)
          : "";
    return `${env.source}:${env.sourceRecordId} search ${term}`;
  }

  if (kind === "github_repo") {
    const name =
      typeof summary.fullName === "string"
        ? summary.fullName
        : typeof body.fullName === "string"
          ? body.fullName
          : env.sourceRecordId;
    return `${env.source}:${env.sourceRecordId} repo ${name}`;
  }

  if (kind === "github_issue") {
    const title =
      typeof summary.title === "string"
        ? summary.title.slice(0, 50)
        : typeof body.title === "string"
          ? body.title.slice(0, 50)
          : "";
    return `${env.source}:${env.sourceRecordId} issue ${title}`;
  }

  if (kind === "github_pr") {
    const title =
      typeof summary.title === "string"
        ? summary.title.slice(0, 50)
        : typeof body.title === "string"
          ? body.title.slice(0, 50)
          : "";
    return `${env.source}:${env.sourceRecordId} pr ${title}`;
  }

  if (kind === "github_commit") {
    const msg =
      typeof summary.messagePreview === "string"
        ? summary.messagePreview.slice(0, 50)
        : "";
    return `${env.source}:${env.sourceRecordId} commit ${msg}`;
  }

  if (kind === "calendar_event") {
    const title =
      typeof summary.summary === "string"
        ? summary.summary.slice(0, 50)
        : typeof body.summary === "string"
          ? body.summary.slice(0, 50)
          : "";
    return `${env.source}:${env.sourceRecordId} event ${title}`;
  }

  if (kind === "drive_file") {
    const name =
      typeof summary.name === "string"
        ? summary.name.slice(0, 50)
        : typeof body.name === "string"
          ? body.name.slice(0, 50)
          : "";
    const mime =
      typeof summary.mimeType === "string" ? summary.mimeType : "";
    return `${env.source}:${env.sourceRecordId} file ${name} ${mime}`;
  }

  if (kind === "email_message") {
    const subject =
      typeof summary.subject === "string"
        ? summary.subject.slice(0, 50)
        : "";
    const from =
      typeof summary.from === "string" ? summary.from.slice(0, 30) : "";
    return `${env.source}:${env.sourceRecordId} email from=${from} ${subject}`;
  }

  if (kind === "spotify_track") {
    const name =
      typeof summary.name === "string"
        ? summary.name.slice(0, 50)
        : typeof body.name === "string"
          ? body.name.slice(0, 50)
          : "";
    const artists = Array.isArray(summary.artists)
      ? summary.artists.slice(0, 2).join(",")
      : "";
    return `${env.source}:${env.sourceRecordId} track ${artists} — ${name}`;
  }

  if (kind === "spotify_play") {
    const name =
      typeof summary.name === "string"
        ? summary.name.slice(0, 40)
        : typeof body.name === "string"
          ? body.name.slice(0, 40)
          : "";
    const played =
      typeof summary.playedAt === "string" ? summary.playedAt : "";
    return `${env.source}:${env.sourceRecordId} play ${played} ${name}`;
  }

  if (kind === "spotify_show") {
    const name =
      typeof summary.name === "string"
        ? summary.name.slice(0, 50)
        : typeof body.name === "string"
          ? body.name.slice(0, 50)
          : "";
    const publisher =
      typeof summary.publisher === "string"
        ? summary.publisher.slice(0, 30)
        : typeof body.publisher === "string"
          ? body.publisher.slice(0, 30)
          : "";
    return `${env.source}:${env.sourceRecordId} show ${publisher} — ${name}`;
  }

  if (kind === "spotify_episode") {
    const name =
      typeof summary.name === "string"
        ? summary.name.slice(0, 40)
        : typeof body.name === "string"
          ? body.name.slice(0, 40)
          : "";
    const show =
      typeof summary.showName === "string"
        ? summary.showName.slice(0, 30)
        : typeof body.showName === "string"
          ? body.showName.slice(0, 30)
          : "";
    return `${env.source}:${env.sourceRecordId} episode ${show} — ${name}`;
  }

  if (kind === "youtube_video") {
    const title =
      typeof summary.title === "string"
        ? summary.title.slice(0, 50)
        : typeof body.title === "string"
          ? body.title.slice(0, 50)
          : "";
    return `${env.source}:${env.sourceRecordId} video ${title}`;
  }

  if (kind === "youtube_watch") {
    const title =
      typeof summary.title === "string"
        ? summary.title.slice(0, 40)
        : typeof body.title === "string"
          ? body.title.slice(0, 40)
          : "";
    const when =
      typeof summary.watchedAt === "string" ? summary.watchedAt : "";
    return `${env.source}:${env.sourceRecordId} watch ${when} ${title}`;
  }

  const turns = typeof summary.turnCount === "number" ? summary.turnCount : "?";
  const tools =
    typeof summary.toolCallCount === "number" ? summary.toolCallCount : "?";
  const bubbles =
    typeof summary.bubbleCount === "number"
      ? ` bubbles=${summary.bubbleCount}`
      : "";
  const title =
    typeof summary.title === "string"
      ? summary.title.slice(0, 60)
      : env.provenance.workspace ?? "";
  return `${env.source}:${env.sourceRecordId} turns=${turns} tools=${tools}${bubbles} ${title}`;
}

async function runSource(
  name: string,
  fetchAll: () => Promise<RawEnvelope[]>,
  opts: CliOptions,
  config: ReturnType<typeof getIngestConfig>,
): Promise<{ ok: number; fail: number; total: number }> {
  console.info(`[backfill] ${name}: discovering…`);
  const envelopes = await fetchAll();
  console.info(`[backfill] ${name}: ${envelopes.length} envelope(s)`);

  const accountKey = "default";
  const prior = loadCheckpoint(name, accountKey);
  let startIndex = 0;
  if (prior?.cursor && !opts.dryRun) {
    const idx = envelopes.findIndex((e) => e.sourceRecordId === prior.cursor);
    if (idx >= 0) {
      startIndex = idx + 1;
      console.info(
        `[backfill] ${name}: resuming after checkpoint cursor=${prior.cursor} (skip ${startIndex}) @ ${prior.updatedAt}`,
      );
    } else {
      console.info(
        `[backfill] ${name}: checkpoint cursor=${prior.cursor} not in batch — ingesting all`,
      );
    }
  }

  let ok = 0;
  let fail = 0;

  for (let i = startIndex; i < envelopes.length; i++) {
    const env = envelopes[i]!;

    if (opts.dryRun) {
      console.info(`[dry-run] ${summaryLine(env)}`);
      ok += 1;
      continue;
    }

    const result = await postEnvelope(env, config);
    if (result.ok) {
      ok += 1;
      advanceCheckpoint({
        source: env.source,
        accountKey,
        cursor: env.sourceRecordId,
        metadata: {
          key: result.key,
          contentHash: result.contentHash,
          recordType: result.recordType,
        },
      });
      console.info(
        `[ingest] ok ${result.key} hash=${result.contentHash?.slice(0, 12)}… type=${result.recordType} redact=${result.redactionHits}`,
      );
    } else {
      fail += 1;
      console.error(
        `[ingest] FAIL ${env.source}:${env.sourceRecordId} ${result.error}`,
      );
    }
  }

  return { ok, fail, total: envelopes.length };
}

async function main(): Promise<void> {
  loadDotEnv();
  const opts = parseArgs(process.argv.slice(2));
  const config = getIngestConfig();

  console.info("[backfill] starting", {
    source: opts.source,
    dryRun: opts.dryRun,
    limit: opts.limit ?? null,
    path: opts.path ?? null,
    since: opts.since ?? null,
    ingestUrl: config.url,
    tokenSet: Boolean(config.token),
    githubTokenSet: Boolean(process.env.GITHUB_TOKEN?.trim()),
  });

  if (!opts.dryRun && !config.token) {
    console.error("CORTEX_INGEST_TOKEN is required unless --dry-run");
    process.exit(1);
  }

  if (opts.source === "chatgpt-export" && !opts.path) {
    console.error(
      "--path=ZIP_OR_FOLDER is required for --source=chatgpt-export",
    );
    process.exit(1);
  }

  if (
    (opts.source === "spotify-export" || opts.source === "youtube-takeout") &&
    !opts.path &&
    !opts.dryRun
  ) {
    console.error(
      `--path=ZIP_OR_FOLDER is required for --source=${opts.source} (or use --dry-run for mock fixtures)`,
    );
    process.exit(1);
  }

  const totals = { ok: 0, fail: 0, total: 0 };

  if (opts.source === "claude" || opts.source === "all") {
    const adapter = new ClaudeCodeAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] claude health", health);
    const r = await runSource(
      "claude-code",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "codex" || opts.source === "all") {
    const adapter = new CodexAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] codex health", health);
    const r = await runSource(
      "codex",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "cursor" || opts.source === "all") {
    const adapter = new CursorAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      skipSubagents: opts.skipSubagents,
      includeAgentTranscripts: !opts.noTranscripts,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] cursor health", health);
    const r = await runSource(
      "cursor",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "calibre" || opts.source === "all") {
    const adapter = new CalibreAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] calibre health", health);
    const r = await runSource(
      "calibre",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "browser" || opts.source === "all") {
    const adapter = new BrowserAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] browser health", health);
    const r = await runSource(
      "browser",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "github") {
    const adapter = new GithubAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      since: opts.since,
      maxRepos: opts.maxRepos ?? (opts.limit != null ? Math.min(opts.limit, 5) : undefined),
      includeCommits: !opts.noCommits,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] github health", health);
    if (!health.ok) {
      console.error("[backfill] github not ready:", health.detail);
      process.exit(1);
    }
    const r = await runSource(
      "github",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "calendar") {
    const adapter = new CalendarAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] calendar health", health);
    const r = await runSource(
      "calendar",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "drive") {
    const adapter = new DriveAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] drive health", health);
    const r = await runSource(
      "drive",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "gmail") {
    const adapter = new GmailAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
      query: opts.query,
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] gmail health", health);
    console.info(
      `[backfill] gmail query=${opts.query ?? "newer_than:365d (default)"}`,
    );
    console.info("[backfill] gmail watch notes:\n" + adapter.watchNotes());
    const gmailPrior = !opts.dryRun
      ? loadCheckpoint("gmail", "default")
      : null;
    if (gmailPrior?.cursor) {
      console.info(
        `[backfill] gmail: list-resume afterMessageId=${gmailPrior.cursor}`,
      );
    }
    const r = await runSource(
      "gmail",
      () =>
        adapter.backfillAll(
          gmailPrior?.cursor
            ? { afterMessageId: gmailPrior.cursor }
            : undefined,
        ),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "spotify") {
    const adapter = new SpotifyAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
      // Podcasts first (shows → show episodes → saved episodes), then music.
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] spotify health", health);
    const r = await runSource(
      "spotify",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "spotify-export") {
    const adapter = new SpotifyExportAdapter({
      exportPath: opts.path,
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] spotify-export health", health);
    if (!health.ok) {
      console.error("[backfill] spotify-export not ready:", health.detail);
      process.exit(1);
    }
    const r = await runSource(
      "spotify-export",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "youtube") {
    const adapter = new YoutubeAdapter({
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] youtube health", health);
    console.info(
      "[backfill] youtube watch notes:\n" + adapter.watchHistoryNotes(),
    );
    const r = await runSource(
      "youtube",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "youtube-takeout") {
    const adapter = new YoutubeTakeoutAdapter({
      exportPath: opts.path,
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] youtube-takeout health", health);
    if (!health.ok) {
      console.error("[backfill] youtube-takeout not ready:", health.detail);
      process.exit(1);
    }
    const r = await runSource(
      "youtube-takeout",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  if (opts.source === "chatgpt-export") {
    const adapter = new ChatgptExportAdapter({
      exportPath: opts.path,
      limit: opts.limit,
      pageSize: opts.pageSize,
      collectorName: "collector-backfill",
    });
    const health = await adapter.healthcheck();
    console.info("[backfill] chatgpt-export health", health);
    if (!health.ok) {
      console.error("[backfill] chatgpt-export not ready:", health.detail);
      process.exit(1);
    }
    const r = await runSource(
      "chatgpt-export",
      () => adapter.backfillAll(),
      opts,
      config,
    );
    totals.ok += r.ok;
    totals.fail += r.fail;
    totals.total += r.total;
  }

  console.info("[backfill] done", totals);
  if (totals.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[backfill] fatal", err);
  process.exit(1);
});
