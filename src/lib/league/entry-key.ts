/**
 * How a pick row is matched to the ENTRY that made it (migration 0017).
 *
 * A LEAF — one concept, no imports — because both halves of the app need it and
 * they live on opposite sides of the tree: `league/load.ts` reads picks for the
 * screen, `game/score.ts` reads them for the scorer. Keyed differently, those
 * two disagree about whose pick is whose, which is exactly the bug this module
 * exists to make impossible.
 *
 * `picks` carries (group_id, user_id, entry_no) rather than a membership id —
 * see the note on `picks.entry_no` in src/lib/supabase/types.ts for why it was
 * left that way — so the identity of an entry is the PAIR, never the user id
 * alone. One person may hold two entries and they are wholly independent:
 * separate picks, separate strikes, separate elimination.
 *
 * The `?? 1` lives here and nowhere else. Until 0017 is applied by hand the
 * column does not exist, so `select("*")` omits the key and every row is
 * `undefined` at runtime while the row type says `1 | 2`. Folding both sides to
 * entry 1 is what makes a pre-0017 database behave exactly as it did before —
 * by construction rather than by luck.
 */

/** The grouping key for one entry: `"<user_id>|<entry_no>"`. */
export function entryKey(userId: string, entryNo: number | null | undefined): string {
  return `${userId}|${entryNo ?? 1}`;
}

/**
 * Bucket rows by entry.
 *
 * Generic over the row rather than typed to `PickRow`, so this module stays a
 * leaf: importing the generated `Database` types to name one field would pull
 * the whole Supabase type tree into the scorer's dependency graph for nothing.
 * Anything with a `user_id` and an `entry_no` groups.
 *
 * Insertion order is preserved within a bucket; callers that need a particular
 * order sort for themselves.
 */
export function groupPicksByEntry<T extends { user_id: string; entry_no?: number | null }>(
  rows: readonly T[] | null | undefined,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows ?? []) {
    const key = entryKey(row.user_id, row.entry_no);
    const arr = out.get(key);
    if (arr) arr.push(row);
    else out.set(key, [row]);
  }
  return out;
}
