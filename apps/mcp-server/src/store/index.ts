import { isSupabaseConfigured } from "../env.js";
import { FixtureStore } from "./fixture-store.js";
import { SupabaseStore } from "./supabase-store.js";
import type { CortexStore } from "./types.js";

export type { CortexStore } from "./types.js";

/** Prefer Supabase when URL + key are set; otherwise fixture mode. */
export function createStore(): CortexStore {
  if (isSupabaseConfigured()) {
    try {
      return SupabaseStore.fromEnv();
    } catch (err) {
      console.warn(
        "[store] Supabase init failed; falling back to fixtures:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return new FixtureStore();
}
