import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * A cookie-free anon client, for the one public read the app has: the landing
 * page's league snapshot.
 *
 * Three deliberate differences from `server.ts` and `client.ts`:
 *
 *  - It uses `@supabase/supabase-js` directly rather than `@supabase/ssr`, so
 *    nothing here touches `cookies()`. The landing page has no session to read
 *    and stays statically renderable.
 *  - No session persistence or token refresh — there is no session.
 *  - **It returns null instead of throwing** when the env vars are missing.
 *    `createClient()` throwing is right for /app, where a missing env var means
 *    a broken product and the error boundary should say so. On `/` it would
 *    take the front door down for every stranger, including the invite flow,
 *    which still works without Supabase (InviteEntry falls through to /login).
 */
export function createPublicClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
