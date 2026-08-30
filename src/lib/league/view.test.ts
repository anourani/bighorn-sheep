import { describe, expect, it } from "vitest";
import type { Game, TeamId } from "../nfl/types";
import type { GroupRules, Member, TeamRecord } from "./types";
import {
  countNoun,
  orderPickerTeams,
  rankMembers,
  statusLabel,
  headcountLine,
  survivorCounts,
  teamScoreline,
  type TeamAvailability,
} from "./view";

function game(kickoff: string, home: TeamId, away: TeamId): Game {
  return {
    id: `g_${home}_${away}`,
    season: 2025,
    seasonType: "regular",
    week: 6,
    kickoff,
    status: "scheduled",
    home,
    away,
    homeScore: null,
    awayScore: null,
  };
}

const EARLY = "2025-10-12T17:00:00.000Z";
const LATE = "2025-10-12T20:25:00.000Z";
const NIGHT = "2025-10-14T00:15:00.000Z";

const RECORDS: Record<string, TeamRecord> = {
  kc: { w: 5, l: 1, t: 0 },
  buf: { w: 4, l: 2, t: 0 },
  dal: { w: 3, l: 3, t: 0 },
  sf: { w: 4, l: 2, t: 0 },
  det: { w: 5, l: 1, t: 0 },
  cin: { w: 3, l: 3, t: 0 },
};

const GAMES: Record<string, Game | undefined> = {
  kc: game(LATE, "kc", "jax"),
  buf: game(EARLY, "ne", "buf"),
  dal: game(NIGHT, "wsh", "dal"),
  sf: game(EARLY, "sf", "tb"),
  det: game(EARLY, "tb", "det"),
  cin: undefined, // on bye — no game this week
};

const recordFor = (id: TeamId): TeamRecord => RECORDS[id] ?? { w: 0, l: 0, t: 0 };
const gameFor = (id: TeamId): Game | undefined => GAMES[id];

// Alphabetical base order, matching how TEAMS is declared.
const BASE: TeamId[] = ["buf", "cin", "dal", "det", "kc", "sf"];

const states = new Map<TeamId, TeamAvailability>([
  ["buf", { state: "available" }],
  ["cin", { state: "bye" }],
  ["dal", { state: "available" }],
  ["det", { state: "selected" }],
  ["kc", { state: "available" }],
  ["sf", { state: "used", week: 4, result: "win" }],
]);

const accessors = { recordFor, gameFor };

describe("orderPickerTeams", () => {
  it("keeps only pickable + selected teams when availableOnly, in base order", () => {
    const out = orderPickerTeams(BASE, states, { sort: "default", availableOnly: true }, accessors);
    expect(out).toEqual(["buf", "dal", "det", "kc"]);
  });

  it("default sort preserves the base order without mutating the input", () => {
    const out = orderPickerTeams(BASE, states, { sort: "default", availableOnly: false }, accessors);
    expect(out).toEqual(BASE);
    expect(BASE).toEqual(["buf", "cin", "dal", "det", "kc", "sf"]);
  });

  it("record sort orders by win% (actionable first), used/bye sunk to the bottom", () => {
    const out = orderPickerTeams(BASE, states, { sort: "record", availableOnly: false }, accessors);
    // det/kc tie at .833 → alphabetical; then buf .667, dal .5; then non-actionable sf, cin.
    expect(out).toEqual(["det", "kc", "buf", "dal", "sf", "cin"]);
  });

  it("kickoff sort orders by soonest kickoff, byes last, actionable first", () => {
    const out = orderPickerTeams(BASE, states, { sort: "kickoff", availableOnly: false }, accessors);
    // buf/det tie EARLY → alphabetical; kc LATE; dal NIGHT; then used sf (EARLY), bye cin (no game).
    expect(out).toEqual(["buf", "det", "kc", "dal", "sf", "cin"]);
  });
});

