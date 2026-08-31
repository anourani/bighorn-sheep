import { describe, expect, it } from "vitest";
import type { Game } from "../nfl/types";
import {
  BUY_IN_REMINDER_MIN_INTERVAL_MS,
  REMINDER_MANUAL_COOLDOWN_MS,
  describeReminders,
  formatMoney,
  mapReminderStatus,
  reminderBody,
  reminderSentRecently,
  reminderSubject,
  reminderWeek,
  weekPickWindow,
} from "./reminders";
import { resolveCurrentWeek } from "../game/season";

/**
 * A regular-season game. `status` defaults to scheduled because every test here
 * is about a week that has not been played unless it says otherwise.
 */
function game(week: number, kickoff: string, over = false): Game {
  return {
    id: `g-${week}-${kickoff}`,
    season: 2026,
    seasonType: "regular",
    week,
    kickoff,
    status: over ? "final" : "scheduled",
    home: "kc",
    away: "lv",
    homeScore: over ? 20 : null,
    awayScore: over ? 17 : null,
  };
}

/**
 * Two ordinary NFL weeks: Thursday night, the Sunday slate, Monday night.
 * Week 4 runs Sep 24–28, week 5 Oct 1–5.
 */
const SCHEDULE: Game[] = [
  game(4, "2026-09-24T20:15:00Z"),
  game(4, "2026-09-27T17:00:00Z"),
  game(4, "2026-09-28T20:15:00Z"),
  game(5, "2026-10-01T20:15:00Z"),
  game(5, "2026-10-04T17:00:00Z"),
  game(5, "2026-10-05T20:15:00Z"),
];

/** The same two weeks, with week 4 fully played. */
const PLAYED_WEEK_4: Game[] = SCHEDULE.map((g) =>
  g.week === 4 ? { ...g, status: "final" as const } : g,
);

describe("reminderWeek — the week a reminder is ABOUT", () => {
  /**
   * The whole reason this function exists. `resolveCurrentWeek` answers "the
   * week being scored"; between Monday night and Thursday night that is a week
   * that is already over, and reminding about it is both useless and
   * destructive (it burns 0015's unique-index row for the real reminder).
   */
  it("returns the NEXT week on a Wednesday, where currentWeek still says the last one", () => {
    const wednesday = new Date("2026-09-30T15:00:00Z");
    const currentWeek = resolveCurrentWeek({
      phase: "regular",
      now: wednesday,
      games: PLAYED_WEEK_4,
    });

    // The trap, stated as an assertion so nobody "simplifies" the two together.
    expect(currentWeek).toBe(4);
    expect(reminderWeek(PLAYED_WEEK_4, wednesday, currentWeek)).toBe(5);
  });

  it("returns the live week on a Sunday morning, when it is still pickable", () => {
    const sunday = new Date("2026-10-04T13:00:00Z");
    const currentWeek = resolveCurrentWeek({ phase: "regular", now: sunday, games: SCHEDULE });
    expect(currentWeek).toBe(5);
    expect(reminderWeek(SCHEDULE, sunday, currentWeek)).toBe(5);
  });

  it("stays on the live week while only its late games are open", () => {
    // Sunday evening: Thursday and the Sunday slate have gone, Monday has not.
    const sundayNight = new Date("2026-10-04T23:00:00Z");
    const partly = SCHEDULE.map((g) =>
      g.week === 5 && g.kickoff < "2026-10-04T23:00:00Z" ? { ...g, status: "final" as const } : g,
    );
    expect(reminderWeek(partly, sundayNight, 5)).toBe(5);
  });

  it("does not drag back to a postponed early week rescheduled into December", () => {
    // Week 3 was postponed and replayed in week 14's slot. Without the
    // `>= currentWeek` floor this would answer 3 and remind the league about a
    // week they finished in September.
    const withPostponement: Game[] = [
      ...PLAYED_WEEK_4,
      game(3, "2026-12-20T18:00:00Z"),
      game(14, "2026-12-13T18:00:00Z"),
    ];
    const december = new Date("2026-12-09T12:00:00Z");
    expect(reminderWeek(withPostponement, december, 13)).toBe(14);
  });

  it("is null when nothing is left to pick, and when the schedule is empty", () => {
    expect(reminderWeek(SCHEDULE, new Date("2027-02-01T00:00:00Z"), 18)).toBeNull();
    expect(reminderWeek([], new Date("2026-10-04T13:00:00Z"), 5)).toBeNull();
  });

  it("ignores a week whose games exist but are all non-scheduled", () => {
    // 0014 gates on `status = 'scheduled'`, not merely on a future kickoff: a
    // postponed game with a future date is not pickable.
    const postponed = [{ ...game(6, "2026-10-11T17:00:00Z"), status: "postponed" as const }];
    expect(reminderWeek(postponed, new Date("2026-10-08T00:00:00Z"), 6)).toBeNull();
  });
});

