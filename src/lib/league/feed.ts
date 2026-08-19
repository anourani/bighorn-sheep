/**
 * NFL data-feed health, as the admin modal's Data Feed tab reads it.
 *
 * Pure, and deliberately so: the interesting part of this feature is not
 * fetching a row, it is deciding what four ambiguous states MEAN and writing
 * one sentence each. That decision is worth a test, and it can only have one if
 * it lives away from the component.
 *
 * The shape comes from `feed_status_for_admin` (migration 0011), which returns
 * `{ now, sync }` as jsonb. `now` is the DATABASE's clock and every age below is
 * measured against it — a Netlify container stamped `checked_at`, the browser
 * would otherwise stamp "now", and two machines' clocks are exactly how "checked
 * -3 minutes ago" gets printed.
 */

/** Where the scores come from. `NFL_PROVIDER` is server-side, so this is the only way the browser learns it. */
export type FeedProvider = "espn" | "mock" | (string & {});

export interface FeedSync {
  /** Heartbeat: stamped on EVERY run, whether it worked or not. */
  checkedAt: string;
  status: "ok" | "error";
  detail: string;
  provider: FeedProvider;
  season: number | null;
  /** Only ever advanced by a run that succeeded. Null until one has. */
  lastOkAt: string | null;
  gamesUpserted: number;
  membersUpdated: number;
  error: string | null;
}

export interface FeedSnapshot {
  /** The database's clock at read time. */
  now: string;
  /** Null when the poller has not run since 0011 was applied. */
  sync: FeedSync | null;
}

/**
 * How long without a heartbeat before we stop believing the scorer is running.
 *
 * The cron is every 5 minutes, so this is four consecutive misses. Tighter and a
 * single cold start or a slow ESPN response cries wolf; looser and a genuinely
 * dead scorer goes unnoticed for most of a game.
 *
 * This threshold is the ONLY way a fully dead scorer is detectable. If Netlify
 * stops invoking the function altogether, nothing writes a row at all — `status`
 * stays whatever it last was, forever. A design that trusted `status` alone
 * would report "healthy" indefinitely about a feed that had stopped.
 */
export const FEED_STALE_AFTER_MS = 20 * 60 * 1000;

export type FeedTone = "healthy" | "failing" | "stale" | "unknown";

export interface FeedDescription {
  tone: FeedTone;
  /** One plain sentence. No jargon — a co-admin should not need to know what a cron is. */
  headline: string;
  /** The supporting line. May be empty. */
  detail: string;
  /** Provider label for the status chip, or null when nothing has run. */
  provider: string | null;
}

/**
 * Parse whatever `feed_status_for_admin` returned.
 *
 * Defensive because the value crosses the PostgREST boundary as `unknown` (the
 * jsonb precedent set by `public_league_snapshot`), and because a database that
 * has not had 0011 applied can return shapes this code has never seen. Anything
 * unrecognisable becomes null, which the caller renders as "unknown" rather than
 * crashing an admin's settings modal.
 */
export function mapFeedStatus(raw: unknown): FeedSnapshot | null {
  if (!isRecord(raw)) return null;
  const now = typeof raw.now === "string" ? raw.now : null;
  if (!now) return null;

  const sync = raw.sync;
  if (!isRecord(sync)) return { now, sync: null };

  const checkedAt = typeof sync.checkedAt === "string" ? sync.checkedAt : null;
  if (!checkedAt) return { now, sync: null };

  return {
    now,
    sync: {
      checkedAt,
      status: sync.status === "error" ? "error" : "ok",
      detail: typeof sync.detail === "string" ? sync.detail : "",
      provider: typeof sync.provider === "string" ? sync.provider : "unknown",
      season: typeof sync.season === "number" ? sync.season : null,
      lastOkAt: typeof sync.lastOkAt === "string" ? sync.lastOkAt : null,
      gamesUpserted: typeof sync.gamesUpserted === "number" ? sync.gamesUpserted : 0,
      membersUpdated: typeof sync.membersUpdated === "number" ? sync.membersUpdated : 0,
      error: typeof sync.error === "string" && sync.error.length > 0 ? sync.error : null,
    },
  };
}

/**
 * Turn a snapshot into the sentence the tab prints.
 *
 * Order matters. Staleness is tested BEFORE `status`, because a run that ended
 * 40 minutes ago tells you nothing useful about right now — "it isn't running"
 * is both more urgent and more actionable than whatever that stale run happened
 * to conclude.
 */
export function describeFeed(snapshot: FeedSnapshot | null): FeedDescription {
  if (!snapshot || !snapshot.sync) {
    return {
      tone: "unknown",
      headline: "No score checks recorded yet",
      detail:
        "The scorer writes a line here every time it runs. If this doesn't fill in within about ten minutes, it isn't running.",
      provider: null,
    };
  }

  const { sync, now } = snapshot;
  const provider = providerLabel(sync.provider);
  const age = ageMs(sync.checkedAt, now);

  if (age === null || age > FEED_STALE_AFTER_MS) {
    return {
      tone: "stale",
      headline: "Scores haven't been checked recently",
      detail: `The scorer should run every five minutes, but the last attempt was ${agoLabel(sync.checkedAt, now)}. Scores may be out of date.`,
      provider,
    };
  }

  if (sync.status === "error") {
    const lastGood = sync.lastOkAt
      ? `The last successful update was ${agoLabel(sync.lastOkAt, now)}.`
      : "It hasn't succeeded yet.";
    return {
      tone: "failing",
      headline: "The score feed is failing",
      // The provider's own message, last: useful when it's readable, harmless
      // when it isn't, and never the first thing an admin has to parse.
      detail: [`Checked ${agoLabel(sync.checkedAt, now)}.`, lastGood, sync.error ?? ""]
        .filter(Boolean)
        .join(" "),
      provider,
    };
  }

  return {
    tone: "healthy",
    headline: "Scores are updating normally",
    detail: `Checked ${agoLabel(sync.checkedAt, now)}.`,
    provider,
  };
}

/**
 * "just now" / "3 minutes ago" / "2 hours ago" / "3 days ago".
 *
 * A FUTURE timestamp reads "just now", never "in -3 minutes": the two clocks
 * involved are a Netlify container's and Postgres's, and a second of skew
 * between them must not produce a nonsense string in front of a user.
 */
export function agoLabel(fromIso: string, nowIso: string): string {
  const ms = ageMs(fromIso, nowIso);
  if (ms === null) return "at an unknown time";
  if (ms < 45_000) return "just now";

  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Milliseconds between two ISO strings, clamped at zero. Null when either is unparseable. */
function ageMs(fromIso: string, nowIso: string): number | null {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null;
  return Math.max(0, now - from);
}

/** "espn" is a brand, "mock" is a warning — neither should print lowercase. */
export function providerLabel(provider: string): string {
  if (provider === "espn") return "ESPN";
  if (provider === "mock") return "Mock data";
  return provider;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