describe("statusLabel", () => {
  it("reads Still Standing for a living player mid-season", () => {
    expect(statusLabel({ status: "alive", phase: "regular" })).toBe("Still Standing");
  });

  it("names the phase for a living player outside the regular season", () => {
    expect(statusLabel({ status: "alive", phase: "preseason" })).toBe("Pre-season");
    expect(statusLabel({ status: "alive", phase: "ended" })).toBe("Season over");
  });

  it("lets elimination outrank every phase", () => {
    for (const phase of ["preseason", "regular", "ended"] as const) {
      expect(statusLabel({ status: "eliminated", phase })).toBe("Eliminated");
    }
  });
});

describe("survivorCounts", () => {
  function member(id: string, status: Member["status"]): Member {
    return {
      id,
      name: id,
      firstName: id,
      lastName: "",
      favoriteAnimal: null,
      phone: null,
      role: "player",
      status,
      strikes: 0,
      buyInPaid: false,
    buyInPaidAt: null,
    showPreseason: false,
      history: [],
      currentPick: null,
    };
  }

  it("splits members into alive and eliminated", () => {
    const out = survivorCounts([
      member("a", "alive"),
      member("b", "eliminated"),
      member("c", "alive"),
    ]);
    expect(out).toEqual({ alive: 2, eliminated: 1, total: 3 });
  });

  it("is all zeroes for an empty league", () => {
    expect(survivorCounts([])).toEqual({ alive: 0, eliminated: 0, total: 0 });
  });

  it("counts the denominator from the known statuses, not the array length", () => {
    // A row carrying a status this build doesn't know is left out of `total`
    // rather than inflating it into a "3 out of 4" that never resolves.
    const rogue = { ...member("d", "alive"), status: "zombie" as Member["status"] };
    const out = survivorCounts([member("a", "alive"), member("b", "eliminated"), rogue]);
    expect(out).toEqual({ alive: 1, eliminated: 1, total: 2 });
  });
});

