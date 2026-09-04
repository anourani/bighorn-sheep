/**
 * The first-run tour's content, and the view state derived from a step index.
 *
 * Pure, and a module of its own for the reason every other `*.ts` sitting beside
 * a `.tsx` in this repo is one: there is no jsdom here, so a component can only
 * be tested by reading its source for class names. Anything with an *answer* —
 * which label the button takes, which dot is lit, whether Back exists — belongs
 * somewhere a test can call it.
 *
 * This file has NO imports, deliberately. Two reasons, and the second is the
 * one that bites: there is no `vitest.config.ts` in this repo, so vitest never
 * reads tsconfig's `paths` and an `@/` *value* import resolves under Next and
 * throws under test (`team-grid.ts` and `week-strip.ts` spell theirs
 * `../../lib/...` for this). Having none at all sidesteps the question.
 *
 * The copy is the design's WARM set, transcribed verbatim. The prototype also
 * carried a `dry` set behind a `tone` prop; only one tone is shipped, so the
 * other is not carried here — `git log` and the handoff bundle are where it
 * lives if it is ever wanted.
 */

/** Which illustration a step draws. See `TourArt`. */
export type TourArtKind = "tabs" | "card" | "strip" | "lock" | "board";

export type TourStep = {
  readonly art: TourArtKind;
  /**
   * Which nav tab the `tabs` illustration lights up. Only meaningful for
   * `art: "tabs"`, and absent everywhere else rather than defaulted to 0 — a
   * field that can only hold one value gets read as a real one eventually.
   *
   * Named `tab` rather than `tabIndex`, which is a DOM attribute with entirely
   * different meaning and would read as one at every call site.
   */
  readonly tab?: 0 | 1 | 2;
  readonly title: string;
  readonly body: string;
};

/**
 * A list the compiler knows has a first element.
 *
 * `noUncheckedIndexedAccess` is on, so indexing any array by a `number` yields
 * `T | undefined` however well the index has just been bounded. Spelling the
 * deck as a non-empty tuple keeps `TOUR_STEPS[0]` definite, which is what lets
 * `tourView` fall back without a non-null assertion — and it makes "there is
 * always at least one card" a fact the type system holds rather than a comment.
 */
type NonEmpty<T> = readonly [T, ...T[]];

/**
 * Seven steps: the three tabs, then the four rules that actually cost people
 * their season. The order is the design's and is not arbitrary — the tabs
 * orient you before any rule is stated, and the rules then run in the order you
 * meet them (pick a team, spend it, watch it lock, wait for the reveal).
 */
export const TOUR_STEPS: NonEmpty<TourStep> = [
  {
    art: "tabs",
    tab: 0,
    title: "Picks — this screen",
    body: "Make your pick here each week. That's the whole job.",
  },
  {
    art: "tabs",
    tab: 1,
    title: "Standings — the board",
    body: "Fills in as picks reveal. Track who's still alive.",
  },
  {
    art: "tabs",
    tab: 2,
    title: "Account — your league",
    body: "League, timezone, and this tour if you need it again.",
  },
  {
    art: "card",
    title: "Tap a team to pick it",
    body: "One team a week. They win, you survive to the next one.",
  },
  {
    art: "strip",
    title: "One team, once a season",
    body: "The team you pick shows right on its week in the week selector, so you can always see what you've used.",
  },
  {
    art: "lock",
    title: "Locks at its own kickoff",
    body: "A Thursday team locks Thursday. Change your pick freely until then.",
  },
  {
    art: "board",
    title: "Picks are hidden until kickoff",
    body: "You can't see anyone else's team until its game starts.",
  },
];

export const TOUR_STEP_COUNT = TOUR_STEPS.length;

/** Everything the carousel draws for one step. */
export type TourView = {
  readonly step: TourStep;
  /** `"01 / 07"` — zero-padded and 1-based, drawn tabular so it cannot jitter. */
  readonly counter: string;
  /** One entry per step; `true` on the current one. */
  readonly dots: readonly boolean[];
  readonly nextLabel: string;
  readonly skipLabel: string;
  readonly canBack: boolean;
  readonly isLast: boolean;
};

/**
 * Hold an index inside the deck.
 *
 * Exported because the component needs the same answer when it steps forward,
 * and two copies of `Math.min(Math.max(...))` is how they come to disagree.
 * A non-integer or NaN index resolves to 0 rather than propagating: this is
 * reached from component state, so the only way to get one is a bug, and
 * landing on step 1 is a better failure than a blank card.
 */
export function clampStep(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), TOUR_STEP_COUNT - 1);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Derive the whole of one step's chrome.
 *
 * `ctaLabel` is the caller's, not this module's: the tour hands off to the pick
 * screen ("Make my pick") and the account page's replay hands back to where it
 * started ("Back to Account"). One component, two exits — which is the reason
 * the label is a parameter rather than an eighth step.
 */
export function tourView(index: number, ctaLabel: string): TourView {
  const i = clampStep(index);
  const isLast = i === TOUR_STEP_COUNT - 1;

  // Restating `clampStep`'s guarantee for the compiler, not a real branch: a
  // number index is `TourStep | undefined` under `noUncheckedIndexedAccess`
  // whatever bounds it. The fallback is free of assertions because the deck is
  // a `NonEmpty` tuple, so element 0 is definite.
  const step = TOUR_STEPS[i] ?? TOUR_STEPS[0];

  return {
    step,
    counter: `${pad(i + 1)} / ${pad(TOUR_STEP_COUNT)}`,
    dots: TOUR_STEPS.map((_, n) => n === i),
    nextLabel: isLast ? ctaLabel : "Next",
    // "Skip" is a promise about the rest of the deck; on the last card there is
    // no rest, so it becomes a decline of the CTA beside it.
    skipLabel: isLast ? "Not now" : "Skip",
    canBack: i > 0,
    isLast,
  };
}
