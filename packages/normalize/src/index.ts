import type { RawEnvelope } from "@cortex/core";

/**
 * Placeholder canonical record produced by normalize stubs.
 * Real mappers land in later phases per source.
 */
export interface CanonicalRecordStub {
  recordType: string;
  source: string;
  sourceRecordId: string;
  contentHash?: string;
  payload: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Claude Code session → lightweight session canonical stub.
 * Full events remain on the raw envelope; we only promote summary fields.
 */
export function normalizeClaudeCodeSession(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "session",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      provider: "claude-code",
      sessionId: envelope.sourceRecordId,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
      cwd: summary.cwd ?? envelope.provenance.workspace ?? null,
      gitBranch: summary.gitBranch ?? null,
      model: summary.model ?? null,
      version: summary.version ?? null,
      turnCount: summary.turnCount ?? null,
      userTurnCount: summary.userTurnCount ?? null,
      assistantTurnCount: summary.assistantTurnCount ?? null,
      toolCallCount: summary.toolCallCount ?? null,
      pathsTouched: summary.pathsTouched ?? [],
      turns: summary.turns ?? [],
      lineCount: body.lineCount ?? null,
      projectKey: body.projectKey ?? summary.projectDir ?? null,
    },
  };
}

/**
 * Codex session → lightweight session canonical stub.
 */
export function normalizeCodexSession(envelope: RawEnvelope): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "session",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      provider: "codex",
      sessionId: envelope.sourceRecordId,
      title: summary.title ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
      cwd: summary.cwd ?? envelope.provenance.workspace ?? null,
      sourceSurface: summary.source ?? null,
      model: summary.model ?? null,
      modelProvider: summary.modelProvider ?? null,
      gitBranch: summary.gitBranch ?? null,
      cliVersion: summary.cliVersion ?? null,
      turnCount: summary.turnCount ?? null,
      userTurnCount: summary.userTurnCount ?? null,
      assistantTurnCount: summary.assistantTurnCount ?? null,
      toolCallCount: summary.toolCallCount ?? null,
      pathsTouched: summary.pathsTouched ?? [],
      commands: summary.commands ?? [],
      turns: summary.turns ?? [],
      lineCount: body.lineCount ?? null,
    },
  };
}

/**
 * Cursor composer session → lightweight session canonical stub.
 * Full bubbles remain on the raw envelope body.
 */
export function normalizeCursorSession(envelope: RawEnvelope): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};
  const bubbles = isRecord(body.bubbles) ? body.bubbles : {};
  const transcript = isRecord(body.agentTranscript) ? body.agentTranscript : null;

  return {
    recordType: "session",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      provider: "cursor",
      sessionId: envelope.sourceRecordId,
      title: summary.title ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
      cwd: summary.cwd ?? envelope.provenance.workspace ?? null,
      workspaceId: summary.workspaceId ?? null,
      unifiedMode: summary.unifiedMode ?? null,
      model: summary.model ?? null,
      isSubagent: summary.isSubagent ?? null,
      isArchived: summary.isArchived ?? null,
      turnCount: summary.turnCount ?? null,
      userTurnCount: summary.userTurnCount ?? null,
      assistantTurnCount: summary.assistantTurnCount ?? null,
      toolCallCount: summary.toolCallCount ?? null,
      bubbleCount: summary.bubbleCount ?? Object.keys(bubbles).length,
      pathsTouched: summary.pathsTouched ?? [],
      commands: summary.commands ?? [],
      turns: summary.turns ?? [],
      hasAgentTranscript: summary.hasAgentTranscript ?? Boolean(transcript),
      agentTranscriptLines: transcript?.lineCount ?? null,
    },
  };
}

/**
 * ChatGPT export conversation → lightweight session canonical stub.
 */
export function normalizeChatgptConversation(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "session",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      provider: "chatgpt",
      conversationId: envelope.sourceRecordId,
      title: summary.title ?? body.title ?? null,
      model: summary.model ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
      updatedAt: summary.updatedAt ?? null,
      turnCount: summary.turnCount ?? null,
      userTurnCount: summary.userTurnCount ?? null,
      assistantTurnCount: summary.assistantTurnCount ?? null,
      turns: summary.turns ?? [],
      messageCount: Array.isArray(body.messages) ? body.messages.length : null,
    },
  };
}

/**
 * Live ChatGPT extension turn delta → stub (ongoing capture).
 */
