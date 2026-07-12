import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BrowserKind = "chrome" | "edge";

export interface BrowserProfileRef {
  browser: BrowserKind;
  /** Profile directory name, e.g. `Default`, `Profile 2`. */
  profile: string;
  /** Absolute profile directory. */
  profileDir: string;
  bookmarksPath: string;
  historyPath: string;
  /** Checkpoint account key: `{browser}:{profile}`. */
  accountKey: string;
}

function localAppData(): string {
  return (
    process.env.LOCALAPPDATA ??
    join(homedir(), "AppData", "Local")
  );
}

export function defaultChromeUserDataRoot(): string {
  return join(localAppData(), "Google", "Chrome", "User Data");
}

export function defaultEdgeUserDataRoot(): string {
  return join(localAppData(), "Microsoft", "Edge", "User Data");
}

const SKIP_DIRS = new Set([
  "System Profile",
  "Guest Profile",
  "Crashpad",
  "GrShaderCache",
  "ShaderCache",
  "GraphiteDawnCache",
  "BrowserMetrics",
  "Crowd Deny",
  "Safe Browsing",
  "segmentation_platform",
  "OptimizationGuide",
  "component_crx_cache",
  "extensions_crx_cache",
  "File Type Policies",
  "hyphen-data",
  "MEIPreload",
  "PKIMetadata",
  "SSLErrorAssistant",
  "OriginTrials",
  "CertificateRevocation",
  "PrivacySandboxAttestationsPreloaded",
]);

/**
 * Discover Chrome/Edge profiles that have Bookmarks and/or History.
 */
export function listBrowserProfiles(options?: {
  chromeRoot?: string | null;
  edgeRoot?: string | null;
}): BrowserProfileRef[] {
  const out: BrowserProfileRef[] = [];
  const chromeRoot =
    options?.chromeRoot === null
      ? null
      : (options?.chromeRoot ?? defaultChromeUserDataRoot());
  const edgeRoot =
    options?.edgeRoot === null
      ? null
      : (options?.edgeRoot ?? defaultEdgeUserDataRoot());

  if (chromeRoot) {
    out.push(...profilesUnder("chrome", chromeRoot));
  }
  if (edgeRoot) {
    out.push(...profilesUnder("edge", edgeRoot));
  }
  return out;
}

function profilesUnder(
  browser: BrowserKind,
  userDataRoot: string,
): BrowserProfileRef[] {
  if (!existsSync(userDataRoot)) return [];
  let entries: string[];
  try {
    entries = readdirSync(userDataRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }

  const out: BrowserProfileRef[] = [];
  for (const profile of entries) {
    const profileDir = join(userDataRoot, profile);
    const bookmarksPath = join(profileDir, "Bookmarks");
    const historyPath = join(profileDir, "History");
    if (!existsSync(bookmarksPath) && !existsSync(historyPath)) continue;
    out.push({
      browser,
      profile,
      profileDir,
      bookmarksPath,
      historyPath,
      accountKey: `${browser}:${profile}`,
    });
  }
  return out;
}
