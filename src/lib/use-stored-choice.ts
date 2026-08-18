"use client";

import { useCallback, useEffect, useState } from "react";
import { readStoredChoice } from "@/lib/prefs";

/**
 * A small union-typed preference backed by `localStorage`.
 *
 * The first render always uses `fallback` and the stored value is read in an
 * effect, which is deliberate rather than lazy: the server has no `localStorage`,
 * so seeding state from it in a `useState` initializer renders different markup
 * on the two sides and React throws a hydration mismatch. The same shape as
 * `LocalTime`, which renders US-Eastern on the server and swaps to the browser's
 * zone after mount.
 *
 * The visible cost is a flash for anyone whose choice is not the default. It is
 * one paint, and it only reaches people who have changed the setting.
 *
 * Both reads and writes are wrapped: `localStorage` is not merely empty in
 * Safari's private mode and under a blocked-cookies policy, it throws on access.
 */
export function useStoredChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      setValue(readStoredChoice(window.localStorage.getItem(key), allowed, fallback));
    } catch {
      // Storage unavailable — the fallback already in state is the answer.
    }
    // `allowed` is a literal array at every call site, so a new identity each
    // render; depending on it would re-run this on every render and stomp the
    // user's in-session choice back to whatever is stored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fallback]);

  const choose = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Unwritable storage costs persistence, not the interaction.
      }
    },
    [key],
  );

  return [value, choose];
}