describe("weekPickWindow — may a reminder still do any good?", () => {
  it("is open in the days before the first kickoff", () => {
    const w = weekPickWindow(SCHEDULE, 5, new Date("2026-09-30T15:00:00Z"));
    expect(w.open).toBe(true);
    expect(w.reason).toBeNull();
    expect(w.partiallyStarted).toBe(false);
    expect(w.lastKickoffIso).toBe("2026-10-05T20:15:00.000Z");
  });

  /**
   * There is deliberately no "too early" refusal any more. One used to sit here
   * on a seven-day threshold, and its effect was that the pick reminder could
   * not be sent through the entire preseason — precisely when an admin wants to
   * chase Week 1 picks. Whether a reminder is premature is the admin's call.
   */
  it("is open however far out the week is, including a whole preseason early", () => {
    expect(weekPickWindow(SCHEDULE, 5, new Date("2026-09-24T00:00:00Z")).open).toBe(true);
    expect(weekPickWindow(SCHEDULE, 5, new Date("2026-08-01T00:00:00Z")).open).toBe(true);
    // Six weeks out, and still nothing standing in the way.
    const w = weekPickWindow(SCHEDULE, 5, new Date("2026-08-20T00:00:00Z"));
    expect(w.open).toBe(true);
    expect(w.reason).toBeNull();
  });

  it("stays open but reports partiallyStarted once some games have gone", () => {
    const partly = SCHEDULE.map((g) =>
      g.week === 5 && g.kickoff < "2026-10-04T23:00:00Z" ? { ...g, status: "final" as const } : g,
    );
    const w = weekPickWindow(partly, 5, new Date("2026-10-04T23:00:00Z"));
    expect(w.open).toBe(true);
    expect(w.partiallyStarted).toBe(true);
    expect(w.nextKickoffIso).toBe("2026-10-05T20:15:00.000Z");
  });

  it("closes at the last kickoff, which is when a missing pick becomes a loss", () => {
    const w = weekPickWindow(SCHEDULE, 5, new Date("2026-10-05T20:16:00Z"));
    expect(w.open).toBe(false);
    expect(w.reason).toBe("closed");
    // Still reported, because it is what the copy prints.
    expect(w.lastKickoffIso).toBe("2026-10-05T20:15:00.000Z");
  });

  /**
   * The reason the gate is 0014's predicate and not `weekFinalKickoff`. A
   * postponed game keeps its week and gains a future kickoff, so "the final
   * kickoff hasn't passed" reports a finished week as open.
   */
  it("stays closed when the only future game in a finished week is postponed", () => {
    const played = [
      { ...game(4, "2026-09-24T20:15:00Z"), status: "final" as const },
      { ...game(4, "2026-09-27T17:00:00Z"), status: "final" as const },
      { ...game(4, "2026-12-20T18:00:00Z"), status: "postponed" as const },
    ];
    const w = weekPickWindow(played, 4, new Date("2026-10-01T00:00:00Z"));
    expect(w.open).toBe(false);
    expect(w.reason).toBe("closed");
    // The naive gate would have said open, because this is in the future.
    expect(w.lastKickoffIso).toBe("2026-12-20T18:00:00.000Z");
  });

  it("reports no_games for a week the schedule does not cover", () => {
    expect(weekPickWindow(SCHEDULE, 12, new Date("2026-10-01T00:00:00Z")).reason).toBe("no_games");
  });
});

