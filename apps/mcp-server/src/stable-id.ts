/**
 * Deterministic UUID-shaped ids for distillate subject_id (schema requires uuid).
 */
import { createHash } from "node:crypto";

export function stableSubjectUuid(namespace: string, key: string): string {
  const hex = createHash("sha256")
    .update(`${namespace}:${key}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
