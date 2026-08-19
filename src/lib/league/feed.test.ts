import { describe, expect, it } from "vitest";
import {
  FEED_MANUAL_COOLDOWN_MS,
  FEED_STALE_AFTER_MS,
  agoLabel,
  describeFeed,
  describeFeedDetail,
  feedCheckedRecently,
  mapFeedStatus,
  providerLabel,
  type FeedSnapshot,
} from "./feed";

const NOW = "2026-09-14T18:00:00.000Z";

/** A healthy sync `agoMs` before NOW. */
function snapshot(agoMs: number, over: Partial<NonNullable<FeedSnapshot["sync"]>> = {}): FeedSnapshot {
  return {
    now: NOW,
    sync: {
      checkedAt: new Date(Date.parse(NOW) - agoMs).toISOString(),
      status: "ok",
      detail: "",
      provider: "espn",
      season: 2026,
      lastOkAt: new Date(Date.parse(NOW) - agoMs).toISOString(),
      gamesUpserted: 14,
      membersUpdated: 8,
      error: null,
      ...over,
    },
  };
}

describe("mapFeedStatus", () => {
  it("rejects anything that isn't a { now, sync } object", () => {
    for (const bad of [null, undefined, 42, "nope", [], {}, { sync: {} }]) {
      expect(mapFeedStatus(bad)).toBeNull();
    }
  });

  it("keeps `now` but nulls `sync` when the poller has never run", () => {
    expect(mapFeedStatus({ now: NOW, sync: null })).toEqual({ now: NOW, sync: null });
  });

  it("treats a sync with no checkedAt as no sync at all — every age depends on it", () => {
    expect(mapFeedStatus({ now: NOW, sync: { status: "ok" } })).toEqual({ now: NOW, sync: null });
  });

  it("coerces wrong-typed fields rather than trusting them", () => {
    const mapped = mapFeedStatus({
      now: NOW,
      sync: {
        checkedAt: NOW,
        status: "something-else",
        detail: 5,
        provider: null,
        season: "2026",
        lastOkAt: 12,
        gamesUpserted: "many",
        membersUpdated: null,
        error: "",
      },
    });
    // An unrecognised status must not read as an error — that would report a
    // healthy feed as broken on a shape change.
    expect(mapped?.sync?.status).toBe("ok");
    expect(mapped?.sync?.detail).toBe("");
    expect(mapped?.sync?.provider).toBe("unknown");
    expect(mapped?.sync?.season).toBeNull();
    expect(mapped?.sync?.lastOkAt).toBeNull();
    expect(mapped?.sync?.gamesUpserted).toBe(0);
    expect(mapped?.sync?.membersUpdated).toBe(0);
    // An empty error string is not an error.
    expect(mapped?.sync?.error).toBeNull();
  });
});

describe("describeFeed", () => {
  it("reports unknown when nothing has ever run", () => {
    expect(describeFeed(null).tone).toBe("unknown");
    expect(describeFeed({ now: NOW, sync: null }).tone).toBe("unknown");
  });

  it("reports healthy for a recent successful run", () => {
    const d = describeFeed(snapshot(3 * 60_000));
    expect(d.tone).toBe("healthy");
    expect(d.headline).toBe("Scores are updating normally");
    expect(d.detail).toContain("3 minutes ago");
    expect(d.provider).toBe("ESPN");
  });

  it("reports failing — not stale — for a fresh run that errored", () => {
    const d = describeFeed(
      snapshot(2 * 60_000, {
        status: "error",
        error: "ESPN returned 503",
        lastOkAt: new Date(Date.parse(NOW) - 2 * 60 * 60_000).toISOString(),
      }),
    );
    expect(d.tone).toBe("failing");
    // The distinction the two timestamps exist for: we ARE checking, and it is
    // failing — which is a different problem from nothing running.
    expect(d.detail).toContain("2 hours ago");
    expect(d.detail).toContain("ESPN returned 503");
  });

  it("says so plainly when a failing feed has never once succeeded", () => {
    const d = describeFeed(snapshot(60_000, { status: "error", lastOkAt: null, error: null }));
    expect(d.tone).toBe("failing");
    expect(d.detail).toContain("hasn't succeeded yet");
  });

  it("reports stale once the heartbeat stops, even though the last run said ok", () => {
    const d = describeFeed(snapshot(FEED_STALE_AFTER_MS + 60_000));
    // This is the only case a status-only design cannot see: a scorer that stops
    // being invoked writes nothing, so `status` stays "ok" forever.
    expect(d.tone).toBe("stale");
    expect(d.headline).toBe("Scores haven't been checked recently");
  });

  it("lets staleness win over a stale error, because 'not running' is the bigger fact", () => {
    const d = describeFeed(snapshot(FEED_STALE_AFTER_MS + 60_000, { status: "error" }));
    expect(d.tone).toBe("stale");
  });

  it("is still healthy exactly at the threshold", () => {
    expect(describeFeed(snapshot(FEED_STALE_AFTER_MS)).tone).toBe("healthy");
  });
});