describe("mapReminderStatus", () => {
  const raw = {
    now: "2026-10-01T12:00:00Z",
    season: 2026,
    seasonType: "regular",
    week: 5,
    pick: {
      due: [{ userId: "u1", firstName: "Ada", lastName: "Byron", lastSentAt: null }],
      lastSentAt: "2026-10-01T11:00:00Z",
    },
    buyIn: { due: [], lastSentAt: null },
  };

  it("reads the payload 0015 actually returns", () => {
    const s = mapReminderStatus(raw);
    expect(s?.week).toBe(5);
    expect(s?.pick.due).toHaveLength(1);
    expect(s?.pick.due[0]?.firstName).toBe("Ada");
    expect(s?.pick.lastSentAt).toBe("2026-10-01T11:00:00Z");
  });

  /** A database without 0015 returns shapes this code has never seen. */
  it("returns null for anything without a clock, rather than throwing", () => {
    expect(mapReminderStatus(null)).toBeNull();
    expect(mapReminderStatus({})).toBeNull();
    expect(mapReminderStatus("nope")).toBeNull();
    expect(mapReminderStatus([1, 2, 3])).toBeNull();
    expect(mapReminderStatus({ now: 12345 })).toBeNull();
  });

  it("survives missing buckets and drops malformed rows", () => {
    const s = mapReminderStatus({ now: "2026-10-01T12:00:00Z" });
    expect(s?.pick.due).toEqual([]);
    expect(s?.buyIn.lastSentAt).toBeNull();

    const messy = mapReminderStatus({
      ...raw,
      pick: { due: [{ firstName: "no id" }, { userId: "u2" }], lastSentAt: null },
    });
    // The row without a userId is dropped; the sparse one is filled in.
    expect(messy?.pick.due).toHaveLength(1);
    expect(messy?.pick.due[0]).toEqual({
      userId: "u2",
      firstName: "",
      lastName: "",
      lastSentAt: null,
    });
  });
});

describe("reminderSentRecently", () => {
  const snap = (lastSentAt: string | null, now = "2026-10-01T12:00:00Z") =>
    mapReminderStatus({
      now,
      season: 2026,
      seasonType: "regular",
      week: 5,
      pick: { due: [], lastSentAt },
      buyIn: { due: [], lastSentAt: null },
    });

  it("is true inside the cooldown and false outside it", () => {
    expect(reminderSentRecently(snap("2026-10-01T11:59:30Z"), "pick", REMINDER_MANUAL_COOLDOWN_MS)).toBe(true);
    expect(reminderSentRecently(snap("2026-10-01T11:58:00Z"), "pick", REMINDER_MANUAL_COOLDOWN_MS)).toBe(false);
  });

  it("keys off the right bucket", () => {
    // pick was just sent; buy_in never was.
    expect(reminderSentRecently(snap("2026-10-01T11:59:30Z"), "buy_in", REMINDER_MANUAL_COOLDOWN_MS)).toBe(false);
  });

  /** Fails OPEN: the send log is the correctness gate, this is a courtesy. */
  it("fails open on nothing-sent, an unparseable stamp, and a null snapshot", () => {
    expect(reminderSentRecently(snap(null), "pick", REMINDER_MANUAL_COOLDOWN_MS)).toBe(false);
    expect(reminderSentRecently(snap("not a date"), "pick", REMINDER_MANUAL_COOLDOWN_MS)).toBe(false);
    expect(reminderSentRecently(null, "pick", REMINDER_MANUAL_COOLDOWN_MS)).toBe(false);
  });

  /** Clock skew must not lock an admin out for a minute that never elapses. */
  it("treats a future stamp as recent rather than negative", () => {
    // ageMs clamps at zero, so a stamp from the future reads as "just now".
    expect(reminderSentRecently(snap("2026-10-01T12:05:00Z"), "pick", REMINDER_MANUAL_COOLDOWN_MS)).toBe(true);
  });
});

