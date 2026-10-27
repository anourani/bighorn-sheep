import { describe, expect, it } from "vitest";
import { championOf } from "./champion";

type Row = { id: string; status: "alive" | "eliminated"; eliminatedWeek: number | null };
const alive = (id: string): Row => ({ id, status: "alive", eliminatedWeek: null });
const out = (id: string, week: number): Row => ({ id, status: "eliminated", eliminatedWeek: week });

describe("championOf", () => {
  it("names the last entry standing and the week the field emptied", () => {
    expect(championOf([alive("a"), out("b", 6), out("c", 6), out("d", 2)])).toEqual({
      memberId: "a",
      week: 6,
    });
  });

  it("keeps the champion after they play on and lose", () => {
    // The league's real case: Daniel won Week 6, kept picking, lost Week 7 and
    // was marked eliminated. He still lasted longest, and Week 6 is still the
    // week he won it in.
    expect(championOf([out("daniel", 7), out("brady", 6), out("jack", 6), out("ali", 2)])).toEqual(
      { memberId: "daniel", week: 6 },
    );
  });

  it("has no champion while two or more are still alive", () => {
    expect(championOf([alive("a"), alive("b"), out("c", 3)])).toBeNull();
  });

  it("has no champion after a wipeout", () => {
    expect(championOf([out("a", 6), out("b", 6), out("c", 2)])).toBeNull();
  });

  it("refuses to guess when an elimination week is missing", () => {
    expect(
      championOf([alive("a"), { id: "b", status: "eliminated", eliminatedWeek: null }]),
    ).toBeNull();
  });

  it("needs at least two entries", () => {
    expect(championOf([alive("a")])).toBeNull();
    expect(championOf([])).toBeNull();
  });
});
