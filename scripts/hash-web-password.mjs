import { randomBytes, scryptSync } from "node:crypto";

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }
  return new Promise((resolve, reject) => {
    const chars = [];
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    };
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(chars.join(""));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (chars.length > 0) {
            chars.pop();
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (char >= " ") {
          chars.push(char);
          process.stdout.write("*");
        }
      }
    };
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

const first = await readHidden("New jackye.wiki password: ");
const second = await readHidden("Confirm password: ");
if (first.length < 12) throw new Error("Use at least 12 characters.");
if (first !== second) throw new Error("Passwords did not match.");
const salt = randomBytes(16);
const derived = scryptSync(first, salt, 64);
process.stdout.write(
  `CORTEX_WEB_PASSWORD_HASH=scrypt$${salt.toString("hex")}$${derived.toString("hex")}\n`,
);