describe("describeReminders", () => {
  const build = (over: Partial<Record<string, unknown>> = {}) =>
    mapReminderStatus({
      now: "2026-09-30T12:00:00Z",
      season: 2026,
      seasonType: "regular",
      week: 5,
      pick: { due: [], lastSentAt: null },
      buyIn: { due: [], lastSentAt: null },
      ...over,
    });

  const openWindow = weekPickWindow(SCHEDULE, 5, new Date("2026-09-30T12:00:00Z"));

  it("counts, and gets singular/plural right", () => {
    const one = build({ pick: { due: [{ userId: "u1" }], lastSentAt: null } });
    expect(describeReminders(one, "pick", openWindow).headline).toBe(
      "1 player hasn't picked Week 5",
    );
    const two = build({ pick: { due: [{ userId: "u1" }, { userId: "u2" }], lastSentAt: null } });
    expect(describeReminders(two, "pick", openWindow).headline).toBe(
      "2 players haven't picked Week 5",
    );
  });

  it("says so when there is nobody to remind", () => {
    expect(describeReminders(build(), "pick", openWindow).headline).toBe(
      "Everyone has picked for Week 5",
    );
    expect(describeReminders(build(), "buy_in", null).headline).toBe("Everyone has paid");
  });

  it("leads with the closed window rather than the count", () => {
    const closed = weekPickWindow(SCHEDULE, 5, new Date("2026-10-06T00:00:00Z"));
    const s = build({ pick: { due: [{ userId: "u1" }], lastSentAt: null } });
    expect(describeReminders(s, "pick", closed).headline).toBe("Week 5 — picks are closed");
  });

  it("has an answer when no week is pickable at all", () => {
    const s = build({ week: null });
    expect(describeReminders(s, "pick", null).headline).toBe("No week is open for picks");
  });

  it("names the partial-kickoff case, because it changes what the reader can do", () => {
    const partly = SCHEDULE.map((g) =>
      g.week === 5 && g.kickoff < "2026-10-04T23:00:00Z" ? { ...g, status: "final" as const } : g,
    );
    const w = weekPickWindow(partly, 5, new Date("2026-10-04T23:00:00Z"));
    const s = build({ pick: { due: [{ userId: "u1" }], lastSentAt: null } });
    expect(describeReminders(s, "pick", w).detail).toContain("already kicked off");
  });

  it("degrades to a migration hint rather than crashing on a null snapshot", () => {
    expect(describeReminders(null, "pick", null).headline).toContain("Couldn't read");
  });
});