export function normalizeChatgptTurnDelta(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const body = isRecord(envelope.body) ? envelope.body : {};
  return {
    recordType: "turn_delta",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      provider: "chatgpt",
      kind: body.kind ?? "chatgpt_turn_delta",
      conversationId: body.conversationId ?? null,
      turnId: body.turnId ?? envelope.sourceRecordId,
      userTextPreview: body.userTextPreview ?? null,
      assistantTextPreview: body.assistantTextPreview ?? null,
      occurredAt: envelope.occurredAt ?? body.occurredAt ?? null,
      pageUrl: body.pageUrl ?? null,
    },
  };
}

/**
 * Calibre ebook metadata → canonical stub (paths only; no binary vault).
 */
export function normalizeEbook(envelope: RawEnvelope): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "ebook",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      calibreId: summary.calibreId ?? body.calibreId ?? null,
      uuid: summary.uuid ?? body.uuid ?? envelope.sourceRecordId,
      title: summary.title ?? body.title ?? null,
      authors: summary.authors ?? body.authors ?? [],
      tags: summary.tags ?? body.tags ?? [],
      formats: summary.formats ?? null,
      formatPaths: summary.formatPaths ?? null,
      libraryRelativePath:
        summary.libraryRelativePath ?? body.libraryRelativePath ?? null,
      identifiers: summary.identifiers ?? body.identifiers ?? {},
      hasCover: summary.hasCover ?? body.hasCover ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
      lastModified: summary.lastModified ?? body.lastModified ?? null,
    },
  };
}

/**
 * Browser bookmark → canonical stub.
 */
export function normalizeBookmark(envelope: RawEnvelope): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "bookmark",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      browser: summary.browser ?? body.browser ?? null,
      profile: summary.profile ?? body.profile ?? null,
      guid: summary.guid ?? body.guid ?? null,
      name: summary.name ?? body.name ?? null,
      url: summary.url ?? body.url ?? null,
      folderPath: summary.folderPath ?? body.folderPath ?? null,
      dateAdded: summary.dateAdded ?? body.dateAdded ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * Browser keyword search query → canonical stub.
 */
