import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * SERVER ONLY. Never import this from a `"use client"` file.
 *
 * The service role bypasses RLS entirely, so this client can read and write
 * every row in every league. It exists because two things genuinely need it:
 * `record_feed_sync` is granted to `service_role` alone (migration 0011), and
 * the scorer's `upsertGames` / `recomputeSeason` write tables no player policy
 * allows. Exactly two files import it — `netlify/functions/poll-scores.ts` and
 * the `runFeedCheck` server action — and that list should stay short enough to
 * hold in your head.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` has no `NEXT_PUBLIC_` prefix, so it is never
 * inlined into the browser bundle; an accidental client import would fail at
 * build rather than leak the key. That is a backstop, not the rule.
 *
 * Returns NULL rather than throwing when the key is absent. The caller can then
 * say something true — "manual checks aren't configured on this deployment" —
 * instead of surfacing an opaque exception, and the scheduled scorer keeps its
 * existing "no-op cleanly when Supabase isn't configured" behaviour.
 */
export function serviceClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient<Database>(url, serviceKey, { auth: { persistSession: false } });
}