describe("rankMembers", () => {
  const WEEK = 6;
  const KICKED = "2025-10-12T17:00:00.000Z";
  const NOW = new Date("2025-10-12T18:00:00.000Z");
  const LATER = "2025-10-12T20:00:00.000Z";
  const RULES: GroupRules = { eliminationType: "single", tieRule: "push" };

  function member(id: string, over: Partial<Member> = {}): Member {
    return {
      id,
      name: id,
      firstName: id,
      lastName: "",
      favoriteAnimal: null,
      phone: null,
      role: "player",
      status: "alive",
      strikes: 0,
      buyInPaid: false,
      buyInPaidAt: null,
      showPreseason: false,
      eliminatedWeek: null,
      history: [],
      currentPick: null,
      ...over,
    };
  }

  /** A member who picked `teamId` in the ranked week. */
  function picked(id: string, teamId: TeamId, over: Partial<Member> = {}): Member {
    return member(id, { currentPick: { week: WEEK, teamId, gameId: `g_${teamId}` }, ...over });
  }

  /**
   * The four game shapes the buckets read, one per matchup so `gameForTeam`
   * can answer per team without two members sharing a fixture.
   */
  const GAMES: Game[] = [
    // Final, home wins.
    { ...game(KICKED, "kc", "buf"), status: "final", homeScore: 24, awayScore: 17 },
    // In progress.
    { ...game(KICKED, "sf", "sea"), status: "in_progress", homeScore: 7, awayScore: 3 },
    // Not started.
    { ...game(LATER, "dal", "phi"), status: "scheduled" },
    // Final, tied.
    { ...game(KICKED, "gb", "chi"), status: "final", homeScore: 20, awayScore: 20 },
    // Two more finals, so several distinct teams can share the `won` bucket and
    // be clustered against each other.
    { ...game(KICKED, "lv", "den"), status: "final", homeScore: 30, awayScore: 10 },
    { ...game(KICKED, "lar", "ari"), status: "final", homeScore: 21, awayScore: 14 },
  ];

  const gameForTeam = (week: number, teamId: TeamId): Game | undefined => {
    if (week !== WEEK) return undefined;
    return GAMES.find((g) => g.home === teamId || g.away === teamId);
  };

  function ranked(ms: Member[], hiddenPickUserIds: string[] = []) {
    return rankMembers(ms, {
      currentWeek: WEEK,
      gameForTeam,
      rules: RULES,
      now: NOW,
      hiddenPickUserIds,
    });
  }
  const ids = (ms: Member[], hidden: string[] = []) =>
    ranked(ms, hidden).map((r) => r.member.id);

  it("orders the living by how their current week is going", () => {
    // won → live → picked → none → lost. Deliberately fed in reverse.
    expect(
      ids([
        picked("lost", "buf"),
        member("none"),
        picked("picked", "dal"),
        picked("live", "sf"),
        picked("won", "kc"),
      ]),
    ).toEqual(["won", "live", "picked", "none", "lost"]);
  });

  it("counts a locked-but-hidden pick as having picked, not as no pick", () => {
    // Under RLS a rival's un-kicked pick reaches the client as nothing but the
    // team-less flag. Without reading it, someone who HAS picked sorts below
    // someone who hasn't.
    expect(ids([member("no-pick"), member("hidden")], ["hidden"])).toEqual(["hidden", "no-pick"]);
  });

  it("ranks everyone off the same reveal, so two viewers see one order", () => {
    // `pickSignals` passes an empty viewer id, so nobody's own pick counts as
    // revealed early. A scheduled pick is `picked` whoever is looking.
    const ms = [picked("a", "dal"), picked("b", "kc")];
    expect(ids(ms)).toEqual(["b", "a"]);
  });

  it("puts a surviving tie with the winners and a fatal tie with the losers", () => {
    const tie = [picked("tied", "gb"), picked("clean", "kc"), picked("beaten", "buf")];
    // tieRule "push": the tie survived, so it ranks as a win does — both are in
    // `won`, and as two one-member bundles they order on team id ("gb" before
    // "kc") rather than on name. The claim here is which side of the table each
    // lands on, and the loser is still last.
    expect(ids(tie)).toEqual(["tied", "clean", "beaten"]);
    // tieRule "loss": the same game now drops that member to the bottom.
    const asLoss = rankMembers(tie, {
      currentWeek: WEEK,
      gameForTeam,
      rules: { eliminationType: "single", tieRule: "loss" },
      now: NOW,
    }).map((r) => r.member.id);
    expect(asLoss).toEqual(["clean", "beaten", "tied"]);
  });

  it("bundles everyone on the same revealed team, biggest bundle first", () => {
    // Five on the Raiders, four on the Rams, two on the Chiefs — all three
    // games final wins, so all eleven sit in `won` and only the bundle sizes
    // separate them. Fed interleaved.
    const ms = [
      ...["a", "b"].map((n) => picked(`kc-${n}`, "kc")),
      ...["a", "b", "c", "d", "e"].map((n) => picked(`lv-${n}`, "lv")),
      ...["a", "b", "c", "d"].map((n) => picked(`lar-${n}`, "lar")),
    ];
    const out = ids(ms).map((id) => id.split("-")[0]);
    expect(out).toEqual([
      ...Array(5).fill("lv"),
      ...Array(4).fill("lar"),
      ...Array(2).fill("kc"),
    ]);
  });

  it("keeps a bundle together across strike counts", () => {
    // The clustering outranks strikes on purpose: a bundle broken up by strike
    // count is not a bundle. The lone Chiefs backer has no strikes and still
    // sits below the two-strike Raiders pair.
    expect(
      ids([
        picked("kc-clean", "kc"),
        picked("lv-two", "lv", { strikes: 2 }),
        picked("lv-one", "lv", { strikes: 1 }),
      ]),
      // Within the Raiders bundle, strikes order them as before.
    ).toEqual(["lv-one", "lv-two", "kc-clean"]);
  });

  it("never clusters across buckets", () => {
    // A big bundle in a later bucket does not outrank a small one ahead of it:
    // the Rams (4, but their game is still in progress) stay under the lone
    // Chiefs backer, whose game is won.
    const out = ids([
      ...["a", "b", "c", "d"].map((n) => picked(`sf-${n}`, "sf")),
      picked("kc-solo", "kc"),
    ]);
    expect(out[0]).toBe("kc-solo");
    expect(out.slice(1).every((id) => id.startsWith("sf-"))).toBe(true);
  });

  it("does not cluster on a team nobody may see yet", () => {
    // An un-kicked pick is real but secret. Bundling on it would leak the team
    // through the row order — neighbours would be neighbours BECAUSE they share
    // a pick, which is the fact the padlock is hiding. So these three sort on
    // name, not into a bundle ahead of the solo pick.
    const out = ids([
      picked("z-dal", "dal", { name: "Zoe Z." }),
      picked("a-phi", "phi", { name: "Ada A." }),
      picked("m-dal", "dal", { name: "Mia M." }),
    ]);
    expect(out).toEqual(["a-phi", "m-dal", "z-dal"]);
  });

  it("puts hidden picks after every bundle in their bucket", () => {
    // Both are `picked` — one revealed (kicked off, still no result), one not.
    // The revealed one has a bundle to join; the hidden one has nothing to be
    // bundled by, so it sits after rather than scattered among them.
    const revealedButUnresolved = picked("open", "phi", { name: "Zoe Z." });
    const hidden = picked("hidden", "dal", { name: "Ada A." });
    const withKickedPhi = (week: number, teamId: TeamId): Game | undefined => {
      if (week !== WEEK) return undefined;
      // The Eagles game has started but produced no result yet.
      if (teamId === "phi" || teamId === "dal") {
        return teamId === "phi"
          ? { ...game(KICKED, "dal", "phi"), status: "in_progress" }
          : { ...game(LATER, "dal", "phi"), status: "scheduled" };
      }
      return gameForTeam(week, teamId);
    };
    const out = rankMembers([hidden, revealedButUnresolved], {
      currentWeek: WEEK,
      gameForTeam: withKickedPhi,
      rules: RULES,
      now: NOW,
    }).map((r) => r.member.id);
    // "open" is live, "hidden" is picked — bucket decides first here, and the
    // revealed one leads on its own merit.
    expect(out).toEqual(["open", "hidden"]);
  });

  it("orders two equal bundles by team id, not by their members", () => {
    // Deterministic and independent of who is in them, so one player joining or
    // leaving cannot reshuffle bundles that did not change.
    const ms = [
      picked("lv-a", "lv", { name: "Zoe Z." }),
      picked("kc-a", "kc", { name: "Ada A." }),
      picked("lv-b", "lv", { name: "Bea B." }),
      picked("kc-b", "kc", { name: "Cal C." }),
    ];
    expect(ids(ms).map((id) => id.split("-")[0])).toEqual(["kc", "kc", "lv", "lv"]);
    // Swapping the names inside the bundles does not move the bundles.
    const renamed = [
      picked("lv-a", "lv", { name: "Ada A." }),
      picked("kc-a", "kc", { name: "Zoe Z." }),
      picked("lv-b", "lv", { name: "Bea B." }),
      picked("kc-b", "kc", { name: "Cal C." }),
    ];
    expect(ids(renamed).map((id) => id.split("-")[0])).toEqual(["kc", "kc", "lv", "lv"]);
  });

  it("counts bundles over the living only", () => {
    // Three eliminated Chiefs backers do not inflate that bundle past the two
    // living Raiders backers — the dead are not in it.
    const out = ids([
      ...["a", "b"].map((n) => picked(`lv-${n}`, "lv")),
      picked("kc-live", "kc"),
      ...["x", "y", "z"].map((n) =>
        picked(`kc-dead-${n}`, "kc", { status: "eliminated", eliminatedWeek: 4 }),
      ),
    ]);
    expect(out.slice(0, 3)).toEqual(["lv-a", "lv-b", "kc-live"]);
  });

  it("leaves the frozen dead block unclustered", () => {
    // Their order is a positional guarantee — a row that never moves again — so
    // elimination week wins outright and a shared team changes nothing.
    expect(
      ids([
        picked("out-w2", "lv", { status: "eliminated", eliminatedWeek: 2 }),
        picked("out-w9", "kc", { status: "eliminated", eliminatedWeek: 9 }),
        picked("out-w5", "lv", { status: "eliminated", eliminatedWeek: 5 }),
      ]),
    ).toEqual(["out-w9", "out-w5", "out-w2"]);
  });

  it("breaks a bucket tie on strikes, then name, then id", () => {
    expect(
      ids([
        picked("z-three", "dal", { name: "Zoe Z.", strikes: 3 }),
        picked("b-one", "dal", { name: "Bea B.", strikes: 1 }),
        picked("a-one", "dal", { name: "Ada A.", strikes: 1 }),
        picked("c-none", "dal", { name: "Cal C." }),
      ]),
    ).toEqual(["c-none", "a-one", "b-one", "z-three"]);
  });

  /*
   * The practice standings board. Nothing eliminates in preseason, so
   * StandingsClient hands this an all-alive table — every row falls in the same
   * bucket while the practice week is unplayed, and the ONLY thing separating
   * two rows is the practice loss count, uncapped, so a three-loss member really
   * does sit below a one-loss member.
   */
  it("orders an all-alive table with no picks purely on losses, then name, then id", () => {
    expect(
      ids([
        member("z-three", { name: "Zoe Z.", strikes: 3 }),
        member("b-one", { name: "Bea B.", strikes: 1 }),
        member("a-one", { name: "Ada A.", strikes: 1 }),
        member("c-none", { name: "Cal C." }),
      ]),
    ).toEqual(["c-none", "a-one", "b-one", "z-three"]);
  });

  it("puts every eliminated member below every living one, whatever their week is doing", () => {
    // The dead member picked a winner; it does not lift them above the living.
    expect(
      ids([
        picked("dead", "kc", { status: "eliminated", eliminatedWeek: 3 }),
        picked("alive-lost", "buf"),
      ]),
    ).toEqual(["alive-lost", "dead"]);
  });

  it("freezes the dead in elimination order, most recent first", () => {
    expect(
      ids([
        member("out-w2", { status: "eliminated", eliminatedWeek: 2 }),
        member("out-w5", { status: "eliminated", eliminatedWeek: 5 }),
        member("out-w9", { status: "eliminated", eliminatedWeek: 9 }),
      ]),
    ).toEqual(["out-w9", "out-w5", "out-w2"]);
  });

  it("keeps an eliminated member's row number when someone else goes out later", () => {
    // The freeze is the whole point: a player scrolling down in a late week
    // reads the league's history backwards, and nobody already out ever moves.
    const before = [
      member("alive-a"),
      member("alive-b"),
      member("out-w2", { status: "eliminated", eliminatedWeek: 2 }),
    ];
    const rowOf = (rows: ReturnType<typeof ranked>, id: string) =>
      rows.find((r) => r.member.id === id)!.rank;
    expect(rowOf(ranked(before), "out-w2")).toBe(3);

    // `alive-b` is now out, in a later week. They stack on TOP of the dead
    // block, and the earlier casualty keeps the row it already had.
    const after = [
      member("alive-a"),
      member("alive-b", { status: "eliminated", eliminatedWeek: 6 }),
      member("out-w2", { status: "eliminated", eliminatedWeek: 2 }),
    ];
    expect(rowOf(ranked(after), "alive-b")).toBe(2);
    expect(rowOf(ranked(after), "out-w2")).toBe(3);
  });

  it("is total and stable — the input order never decides the output", () => {
    const tied = [member("b", { name: "Same Name" }), member("a", { name: "Same Name" })];
    expect(ids(tied)).toEqual(["a", "b"]);
    expect(ids([...tied].reverse())).toEqual(["a", "b"]);
  });

  it("numbers the ranks from 1 in the sorted order", () => {
    expect(ranked([member("b", { strikes: 1 }), member("a")]).map((r) => r.rank)).toEqual([1, 2]);
  });

  it("asks the game index for the ranked week only", () => {
    // The landing page ships games for the current week ALONE. A lookup for any
    // other week there returns undefined, so ranking that reached for one would
    // bucket everybody as un-started while the signed-in table looked fine.
    const asked: number[] = [];
    rankMembers([picked("a", "kc"), picked("b", "dal")], {
      currentWeek: WEEK,
      gameForTeam: (week, teamId) => {
        asked.push(week);
        return gameForTeam(week, teamId);
      },
      rules: RULES,
      now: NOW,
    });
    expect(new Set(asked)).toEqual(new Set([WEEK]));
  });
});

