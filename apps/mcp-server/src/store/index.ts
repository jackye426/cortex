import { isSupabaseConfigured, type SupabaseStoreKind } from "../env.js";
import { FixtureStore } from "./fixture-store.js";
import { SupabaseStore } from "./supabase-store.js";
import type { CortexStore } from "./types.js";

export type { CortexStore } from "./types.js";

/**
 * Prefer Supabase when URL + gateway key are set; otherwise fixture mode.
 * @param kind vault = service_role (Ops/compilers); mirror = SUPABASE_MIRROR_KEY when set
 */
export function createStore(kind: SupabaseStoreKind = "vault"): CortexStore {
  if (process.env.CORTEX_FORCE_FIXTURE?.trim() === "1") {
    return new FixtureStore();
  }
  if (isSupabaseConfigured()) {
    try {
      return SupabaseStore.fromEnv(kind);
    } catch (err) {
      console.warn(
        "[store] Supabase init failed; falling back to fixtures:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return new FixtureStore();
}
