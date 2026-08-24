import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Bun ignores windowsHide on git, so CREATE_NO_WINDOW never reaches git.exe.
// Attach a hidden console in a Bun host, then spawn the CLI without
// windowsHide so git children inherit that console instead of flashing.

const bunBin = join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".bun",
  "bin",
);
const bun = join(bunBin, "bun.exe");
const gitMingwBin = "C:\\Program Files\\Git\\mingw64\\bin";
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
const env = {
  ...process.env,
  PATH: `${gitMingwBin};${bunBin};${process.env.PATH ?? ""}`,
};

function forwardExit(child) {
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

async function attachHiddenConsole() {
  const { dlopen, FFIType } = await import("bun:ffi");
  const kernel32 = dlopen("kernel32.dll", {
    AllocConsole: { args: [], returns: FFIType.bool },
    FreeConsole: { args: [], returns: FFIType.bool },
    GetConsoleWindow: { args: [], returns: FFIType.ptr },
    GetStdHandle: { args: [FFIType.i32], returns: FFIType.ptr },
    SetStdHandle: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.bool },
  });
  const user32 = dlopen("user32.dll", {
    ShowWindowAsync: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool },
  });
  const savedOut = kernel32.symbols.GetStdHandle(-11);
  const savedErr = kernel32.symbols.GetStdHandle(-12);
  kernel32.symbols.FreeConsole();
  kernel32.symbols.AllocConsole();
  const hwnd = kernel32.symbols.GetConsoleWindow();
  if (hwnd) user32.symbols.ShowWindowAsync(hwnd, 0);
  if (savedOut) kernel32.symbols.SetStdHandle(-11, savedOut);
  if (savedErr) kernel32.symbols.SetStdHandle(-12, savedErr);
}

if (typeof globalThis.Bun === "undefined") {
  const child = spawn(
    bun,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      stdio: "inherit",
      windowsHide: true,
      env,
    },
  );
  forwardExit(child);
} else {
  await attachHiddenConsole();
  const child = spawn(bun, [cli, ...process.argv.slice(2)], {
    stdio: "inherit",
    windowsHide: false,
    env,
  });
  forwardExit(child);
}