describe("headcountLine", () => {
  it("reads the week, the tally and the share out in season", () => {
    expect(headcountLine({ kind: "season", week: 6, alive: 29, eliminated: 15 })).toEqual({
      lead: "Week 6",
      leadShort: "W6",
      primary: "29 still standing",
      percent: "34%",
      percentLabel: "34% eliminated",
    });
  });

  it("counts the joiners and prints no percentage in pre-season", () => {
    expect(headcountLine({ kind: "preseason", joined: 12, startsIn: "3d 4h" })).toEqual({
      lead: "Pre-season",
      // No shorter form to give: "Pre-season" already names the whole stretch,
      // so the phone renders the same string the desktop does.
      leadShort: "Pre-season",
      primary: "12 joined",
      // Nobody can be out yet, so the only number this could carry is 0%.
      percent: null,
      percentLabel: null,
    });
  });

  // The abbreviation is no longer a phone-only form — the desktop frame draws it
  // too — so `lead` is now only ever spoken.
  it("abbreviates the week", () => {
    for (const week of [1, 6, 18]) {
      expect(headcountLine({ kind: "season", week, alive: 1, eliminated: 0 })).toMatchObject({
        lead: `Week ${week}`,
        leadShort: `W${week}`,
      });
    }
  });

  it("rounds the eliminated share to a whole percent", () => {
    const share = (alive: number, eliminated: number) =>
      headcountLine({ kind: "season", week: 6, alive, eliminated }).percent;
    // The design's own figures: 29 of 63 still standing is 34 out, i.e. 53.97%.
    expect(share(29, 34)).toBe("54%");
    expect(share(2, 1)).toBe("33%");
    expect(share(1, 2)).toBe("67%");
  });

  // The drawn number is hidden from the accessibility tree and this is spoken
  // instead, so the two must not be able to drift apart.
  it("gives the percentage the noun a bare number lacks", () => {
    const line = headcountLine({ kind: "season", week: 6, alive: 29, eliminated: 34 });
    expect(line.percentLabel).toBe(`${line.percent} eliminated`);
  });

  it("drops the trailing periods the old copy carried", () => {
    const season = headcountLine({ kind: "season", week: 6, alive: 29, eliminated: 15 });
    const pre = headcountLine({ kind: "preseason", joined: 12, startsIn: "3d 4h" });
    for (const line of [season, pre]) {
      for (const value of Object.values(line)) {
        if (typeof value === "string") expect(value.endsWith(".")).toBe(false);
      }
    }
  });

  it("neither inflects nor divides by zero", () => {
    // "still standing" has no plural, so nothing counts nouns here any more —
    // and an empty league is 0/0, which would otherwise print as "NaN%".
    expect(headcountLine({ kind: "season", week: 1, alive: 1, eliminated: 1 })).toMatchObject({
      primary: "1 still standing",
      percent: "50%",
    });
    expect(headcountLine({ kind: "season", week: 1, alive: 0, eliminated: 0 })).toMatchObject({
      primary: "0 still standing",
      percent: "0%",
    });
  });

  // "joined" is a past participle here, not a countable noun — which is exactly
  // what the old header's `{joined === 1 ? "joined" : "joined"}` was groping at.
  it("never inflects 'joined'", () => {
    for (const joined of [0, 1, 2, 40]) {
      expect(headcountLine({ kind: "preseason", joined, startsIn: "1h 0m" }).primary).toBe(
        `${joined} joined`,
      );
    }
  });

  it("handles a wiped-out league and an untouched one", () => {
    expect(headcountLine({ kind: "season", week: 18, alive: 0, eliminated: 44 })).toMatchObject({
      primary: "0 still standing",
      percent: "100%",
    });
    expect(headcountLine({ kind: "season", week: 1, alive: 44, eliminated: 0 })).toMatchObject({
      primary: "44 still standing",
      percent: "0%",
    });
  });
});