describe("agoLabel", () => {
  it("rounds to the largest sensible unit", () => {
    expect(agoLabel(iso(0), NOW)).toBe("just now");
    expect(agoLabel(iso(30_000), NOW)).toBe("just now");
    expect(agoLabel(iso(60_000), NOW)).toBe("1 minute ago");
    expect(agoLabel(iso(3 * 60_000), NOW)).toBe("3 minutes ago");
    expect(agoLabel(iso(60 * 60_000), NOW)).toBe("1 hour ago");
    expect(agoLabel(iso(5 * 60 * 60_000), NOW)).toBe("5 hours ago");
    expect(agoLabel(iso(3 * 24 * 60 * 60_000), NOW)).toBe("3 days ago");
  });

  it("reads a future timestamp as 'just now' rather than negative time", () => {
    // Postgres stamps checked_at, the read returns Postgres's now() — but a
    // second of skew between any two clocks must never print "in -3 minutes".
    expect(agoLabel(iso(-90_000), NOW)).toBe("just now");
  });

  it("does not throw on an unparseable timestamp", () => {
    expect(agoLabel("not-a-date", NOW)).toBe("at an unknown time");
  });
});

describe("providerLabel", () => {
  it("names the mock provider unmistakably — silent mock data is the trap", () => {
    expect(providerLabel("espn")).toBe("ESPN");
    expect(providerLabel("mock")).toBe("Mock data");
    expect(providerLabel("whatever")).toBe("whatever");
  });
});

function iso(agoMs: number): string {
  return new Date(Date.parse(NOW) - agoMs).toISOString();
}

describe("feedCheckedRecently", () => {
  it("is false when nothing has ever run — a manual check is exactly what's wanted", () => {
    expect(feedCheckedRecently(null, FEED_MANUAL_COOLDOWN_MS)).toBe(false);
    expect(feedCheckedRecently({ now: NOW, sync: null }, FEED_MANUAL_COOLDOWN_MS)).toBe(false);
  });

  it("blocks a second check inside the cooldown", () => {
    expect(feedCheckedRecently(snapshot(10_000), FEED_MANUAL_COOLDOWN_MS)).toBe(true);
  });

  it("allows one again past the cooldown, and exactly at the boundary", () => {
    expect(feedCheckedRecently(snapshot(FEED_MANUAL_COOLDOWN_MS), FEED_MANUAL_COOLDOWN_MS)).toBe(false);
    expect(feedCheckedRecently(snapshot(5 * 60_000), FEED_MANUAL_COOLDOWN_MS)).toBe(false);
  });

  it("fails OPEN on an unreadable timestamp rather than stranding the button", () => {
    const bad: FeedSnapshot = { now: NOW, sync: { ...snapshot(0).sync!, checkedAt: "not-a-date" } };
    expect(feedCheckedRecently(bad, FEED_MANUAL_COOLDOWN_MS)).toBe(false);
  });

  it("treats a future timestamp as just-checked, matching agoLabel's clamp", () => {
    // ageMs clamps at zero, so clock skew reads as 0ms old — inside any cooldown.
    expect(feedCheckedRecently(snapshot(-90_000), FEED_MANUAL_COOLDOWN_MS)).toBe(true);
  });
});

describe("describeFeedDetail", () => {
  it("names the scoring verdict with its week", () => {
    expect(describeFeedDetail("scored-through-week-3")).toBe("Scored through Week 3");
    expect(describeFeedDetail("scored-through-week-18")).toBe("Scored through Week 18");
  });

  it("translates every non-scoring verdict the funnel writes", () => {
    expect(describeFeedDetail("no-schedule-loaded")).toBe("No schedule loaded yet");
    expect(describeFeedDetail("preseason-only")).toBe("Preseason games only — nothing to score");
    expect(describeFeedDetail("schedule-read")).toBe("Couldn't read the schedule from the database");
    expect(describeFeedDetail("provider")).toBe("The provider returned no games");
    expect(describeFeedDetail("games-upsert")).toBe("Couldn't write the games it fetched");
    expect(describeFeedDetail("recompute")).toBe("Failed while recomputing standings");
  });

  it("passes an unknown verdict through — a new one should show itself, not hide", () => {
    expect(describeFeedDetail("some-future-stage")).toBe("some-future-stage");
    // Not a week token, so it must not be mangled into "Scored through Week NaN".
    expect(describeFeedDetail("scored-through-week-")).toBe("scored-through-week-");
  });

  it("is empty for the empty detail the ok paths write", () => {
    expect(describeFeedDetail("")).toBe("");
    expect(describeFeedDetail("   ")).toBe("");
  });
});
