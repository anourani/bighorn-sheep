import { describe, expect, it } from "vitest";
import { entryKey, groupPicksByEntry } from "./entry-key";

/** The shape both callers pass: a pick row narrowed to the two fields that key it. */
type Row = { user_id: string; entry_no?: number | null; week: number; team_id: string };

const row = (over: Partial<Row> & Pick<Row, "user_id" | "week">): Row => ({
  team_id: "kc",
  ...over,
});

describe("entryKey", () => {
  it("keys on the PAIR, so one person's two entries are two keys", () => {
    expect(entryKey("u1", 1)).not.toBe(entryKey("u1", 2));
  });

  it("folds a pre-0017 row to entry 1, matching what a pre-0017 membership asks for", () => {
    // The column is absent until 0017 is applied by hand, so the value is
    // `undefined` at runtime on both sides of the lookup. Both have to land on
    // the same string or a database one migration behind the code loses every
    // pick off the board.
    expect(entryKey("u1", undefined)).toBe(entryKey("u1", 1));
    expect(entryKey("u1", null)).toBe(entryKey("u1", 1));
  });
});

describe("groupPicksByEntry", () => {
  it("keeps two entries' picks for the SAME week apart", () => {
    // The bug this exists to stop: keyed on user_id alone, week 1 held two rows
    // and `find(p => p.week === 1)` took whichever came back first — so one
    // entry was scored against the other entry's pick, and the loser's own row
    // never had its result written at all.
    const rows = [
      row({ user_id: "u1", entry_no: 1, week: 1, team_id: "kc" }),
      row({ user_id: "u1", entry_no: 2, week: 1, team_id: "buf" }),
    ];

    const byEntry = groupPicksByEntry(rows);

    expect(byEntry.get(entryKey("u1", 1))).toEqual([rows[0]]);
    expect(byEntry.get(entryKey("u1", 2))).toEqual([rows[1]]);
  });

  it("puts a row with no entry_no under entry 1", () => {
    const legacy = row({ user_id: "u1", week: 3 });
    expect(groupPicksByEntry([legacy]).get(entryKey("u1", 1))).toEqual([legacy]);
  });

  it("separates two people who share an entry number", () => {
    const rows = [row({ user_id: "u1", week: 1 }), row({ user_id: "u2", week: 1 })];
    const byEntry = groupPicksByEntry(rows);
    expect(byEntry.get(entryKey("u1", 1))).toEqual([rows[0]]);
    expect(byEntry.get(entryKey("u2", 1))).toEqual([rows[1]]);
  });

  it("tolerates a missing result set rather than throwing", () => {
    // Every Supabase read in this app destructures `{ data }` and hands it
    // straight on, so `null` reaches this on any failed query.
    expect(groupPicksByEntry(null).size).toBe(0);
    expect(groupPicksByEntry(undefined).size).toBe(0);
  });
});
