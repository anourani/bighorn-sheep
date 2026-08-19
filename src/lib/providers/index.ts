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

/**
 * Which provider `getNflProvider()` will build, as a bare string.
 *
 * `NFL_PROVIDER` is server-side only — deliberately not `NEXT_PUBLIC_` — so the
 * browser cannot read it. The admin modal's Data Feed tab therefore has to be
 * TOLD the provider, and the scorer records this alongside each run. Sharing one
 * source of truth with `getNflProvider` is what stops the recorded name and the
 * instantiated provider drifting apart.
 */
export function nflProviderName(): string {
  return (process.env.NFL_PROVIDER ?? "espn").toLowerCase() === "mock" ? "mock" : "espn";
}

/** For tests that need to force a specific provider. */
export function __setNflProvider(provider: NflProvider | null): void {
  cached = provider;
}
