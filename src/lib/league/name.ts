/**
 * Player identity display. We store a real first + last name and render everyone
 * uniformly as "First L." (e.g. "Alex N.") — there is no free-text display name.
 * Both helpers are total: they never return an empty string, so an avatar circle
 * or a name label is always populated even for legacy / partial data.
 */

/** "Alex", "Nourani" → "Alex N.". Last name optional; falls back when both blank. */
export function formatDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback = "Player",
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (!first && !last) return fallback.trim() || "Player";
  if (!last) return first;
  if (!first) return `${last[0]!.toUpperCase()}.`;
  return `${first} ${last[0]!.toUpperCase()}.`;
}

/**
 * Avatar initials: first-initial + last-initial ("AN"). With no last name, uses
 * the first two letters of the first name; guarantees a non-empty result ("?").
 */
export function initials(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (first && last) return (first[0]! + last[0]!).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (last) return last.slice(0, 2).toUpperCase();
  return "?";
}
