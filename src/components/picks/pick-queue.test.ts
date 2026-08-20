import { describe, expect, it } from "vitest";
import { IDLE_QUEUE, settlePick, tapPick } from "./pick-queue";

describe("tapPick", () => {
  it("submits immediately from idle and seeds the revert baseline", () => {
    const { state, submit } = tapPick(IDLE_QUEUE, "kc", "buf");

    expect(submit).toBe("kc");
    expect(state).toEqual({ inFlight: "kc", queued: null, confirmed: "buf" });
  });

  it("queues without submitting while a request is in flight", () => {
    const first = tapPick(IDLE_QUEUE, "kc", null);
    const second = tapPick(first.state, "sea", null);

    expect(second.submit).toBeNull();
    expect(second.state.inFlight).toBe("kc");
    expect(second.state.queued).toBe("sea");
  });

  // The trailing coalesce: A → B → C while A is in flight sends A and C only.
  it("keeps only the newest tap — the middle one is never sent", () => {
    let tap = tapPick(IDLE_QUEUE, "kc", null);
    tap = tapPick(tap.state, "sea", null);
    tap = tapPick(tap.state, "dal", null);

    expect(tap.state.queued).toBe("dal");
    expect(settlePick(tap.state, true).submit).toBe("dal");
  });

  // Mid-chain the screen shows the optimistic overlay, which must never become
  // the revert target — so a later tap's serverValue is ignored.
  it("seeds confirmed from the server value only at chain start", () => {
    const first = tapPick(IDLE_QUEUE, "kc", "buf");
    const second = tapPick(first.state, "sea", "kc");

    expect(second.state.confirmed).toBe("buf");
  });
});

describe("settlePick", () => {
  it("goes idle on success with nothing queued, confirming the sent team", () => {
    const { state } = tapPick(IDLE_QUEUE, "kc", null);

    expect(settlePick(state, true)).toEqual({
      state: { inFlight: null, queued: null, confirmed: "kc" },
      submit: null,
      revert: null,
      surfaceError: false,
    });
  });

  it("releases the queued tap on success and stays in flight", () => {
    let tap = tapPick(IDLE_QUEUE, "kc", null);
    tap = tapPick(tap.state, "sea", null);
    const settled = settlePick(tap.state, true);

    expect(settled.submit).toBe("sea");
    expect(settled.state).toEqual({ inFlight: "sea", queued: null, confirmed: "kc" });
    expect(settled.revert).toBeNull();
    expect(settled.surfaceError).toBe(false);
  });

  // The baseline moves with each success: A succeeded, so B's failure must
  // land the screen on A — not on the pre-chain team.
  it("reverts a failure to the last confirmed pick, not the chain start", () => {
    let tap = tapPick(IDLE_QUEUE, "kc", "buf");
    tap = tapPick(tap.state, "sea", null);
    const afterA = settlePick(tap.state, true); // kc confirmed, sea released
    const afterB = settlePick(afterA.state, false);

    expect(afterB.revert).toEqual({ to: "kc" });
    expect(afterB.surfaceError).toBe(true);
    expect(afterB.state).toEqual({ inFlight: null, queued: null, confirmed: "kc" });
  });

  // The user no longer wants the failed team; the queued submit gets its own
  // verdict, and a blanket refusal resurfaces there one settle later.
  it("is silent when a failed request was superseded, and sends the queued tap", () => {
    let tap = tapPick(IDLE_QUEUE, "kc", "buf");
    tap = tapPick(tap.state, "sea", null);
    const settled = settlePick(tap.state, false);

    expect(settled.submit).toBe("sea");
    expect(settled.revert).toBeNull();
    expect(settled.surfaceError).toBe(false);
    // The failure did not advance the baseline.
    expect(settled.state).toEqual({ inFlight: "sea", queued: null, confirmed: "buf" });
  });

  it("reverts and surfaces the error when the latest request fails", () => {
    const { state } = tapPick(IDLE_QUEUE, "kc", "buf");
    const settled = settlePick(state, false);

    expect(settled.revert).toEqual({ to: "buf" });
    expect(settled.surfaceError).toBe(true);
    expect(settled.submit).toBeNull();
  });

  it("does not resubmit a queued tap equal to the team just confirmed", () => {
    let tap = tapPick(IDLE_QUEUE, "kc", null);
    tap = tapPick(tap.state, "kc", null); // tapped back to the in-flight team
    const settled = settlePick(tap.state, true);

    expect(settled.submit).toBeNull();
    expect(settled.state).toEqual({ inFlight: null, queued: null, confirmed: "kc" });
    expect(settled.surfaceError).toBe(false);
  });

  // Tapped away and back: the failed write asked for nothing the server does
  // not already hold, so there is neither a resubmit nor an error — just the
  // confirmed value written back over the overlay, which already shows it.
  it("stays silent when a failure's queued tap is already the confirmed team", () => {
    let tap = tapPick(IDLE_QUEUE, "sea", "kc"); // server holds kc, user tries sea
    tap = tapPick(tap.state, "kc", null); // then goes back to kc
    const settled = settlePick(tap.state, false);

    expect(settled.submit).toBeNull();
    expect(settled.revert).toEqual({ to: "kc" });
    expect(settled.surfaceError).toBe(false);
    expect(settled.state).toEqual({ inFlight: null, queued: null, confirmed: "kc" });
  });

  // The overlay's explicit-null semantics (see pickForWeek): starting from "no
  // pick", a failed chain must revert to an explicit null, not to an absent key.
  it("reverts to an explicit null when the chain started with no pick", () => {
    const { state } = tapPick(IDLE_QUEUE, "kc", null);
    const settled = settlePick(state, false);

    expect(settled.revert).toEqual({ to: null });
  });

  it("walks a rapid A→B→C to a quiet end on C", () => {
    let tap = tapPick(IDLE_QUEUE, "kc", "buf"); // A sent
    tap = tapPick(tap.state, "sea", null); // B queued
    tap = tapPick(tap.state, "dal", null); // C replaces B

    const afterA = settlePick(tap.state, true); // A lands, C sent — B never was
    expect(afterA.submit).toBe("dal");

    const afterC = settlePick(afterA.state, true);
    expect(afterC).toEqual({
      state: { inFlight: null, queued: null, confirmed: "dal" },
      submit: null,
      revert: null,
      surfaceError: false,
    });
  });
});
