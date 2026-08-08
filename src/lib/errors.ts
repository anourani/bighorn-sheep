/**
 * Turning an unknown error into something a person can read.
 *
 * The motivating case: Supabase's auth-js short-circuits on *any* 5xx before it
 * parses the response body, then builds the error message with
 * `JSON.stringify(response)`. A `Response` has no own enumerable properties, so
 * that is always the literal two-character string "{}" — which is truthy, so the
 * usual `error.message || "something friendly"` renders "{}" to the user. It did.
 */

/** Machine noise that some clients put in `.message`. Never show these. */
function isJunk(value: string): boolean {
  const t = value.trim();
  return t === "" || t === "{}" || t === "[]" || t === "null" || t === "undefined";
}

/**
 * Coerce an unknown error into prose safe to render, preferring the most
 * specific usable text and falling back through status codes to `fallback`.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return isJunk(error) ? fallback : error;
  if (!error || typeof error !== "object") return fallback;

  const e = error as {
    message?: unknown;
    error_description?: unknown;
    msg?: unknown;
    error?: unknown;
    status?: unknown;
  };

  for (const candidate of [e.message, e.error_description, e.msg, e.error]) {
    if (typeof candidate === "string" && !isJunk(candidate)) return candidate;
  }

  // No usable prose, but a status code still lets us say something true rather
  // than something generic.
  if (typeof e.status === "number") {
    if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (e.status >= 500) return "Our sign-in service is having trouble. Try again in a minute.";
  }

  return fallback;
}