describe("the message", () => {
  const base = {
    kind: "pick" as const,
    firstName: "Ada",
    leagueName: "Sheep with Glasses",
    week: 5,
    deadlineIso: "2026-10-05T20:15:00Z",
    partiallyStarted: false,
    buyInCents: 5000,
    url: "https://sheepwithglasses.com/app",
  };

  it("names the league in the subject, so it is not anonymous in an inbox", () => {
    expect(reminderSubject(base)).toBe(
      "Sheep with Glasses: you haven't picked for Week 5",
    );
    expect(reminderSubject({ ...base, kind: "buy_in" })).toBe(
      "Payment confirmation for Sheep with Glasses",
    );
  });

  /**
   * An email has no mount and no JavaScript, so `LocalTime`'s swap to the
   * reader's zone cannot happen. The zone is chosen here and named in the text.
   */
  it("prints the deadline in US Eastern with the zone spelled out", () => {
    const { text } = reminderBody(base);
    expect(text).toContain("EDT");
    expect(text).toContain("October");
  });

  it("resolves the abbreviation against the kickoff, not against today", () => {
    const winter = reminderBody({ ...base, deadlineIso: "2026-12-20T18:00:00Z" });
    expect(winter.text).toContain("EST");
    expect(winter.text).not.toContain("EDT");
  });

  it("always carries a text part as well as HTML", () => {
    const { text, html } = reminderBody(base);
    expect(text.length).toBeGreaterThan(0);
    expect(html).toContain("<p>");
    expect(text).not.toContain("<p>");
  });

  /**
   * The copy has to hold whenever it is READ, not only when it is sent — a
   * reminder mailed on Wednesday is opened on Sunday. So the base text explains
   * the RULE rather than asserting a state, and the only conditional sentence
   * is the one that adds information rather than expiring.
   */
  it("explains the locking rule in every case, and adds the caveat when it applies", () => {
    const early = reminderBody(base).text;
    expect(early).toContain("Picks lock at each game's kickoff");
    expect(early).toContain("counts as a loss");
    // No claim about the current state of the slate that could go stale.
    expect(early).not.toContain("Every game this week is still open");
    expect(early).not.toContain("already kicked off");

    const partway = reminderBody({ ...base, partiallyStarted: true }).text;
    expect(partway).toContain("Picks lock at each game's kickoff");
    expect(partway).toContain("already kicked off, so those teams are no longer available");
  });

  it("names the week in the deadline, so it reads right sent weeks ahead", () => {
    expect(reminderBody(base).text).toContain("The last game of Week 5 kicks off");
  });

  it("puts the absolute link in both parts", () => {
    const { text, html } = reminderBody(base);
    expect(text).toContain("https://sheepwithglasses.com/app");
    expect(html).toContain('href="https://sheepwithglasses.com/app"');
  });

  it("says why the reader is getting it", () => {
    expect(reminderBody(base).html).toContain("because you're in Sheep with Glasses");
  });

  it("escapes a league name that contains markup", () => {
    const { html } = reminderBody({ ...base, leagueName: '<script>x</script>&"' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("falls back to a greeting when a first name is missing", () => {
    expect(reminderBody({ ...base, firstName: "" }).text.startsWith("Hi there,")).toBe(true);
  });

  describe("the buy-in copy", () => {
    const buyIn = {
      ...base,
      kind: "buy_in" as const,
      week: null,
      commissionerFirstName: "Sam",
      commissionerEmail: "sam@example.com",
      commissionerPhone: "8183122718",
    };

    it("names the commissioner and reaches them two ways", () => {
      const { text, html } = reminderBody(buyIn);
      expect(text).toContain("let Sam know");
      // The plain-text part cannot carry a link, so it spells the address out.
      expect(text).toContain("Email Sam at sam@example.com, or text 8183122718.");
      // The HTML part makes "Email" a mailto that arrives with a subject
      // already filled in — that is what makes it a draft, not a blank compose.
      expect(html).toContain('<a href="mailto:sam@example.com?subject=');
      expect(html).toContain("Buy-in%20for%20Sheep%20with%20Glasses");
      expect(html).toContain(">Email</a> or text Sam at 8183122718.");
    });

    /** profile_private.phone is optional, and half a sentence is worse than none. */
    it("drops the text half when no phone is stored", () => {
      const { text, html } = reminderBody({ ...buyIn, commissionerPhone: null });
      expect(text).toContain("Email Sam at sam@example.com.");
      expect(text).not.toContain("or text");
      expect(html).toContain(">Email Sam</a>.");
    });

    /** Rather than rendering "Email  at ." at somebody. */
    it("drops the whole contact line when there is no address", () => {
      const { text, html } = reminderBody({ ...buyIn, commissionerEmail: "" });
      expect(text).not.toContain("Email");
      expect(html).not.toContain("mailto:");
    });

    it("falls back to 'the commissioner' rather than printing undefined", () => {
      const { text } = reminderBody({ ...buyIn, commissionerFirstName: undefined });
      expect(text).toContain("let the commissioner know");
      expect(text).not.toContain("undefined");
    });

    /**
     * The call to action is to pay a person, so a link to a page that only
     * restates the debt competes with it. The pick reminder keeps its link.
     */
    it("carries no app link, where the pick reminder does", () => {
      expect(reminderBody(buyIn).text).not.toContain(buyIn.url);
      expect(reminderBody(base).text).toContain(base.url);
    });

    it("keeps the removal warning, which is the whole point of sending it", () => {
      expect(reminderBody(buyIn).text).toContain("removed from the league before Week 1");
    });
  });

  /** Paragraphs, not a wall — the text part ran together before. */
  it("separates blocks with blank lines in the plain-text part", () => {
    const { text } = reminderBody(base);
    expect(text).toContain("\n\n");
    expect(text.split("\n\n").length).toBeGreaterThan(3);
  });

  it("omits the amount when the league has no buy-in set", () => {
    const paid = reminderBody({ ...base, kind: "buy_in", buyInCents: 5000 }).text;
    const free = reminderBody({ ...base, kind: "buy_in", buyInCents: 0 }).text;
    expect(paid).toContain("$50");
    expect(free).not.toContain("$");
  });
});

describe("formatMoney", () => {
  it("drops the cents on a whole-dollar amount and keeps them otherwise", () => {
    expect(formatMoney(5000)).toBe("$50");
    expect(formatMoney(2550)).toBe("$25.50");
    expect(formatMoney(0)).toBe("$0");
  });
});

describe("the constants", () => {
  /** Mirrors 0015's p_min_interval default; drifting apart would surprise. */
  it("keeps the buy-in throttle at three days, matching the migration", () => {
    expect(BUY_IN_REMINDER_MIN_INTERVAL_MS).toBe(3 * 24 * 60 * 60 * 1000);
  });
});