export function normalizeSearchQuery(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "search_query",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      browser: summary.browser ?? body.browser ?? null,
      profile: summary.profile ?? body.profile ?? null,
      urlId: summary.urlId ?? body.urlId ?? null,
      term: summary.term ?? body.term ?? null,
      normalizedTerm: summary.normalizedTerm ?? body.normalizedTerm ?? null,
      resultUrl: summary.resultUrl ?? body.resultUrl ?? null,
      resultTitle: body.resultTitle ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * GitHub repository metadata → canonical stub.
 */
export function normalizeGithubRepo(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "github_repo",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      id: body.id ?? null,
      fullName: summary.fullName ?? body.fullName ?? null,
      name: summary.name ?? body.name ?? null,
      private: summary.private ?? body.private ?? null,
      description: summary.description ?? body.description ?? null,
      htmlUrl: summary.htmlUrl ?? body.htmlUrl ?? null,
      language: summary.language ?? body.language ?? null,
      defaultBranch: body.defaultBranch ?? null,
      fork: body.fork ?? null,
      archived: body.archived ?? null,
      topics: body.topics ?? [],
      ownerLogin: body.ownerLogin ?? null,
      pushedAt: summary.pushedAt ?? body.pushedAt ?? null,
      updatedAt: summary.updatedAt ?? body.updatedAt ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * GitHub issue → canonical stub.
 */
export function normalizeGithubIssue(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "github_issue",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      id: body.id ?? null,
      repoFullName: summary.repoFullName ?? body.repoFullName ?? null,
      number: summary.number ?? body.number ?? null,
      title: summary.title ?? body.title ?? null,
      state: summary.state ?? body.state ?? null,
      htmlUrl: summary.htmlUrl ?? body.htmlUrl ?? null,
      userLogin: body.userLogin ?? null,
      labels: body.labels ?? [],
      createdAt: body.createdAt ?? null,
      updatedAt: summary.updatedAt ?? body.updatedAt ?? null,
      closedAt: body.closedAt ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * GitHub pull request → canonical stub.
 */
export function normalizeGithubPr(envelope: RawEnvelope): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "github_pr",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      id: body.id ?? null,
      repoFullName: summary.repoFullName ?? body.repoFullName ?? null,
      number: summary.number ?? body.number ?? null,
      title: summary.title ?? body.title ?? null,
      state: summary.state ?? body.state ?? null,
      draft: summary.draft ?? body.draft ?? null,
      htmlUrl: summary.htmlUrl ?? body.htmlUrl ?? null,
      userLogin: body.userLogin ?? null,
      mergedAt: body.mergedAt ?? null,
      headRef: body.headRef ?? null,
      headSha: body.headSha ?? null,
      baseRef: body.baseRef ?? null,
      baseSha: body.baseSha ?? null,
      labels: body.labels ?? [],
      createdAt: body.createdAt ?? null,
      updatedAt: summary.updatedAt ?? body.updatedAt ?? null,
      closedAt: body.closedAt ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * GitHub commit → canonical stub.
 */
export function normalizeGithubCommit(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "github_commit",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      sha: summary.sha ?? body.sha ?? null,
      repoFullName: summary.repoFullName ?? body.repoFullName ?? null,
      htmlUrl: summary.htmlUrl ?? body.htmlUrl ?? null,
      messagePreview:
        summary.messagePreview ??
        (typeof body.message === "string"
          ? body.message.split("\n")[0]?.slice(0, 80)
          : null),
      message: body.message ?? null,
      authorLogin: summary.authorLogin ?? body.authorLogin ?? null,
      authorName: body.authorName ?? null,
      authoredAt: body.authoredAt ?? null,
      parentShas: body.parentShas ?? [],
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * Google Calendar event → canonical stub.
 */
export function normalizeCalendarEvent(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};
  const start = isRecord(body.start) ? body.start : {};
  const end = isRecord(body.end) ? body.end : {};

  return {
    recordType: "calendar_event",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      eventId: summary.eventId ?? body.eventId ?? null,
      calendarId: summary.calendarId ?? body.calendarId ?? null,
      summary: summary.summary ?? body.summary ?? null,
      status: summary.status ?? body.status ?? null,
      htmlLink: summary.htmlLink ?? body.htmlLink ?? null,
      location: body.location ?? null,
      start: summary.start ?? start.dateTime ?? start.date ?? null,
      end: summary.end ?? end.dateTime ?? end.date ?? null,
      recurringEventId: summary.recurringEventId ?? body.recurringEventId ?? null,
      attendeesCount: summary.attendeesCount ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * Google Drive file → canonical stub (metadata + export preview).
 */
export function normalizeDriveFile(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};
  const exportInfo = isRecord(body.export) ? body.export : {};

  return {
    recordType: "drive_file",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      fileId: summary.fileId ?? body.fileId ?? null,
      name: summary.name ?? body.name ?? null,
      mimeType: summary.mimeType ?? body.mimeType ?? null,
      webViewLink: summary.webViewLink ?? body.webViewLink ?? null,
      owners: summary.owners ?? body.owners ?? [],
      modifiedTime: summary.modifiedTime ?? body.modifiedTime ?? null,
      createdTime: body.createdTime ?? null,
      trashed: body.trashed ?? null,
      exportFormat: summary.exportFormat ?? exportInfo.format ?? null,
      textPreview: summary.textPreview ?? null,
      hasExportText: typeof exportInfo.text === "string",
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * Gmail message → canonical stub (headers + snippet; body in raw vault).
 */
export function normalizeEmailMessage(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};
  const headers = isRecord(body.headers) ? body.headers : {};

  return {
    recordType: "email_message",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      messageId: summary.messageId ?? body.messageId ?? null,
      threadId: summary.threadId ?? body.threadId ?? null,
      subject: summary.subject ?? headers.subject ?? null,
      from: summary.from ?? headers.from ?? null,
      to: summary.to ?? headers.to ?? [],
      labelIds: summary.labelIds ?? body.labelIds ?? [],
      snippet: summary.snippet ?? body.snippet ?? null,
      hasBodyText: typeof body.bodyText === "string",
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * Spotify library / playlist track → canonical stub.
 */
export function normalizeSpotifyTrack(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "spotify_track",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      trackUri: summary.trackUri ?? body.trackUri ?? envelope.sourceRecordId,
      trackId: summary.trackId ?? body.trackId ?? null,
      name: summary.name ?? body.name ?? null,
      artists: summary.artists ?? body.artists ?? [],
      album: summary.album ?? (isRecord(body.album) ? body.album.name : null),
      playlistId: summary.playlistId ?? body.playlistId ?? null,
      playlistName: summary.playlistName ?? body.playlistName ?? null,
      addedAt: summary.addedAt ?? body.addedAt ?? null,
      capture: body.capture ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * Spotify play (recently-played or privacy export) → canonical stub.
 */
export function normalizeSpotifyPlay(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "spotify_play",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      trackUri: summary.trackUri ?? body.trackUri ?? null,
      trackId: summary.trackId ?? body.trackId ?? null,
      name: summary.name ?? body.name ?? null,
      artists: summary.artists ?? body.artists ?? [],
      playedAt: summary.playedAt ?? body.playedAt ?? null,
      capture: body.capture ?? summary.sourceKind ?? null,
      contextUri: body.contextUri ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * Spotify followed/saved show → canonical stub.
 */
export function normalizeSpotifyShow(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "spotify_show",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      showUri: summary.showUri ?? body.showUri ?? envelope.sourceRecordId,
      showId: summary.showId ?? body.showId ?? null,
      name: summary.name ?? body.name ?? null,
      publisher: summary.publisher ?? body.publisher ?? null,
      totalEpisodes: body.totalEpisodes ?? null,
      addedAt: summary.addedAt ?? body.addedAt ?? null,
      capture: body.capture ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * Spotify episode (saved, show feed, or recently played) → canonical stub.
 */
export function normalizeSpotifyEpisode(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "spotify_episode",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      episodeUri: summary.episodeUri ?? body.episodeUri ?? envelope.sourceRecordId,
      episodeId: summary.episodeId ?? body.episodeId ?? null,
      name: summary.name ?? body.name ?? null,
      showUri: summary.showUri ?? body.showUri ?? null,
      showName: summary.showName ?? body.showName ?? null,
      publisher: summary.publisher ?? body.publisher ?? null,
      releaseDate: summary.releaseDate ?? body.releaseDate ?? null,
      addedAt: summary.addedAt ?? body.addedAt ?? null,
      playedAt: summary.playedAt ?? body.playedAt ?? null,
      capture: body.capture ?? summary.capture ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * YouTube video entity → canonical stub.
 */
export function normalizeYoutubeVideo(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "youtube_video",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      videoId: summary.videoId ?? body.videoId ?? envelope.sourceRecordId,
      title: summary.title ?? body.title ?? null,
      channelId: summary.channelId ?? body.channelId ?? null,
      channelTitle: summary.channelTitle ?? body.channelTitle ?? null,
      playlistId: summary.playlistId ?? body.playlistId ?? null,
      playlistItemId: summary.playlistItemId ?? body.playlistItemId ?? null,
      publishedAt: summary.publishedAt ?? body.publishedAt ?? null,
      capture: body.capture ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * YouTube watch (Takeout) or library playlist-item membership → canonical stub.
 */
export function normalizeYoutubeWatch(
  envelope: RawEnvelope,
): CanonicalRecordStub {
  const extra = envelope.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(envelope.body) ? envelope.body : {};

  return {
    recordType: "youtube_watch",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      videoId: summary.videoId ?? body.videoId ?? null,
      title: summary.title ?? body.title ?? null,
      channelTitle: summary.channelTitle ?? body.channelTitle ?? null,
      watchedAt: summary.watchedAt ?? body.watchedAt ?? null,
      playlistId: summary.playlistId ?? body.playlistId ?? null,
      playlistItemId: summary.playlistItemId ?? body.playlistItemId ?? null,
      capture: body.capture ?? summary.sourceKind ?? null,
      occurredAt: envelope.occurredAt ?? summary.occurredAt ?? null,
    },
  };
}

/**
 * Normalize a raw envelope into a canonical stub.
 * Phase 1–3: session shapes for claude-code / codex / cursor / chatgpt;
 * Phase 2b: ebook / bookmark / search_query;
 * Phase 4: github_repo / github_issue / github_pr / github_commit;
 * Phase 5: calendar_event / drive_file / email_message;
 * Phase 5b: spotify_track / spotify_play / spotify_show / spotify_episode /
 * youtube_video / youtube_watch;
 * identity stub otherwise.
 */
export function normalizeRawEnvelope(envelope: RawEnvelope): CanonicalRecordStub {
  const body = isRecord(envelope.body) ? envelope.body : {};
  const kind = typeof body.kind === "string" ? body.kind : "";

  // Hook / live deltas — accept without crashing; promote light metadata only.
  if (
    kind === "claude_hook_delta" ||
    kind === "codex_hook_delta" ||
    kind === "cursor_hook_delta"
  ) {
    const extra = isRecord(envelope.provenance.extra)
      ? envelope.provenance.extra
      : undefined;
    return {
      recordType: "hook_delta",
      source: envelope.source,
      sourceRecordId: envelope.sourceRecordId,
      contentHash: envelope.contentHash,
      payload: {
        kind,
        hook: body.hook ?? extra?.hook ?? null,
        sessionId: body.sessionId ?? null,
        toolName: body.toolName ?? null,
        argsPreview: body.argsPreview ?? null,
        command: body.command ?? null,
        filePath: body.filePath ?? null,
        occurredAt: envelope.occurredAt ?? null,
        provenance: envelope.provenance,
      },
    };
  }

  if (kind === "chatgpt_turn_delta" || kind === "chatgpt_extension_turn") {
    return normalizeChatgptTurnDelta(envelope);
  }

  if (
    envelope.source === "chatgpt-export" ||
    kind === "chatgpt_conversation"
  ) {
    return normalizeChatgptConversation(envelope);
  }

  if (envelope.source === "chatgpt") {
    return normalizeChatgptTurnDelta(envelope);
  }

  if (envelope.source === "claude-code") {
    return normalizeClaudeCodeSession(envelope);
  }
  if (envelope.source === "codex") {
    return normalizeCodexSession(envelope);
  }
  if (envelope.source === "cursor" || kind === "cursor_session") {
    return normalizeCursorSession(envelope);
  }

  if (envelope.source === "calibre" || kind === "calibre_ebook") {
    return normalizeEbook(envelope);
  }
  if (kind === "browser_bookmark") {
    return normalizeBookmark(envelope);
  }
  if (kind === "browser_search_query") {
    return normalizeSearchQuery(envelope);
  }
  if (envelope.source === "browser") {
    // Fallback if kind missing
    if (typeof body.url === "string" && typeof body.guid === "string") {
      return normalizeBookmark(envelope);
    }
    return normalizeSearchQuery(envelope);
  }

  if (
    envelope.source === "github" ||
    kind === "github_repo" ||
    kind === "github_issue" ||
    kind === "github_pr" ||
    kind === "github_commit"
  ) {
    if (kind === "github_repo") return normalizeGithubRepo(envelope);
    if (kind === "github_issue") return normalizeGithubIssue(envelope);
    if (kind === "github_pr") return normalizeGithubPr(envelope);
    if (kind === "github_commit") return normalizeGithubCommit(envelope);
    // Webhook / unknown github kind — keep light stub
    return {
      recordType: kind || "github_event",
      source: envelope.source,
      sourceRecordId: envelope.sourceRecordId,
      contentHash: envelope.contentHash,
      payload: {
        kind: kind || null,
        occurredAt: envelope.occurredAt ?? null,
        provenance: envelope.provenance,
      },
    };
  }

  if (
    envelope.source === "calendar" ||
    kind === "calendar_event"
  ) {
    return normalizeCalendarEvent(envelope);
  }
  if (envelope.source === "drive" || kind === "drive_file") {
    return normalizeDriveFile(envelope);
  }
  if (envelope.source === "gmail" || kind === "email_message") {
    return normalizeEmailMessage(envelope);
  }

  if (kind === "spotify_track" || (envelope.source === "spotify" && kind === "spotify_track")) {
    return normalizeSpotifyTrack(envelope);
  }
  if (kind === "spotify_play") {
    return normalizeSpotifyPlay(envelope);
  }
  if (kind === "spotify_show") {
    return normalizeSpotifyShow(envelope);
  }
  if (kind === "spotify_episode") {
    return normalizeSpotifyEpisode(envelope);
  }
  if (envelope.source === "spotify") {
    if (typeof body.playedAt === "string" && body.kind !== "spotify_episode") {
      return normalizeSpotifyPlay(envelope);
    }
    if (typeof body.showUri === "string" && typeof body.episodeUri !== "string") {
      return normalizeSpotifyShow(envelope);
    }
    if (typeof body.episodeUri === "string") {
      return normalizeSpotifyEpisode(envelope);
    }
    return normalizeSpotifyTrack(envelope);
  }

  if (kind === "youtube_video") {
    return normalizeYoutubeVideo(envelope);
  }
  if (kind === "youtube_watch") {
    return normalizeYoutubeWatch(envelope);
  }
  if (envelope.source === "youtube") {
    if (typeof body.watchedAt === "string" || body.capture === "takeout") {
      return normalizeYoutubeWatch(envelope);
    }
    return normalizeYoutubeVideo(envelope);
  }

  return {
    recordType: "raw_ingest",
    source: envelope.source,
    sourceRecordId: envelope.sourceRecordId,
    contentHash: envelope.contentHash,
    payload: {
      mimeType: envelope.mimeType ?? "application/json",
      occurredAt: envelope.occurredAt ?? null,
      provenance: envelope.provenance,
    },
  };
}
