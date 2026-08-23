import { spawnSync } from "node:child_process";

// GBrain only sees committed files, and no gbrain command commits for us.
// Everything downstream of the commit (sync, embed, lint, extract, synthesize)
// belongs to the autopilot daemon — keep it out of here so the two don't
// contend for the same sync/embed locks.

const repo = "C:\\Users\\yulon\\Desktop\\Current Projects\\brain";
const intervalMs = 180_000;
const env = {
  ...process.env,
  PATH: `C:\\Users\\yulon\\.bun\\bin;${process.env.PATH ?? ""}`,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "jackye426",
  GIT_AUTHOR_EMAIL:
    process.env.GIT_AUTHOR_EMAIL || "jackye426@users.noreply.github.com",
  GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "jackye426",
  GIT_COMMITTER_EMAIL:
    process.env.GIT_COMMITTER_EMAIL || "jackye426@users.noreply.github.com",
};

function git(args) {
  return spawnSync("git", args, { cwd: repo, env, encoding: "utf8" });
}

function commitCollectorPages() {
  git(["add", "--", "hooks", "mail", "drive", "conversations"]);
  git(["add", "--", "calendar"]);
  git(["reset", "-q", "--", "calendar/primary"]);
  const staged = git(["diff", "--cached", "--name-only"]);
  const files = (staged.stdout ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!files.length) return 0;
  const committed = git(["commit", "-m", "collector catch-up"]);
  if (committed.status !== 0) {
    console.error("[gbrain-commit] commit failed", committed.stderr);
    return 0;
  }
  return files.length;
}

function tick() {
  const count = commitCollectorPages();
  if (count) {
    console.log(
      `[gbrain-commit] ${new Date().toISOString()} committed ${count} page(s); autopilot will sync + embed`,
    );
  }
}

for (;;) {
  try {
    tick();
  } catch (err) {
    console.error("[gbrain-commit] tick error", err);
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}
