import { describe, expect, it } from "vitest";
import { isAfterElimination } from "./post-elimination";

describe("isAfterElimination", () => {
  it("is never true for a living entry", () => {
    expect(isAfterElimination({ status: "alive" }, 1)).toBe(false);
    expect(isAfterElimination({ status: "alive", eliminatedWeek: 3 }, 9)).toBe(false);
  });

  it("is true only for weeks strictly after the elimination week", () => {
    const out = { status: "eliminated" as const, eliminatedWeek: 5 };
    expect(isAfterElimination(out, 4)).toBe(false);
    // The elimination week itself stays visible: it is the losing pick, the
    // record of how the entry went out.
    expect(isAfterElimination(out, 5)).toBe(false);
    expect(isAfterElimination(out, 6)).toBe(true);
    expect(isAfterElimination(out, 18)).toBe(true);
  });

  it("hides nothing when the elimination week is unknown", () => {
    // `cellFor`'s standing guard, and the SQL helper's `is not null` — a row
    // marked out with no week recorded draws its history rather than blanking
    // the season.
    expect(isAfterElimination({ status: "eliminated", eliminatedWeek: null }, 9)).toBe(false);
    expect(isAfterElimination({ status: "eliminated" }, 9)).toBe(false);
  });

  it("matches the SQL predicate in 0020 word for word", async () => {
    // The database is the real privacy boundary; this module is the client's
    // copy of the same rule. If the SQL moves, this is the reminder.
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(
      new URL("../../../supabase/migrations/0020_picks_after_elimination.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toMatch(/gm\.status\s*=\s*'eliminated'/);
    expect(sql).toMatch(/gm\.eliminated_week is not null/);
    expect(sql).toMatch(/p_week\s*>\s*gm\.eliminated_week/);
  });
});

describe("its consumers", () => {
  /*
   * The helper reads `eliminatedWeek`, and that field is OPTIONAL on its input
   * so a `Member` can be passed whole. The database row is snake_case
   * (`eliminated_week`), so passing IT whole typechecks and never filters —
   * which is exactly what the first draft of `toMember` did. Source-text guard,
   * because `load.ts` is `server-only` and cannot be imported here.
   */
  it("is handed the loader's row field by field, never the raw row", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./load.ts", import.meta.url), "utf8");
    expect(src).toContain(
      "isAfterElimination({ status: row.status, eliminatedWeek: row.eliminated_week }, p.week)",
    );
    expect(src).not.toMatch(/isAfterElimination\(row,/);
  });

  it("is handed the action's target row field by field too", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../../app/app/actions.ts", import.meta.url), "utf8");
    expect(src).toContain(
      "isAfterElimination({ status: target.status, eliminatedWeek: target.eliminated_week }, input.week)",
    );
  });
});
