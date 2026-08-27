#!/usr/bin/env node
/**
 * Print a GitHub App Manifest form for Company Brain V0.
 *
 * GitHub App creation cannot be completed with the repo installation token
 * used by this cloud agent — you must submit the manifest in a browser once.
 *
 * Usage:
 *   COMPANY_BRAIN_PUBLIC_URL=https://company-brain.example.com \
 *     node scripts/company-brain-github-app-manifest.mjs
 *
 * Optional:
 *   COMPANY_BRAIN_GITHUB_APP_NAME=forma-company-brain
 *   COMPANY_BRAIN_GITHUB_ORG=   # if set, posts to org settings
 *
 * After create + install on allowlisted repos, set:
 *   COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET
 *   COMPANY_BRAIN_GITHUB_INSTALLATION_IDS
 *   COMPANY_BRAIN_GITHUB_ALLOWED_REPOS
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const publicUrl = (process.env.COMPANY_BRAIN_PUBLIC_URL ?? "").replace(/\/$/, "");
if (!publicUrl) {
  console.error(
    "COMPANY_BRAIN_PUBLIC_URL is required (origin of the Company Brain service).\n" +
      "Example: https://company-brain-production.up.railway.app",
  );
  process.exit(1);
}

const name =
  process.env.COMPANY_BRAIN_GITHUB_APP_NAME?.trim() || "forma-company-brain";
const org = process.env.COMPANY_BRAIN_GITHUB_ORG?.trim() || "";
const state = randomBytes(16).toString("hex");

const manifest = {
  name,
  url: publicUrl,
  hook_attributes: {
    url: `${publicUrl}/v1/webhooks/github`,
    active: true,
  },
  redirect_url: `${publicUrl}/health`,
  description:
    "Forma Company Brain — signed GitHub evidence ingest (PRs, reviews, issues, checks, deployments).",
  public: false,
  default_permissions: {
    contents: "read",
    issues: "read",
    pull_requests: "read",
    checks: "read",
    actions: "read",
    deployments: "read",
    metadata: "read",
  },
  default_events: [
    "pull_request",
    "pull_request_review",
    "issues",
    "check_run",
    "check_suite",
    "workflow_run",
    "deployment",
    "deployment_status",
  ],
};

const action = org
  ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${state}`
  : `https://github.com/settings/apps/new?state=${state}`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Register ${name}</title>
</head>
<body>
  <h1>Register Company Brain GitHub App</h1>
  <p>Webhook: <code>${manifest.hook_attributes.url}</code></p>
  <form action="${action}" method="post">
    <input type="hidden" name="manifest" id="manifest" />
    <button type="submit">Create GitHub App on GitHub</button>
  </form>
  <script>
    document.getElementById("manifest").value = ${JSON.stringify(JSON.stringify(manifest))};
  </script>
  <pre>${JSON.stringify(manifest, null, 2)}</pre>
</body>
</html>
`;

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = resolve(root, "apps/company-brain/github-app-manifest.html");
writeFileSync(out, html, "utf8");

console.log(JSON.stringify({ action, state, manifest, htmlPath: out }, null, 2));
console.log(
  `\nOpen ${out} in a browser (or POST the manifest to GitHub),\n` +
    `install the app on allowlisted Forma repos only, then set env:\n` +
    `  COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET=<from app settings or manifest conversion>\n` +
    `  COMPANY_BRAIN_GITHUB_INSTALLATION_IDS=<installation id>\n` +
    `  COMPANY_BRAIN_GITHUB_ALLOWED_REPOS=owner/repo,...`,
);
