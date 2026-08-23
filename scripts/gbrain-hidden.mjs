import { spawn } from "node:child_process";
import { join } from "node:path";

// Bun + gbrain CLI, hidden. Git flashes are suppressed in gbrain's
// execFileSync sites via windowsHide (a custom git.exe shim is blocked
// by Windows Application Control on this machine).

const bunBin = join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".bun",
  "bin",
);
const bun = join(bunBin, "bun.exe");
const cli = join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".bun",
  "install",
  "global",
  "node_modules",
  "gbrain",
  "src",
  "cli.ts",
);

const child = spawn(bun, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    PATH: `${bunBin};${process.env.PATH ?? ""}`,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
