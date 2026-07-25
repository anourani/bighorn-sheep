import { EspnProvider } from "./espn";
import { MockProvider } from "./mock";
import type { NflProvider } from "./types";

export type { NflProvider, WeekQuery } from "./types";
export { EspnProvider } from "./espn";
export { MockProvider } from "./mock";

let cached: NflProvider | null = null;

/**
 * The single place the rest of the app obtains NFL data. Swapping providers is
 * a one-line change here (or a `NFL_PROVIDER` env flip) — no caller touches a
 * vendor SDK directly. This is the seam the PRD's data-provider risk hinges on.
 */
export function getNflProvider(): NflProvider {
  if (cached) return cached;
  const which = (process.env.NFL_PROVIDER ?? "espn").toLowerCase();
  cached = which === "mock" ? new MockProvider() : new EspnProvider();
  return cached;
}

/** For tests that need to force a specific provider. */
export function __setNflProvider(provider: NflProvider | null): void {
  cached = provider;
}
