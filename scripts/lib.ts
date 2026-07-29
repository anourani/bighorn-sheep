import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

/**
 * Shared helpers for the pre-season dry-run harness (seed-test-week / sim-advance).
 * These are LOCAL developer tools: they use the Supabase service-role key, so
 * they bypass RLS and can write games/entry deadlines directly. Never ship this
 * key to a browser.
 */

/** Load .env.local into process.env (without overriding already-set vars). */
export function loadEnvLocal(): void {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!;
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // No .env.local — rely on ambient environment variables.
  }
}

export type Service = SupabaseClient<Database>;

export function serviceClient(): Service {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing config. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/** Read `--name=value` from argv, falling back to the NAME env var, then default. */
export function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  return process.env[name.toUpperCase().replace(/-/g, "_")] ?? fallback;
}

/** A comma-list flag → trimmed non-empty items. */
export function listArg(name: string): string[] {
  return (arg(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const isUuid = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
