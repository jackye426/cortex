/**
 * Drive sensitivity gate for L1 writers (reuse drive-file-v2 skip rules).
 */
import { redactText } from "@cortex/redaction";

export type DriveSensitiveReason =
  | "path"
  | "filename"
  | "secret_pattern"
  | "pii_heuristic"
  | "allowlist";

const DEFAULT_SENSITIVE_PATH_SUBSTR = [
  "password",
  "passwords",
  "credentials",
  "secrets",
  "private",
  "tax",
  "passport",
  "bank",
  "ssn",
  "identity",
  "2fa",
  "recovery codes",
];

const SENSITIVE_FILENAME_RE =
  /\b(password|passwd|credential|secret|api[_-]?keys?|private[_-]?key|recovery|otp|pin|passport|national.?id|ni.?number|driving.?licen[cs]e|birth.?cert|medical.?record)\b/i;

const PII_HEURISTIC_RE =
  /\bpassword\s*[:=]|iban\b|\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b|\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/i;

export function driveSensitiveReasonsFromPayload(
  payload: Record<string, unknown>,
): DriveSensitiveReason[] {
  const reasons: DriveSensitiveReason[] = [];
  const name = String(payload.name ?? payload.title ?? "");
  const path = String(
    payload.folderPath ??
      payload.path ??
      payload.parentsPath ??
      payload.fullPath ??
      "",
  );
  const haystack = `${path} ${name}`.toLowerCase();

  const denylist = (
    process.env.CORTEX_DRIVE_SENSITIVE_PATHS?.trim()
      ? process.env.CORTEX_DRIVE_SENSITIVE_PATHS.split(",")
      : DEFAULT_SENSITIVE_PATH_SUBSTR
  )
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  for (const needle of denylist) {
    if (needle && haystack.includes(needle)) {
      reasons.push("path");
      break;
    }
  }
  if (SENSITIVE_FILENAME_RE.test(name)) {
    reasons.push("filename");
  }

  const preview = String(
    payload.textPreview ?? payload.exportText ?? payload.content ?? "",
  );
  if (preview) {
    const secrets = redactText(preview);
    if (secrets.redacted) reasons.push("secret_pattern");
    if (PII_HEURISTIC_RE.test(preview)) reasons.push("pii_heuristic");
  }

  return reasons;
}