describe("countNoun", () => {
  it("inflects on the number, not on the word", () => {
    expect(countNoun(1, "member")).toBe("1 member");
    expect(countNoun(27, "member")).toBe("27 members");
  });

  it("still pluralises at zero", () => {
    expect(countNoun(0, "member")).toBe("0 members");
  });

  it("takes an explicit plural for words that do not just take an s", () => {
    expect(countNoun(2, "entry", "entries")).toBe("2 entries");
  });
});

describe("teamScoreline", () => {
  const scored = (status: Game["status"], homeScore: number, awayScore: number): Game => ({
    ...game(EARLY, "kc", "buf"),
    status,
    homeScore,
    awayScore,
  });

  it("reads the score from each side's perspective", () => {
    const g = scored("final", 24, 20);
    expect(teamScoreline(g, "kc")).toEqual({ for: 24, against: 20, opponent: "buf" });
    expect(teamScoreline(g, "buf")).toEqual({ for: 20, against: 24, opponent: "kc" });
  });

  it("shows a real 0 once the game is under way", () => {
    expect(teamScoreline(scored("in_progress", 0, 0), "kc")).toEqual({
      for: 0,
      against: 0,
      opponent: "buf",
    });
    expect(teamScoreline(scored("final", 0, 3), "kc")?.for).toBe(0);
  });

  // The one this guard exists for. ESPN sends `score: "0"` on a game nobody has
  // played and `parseScore` stores a real 0, so a null check alone would print
  // "0" on every future week. The mocks pass no scores and land null, which is
  // why this never reproduced locally.
  it("hides the feed's placeholder 0 on a game that has not been played", () => {
    expect(teamScoreline(scored("scheduled", 0, 0), "kc")).toBeNull();
    expect(teamScoreline(scored("postponed", 0, 0), "kc")).toBeNull();
  });

  it("still hides a scheduled game carrying a non-zero score", () => {
    expect(teamScoreline(scored("scheduled", 21, 17), "kc")).toBeNull();
  });

  it("counts a delayed game as played, so a real score survives the delay", () => {
    expect(teamScoreline(scored("delayed", 14, 10), "kc")?.for).toBe(14);
  });

  it("is null when either side has no score at all", () => {
    const g: Game = { ...game(EARLY, "kc", "buf"), status: "final", homeScore: 24, awayScore: null };
    expect(teamScoreline(g, "kc")).toBeNull();
  });

  it("is null for a team that is not in the game", () => {
    expect(teamScoreline(scored("final", 24, 20), "phi")).toBeNull();
  });
});
