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
 * THE ORDER IS PAGE-THEN-DETAIL, and that is the whole shape of the deck: a nav
 * card introduces a page, and the cards after it teach that page before the next
 * one arrives. The design's own order ran the three pages first and the four
 * rules after, which put "Hidden Picks" — an illustration of the standings
 * board — five cards away from the card explaining the standings board. Here
 * they are adjacent, and the three nav-pill illustrations read as section
 * dividers rather than three near-identical cards in a row.
 *
 * THE COPY IS NOT THE PROTOTYPE'S. Its version described each screen —
 * "Standings — the board / Fills in as picks reveal" — which names what you are
 * looking at and tells you nothing you can act on. Every step now says what the
 * thing IS and then how to USE it.
 *
 * Two things it must stay honest about, both checked against the schema rather
 * than the mock-ups. The account step does not promise a TIMEZONE setting — the
 * design's account screen had one and this app has never had one. And no step
 * says a tie eliminates you: `tie_rule` defaults to `push` (0001), so a tie
 * SURVIVES, and only a league that has opted into `loss` behaves the way the
 * landing page's pitch describes. There is a test for both.
 *
 * The prototype also carried a `dry` tone behind a prop; only one tone is
 * shipped, so the other is not carried here — `git log` and the handoff bundle
 * are where it lives if it is ever wanted.
 */

/** Which illustration a step draws. See `TourArt`. */
export type TourArtKind = "tabs" | "card" | "strip" | "lock" | "board";

/**
 * A run of body text, optionally struck through.
 *
 * Exists for exactly one joke — "the team you ~~know~~ think is going to win" —
 * and the shape is deliberately the smallest thing that serves it. Every other
 * step's body is a plain string, and a step that needs no strike should stay
 * one rather than becoming a single-element array for symmetry.
 */
export type BodySegment = {
  readonly text: string;
  /**
   * Drawn with a line through it AND hidden from the accessibility tree.
   *
   * Both halves matter. The gag is visual — read aloud, "the team you know
   * think is going to win" is nonsense — so the struck word is removed from
   * what a screen reader announces rather than merely styled. `bodyText` and
   * `spokenBodyText` below are the two readings, and they differ only here.
   */
  readonly strike?: boolean;
};

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
  readonly body: string | readonly BodySegment[];
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

/** Seven steps: each page, then the details of that page. */
export const TOUR_STEPS: NonEmpty<TourStep> = [
  {
    art: "tabs",
    tab: 0,
    title: "The Picks Page",
    body: "This is where you pick your team each week. Tap the week you want, then tap a team. That's it.",
  },
  {
    art: "strip",
    title: "The Week Selector",
    body: "Weeks act like tabs. Tap one and that week's teams appear below. Weeks you've already picked show their team.",
  },
  {
    art: "card",
    title: "Making Your Pick",
    // The one segmented body in the deck. The spaces live in the unstruck runs,
    // so the struck word can be dropped from the spoken reading without the
    // words either side of it running together.
    body: [
      { text: "Select the team you " },
      { text: "know", strike: true },
      {
        text: " think is going to win. Remember, you can't pick the same team twice so choose wisely!",
      },
    ],
  },
  {
    art: "lock",
    title: "Your Pick Gets Locked In",
    body: "The team you pick is locked the moment their game starts. You can change your pick any time before that.",
  },
  {
    art: "tabs",
    tab: 1,
    title: "The Standings Page",
    body: "This is the league scoreboard. See what teams everyone else picked, who's in and who's out.",
  },
  {
    art: "board",
    title: "Hidden Picks",
    body: 'Everybody\'s pick on the Standings page will read as "Hidden" until that team is locked in.',
  },
  {
    art: "tabs",
    tab: 2,
    title: "The Account Page",
    body: "This is where you go for all things account related. Update your account info and pay your buy-in dues!",
  },
];

export const TOUR_STEP_COUNT = TOUR_STEPS.length;

/** Every segment joined — what the card DRAWS. */
export function bodyText(body: TourStep["body"]): string {
  return typeof body === "string" ? body : body.map((s) => s.text).join("");
}

/**
 * What a screen reader ANNOUNCES: the same, minus anything struck through.
 *
 * Whitespace is collapsed, and that is the whole subtlety. A struck word sits
 * between two runs that each carry a space so the DRAWN sentence reads "you
 * know think"; remove the middle one and those two spaces meet, leaving "you
 * think" with a double gap. Some screen readers pause on that. Normalising here
 * rather than shuffling the spaces into the struck segment means the fix holds
 * however a future body is split, instead of depending on whoever writes it
 * remembering which side the space belongs on.
 */
export function spokenBodyText(body: TourStep["body"]): string {
  if (typeof body === "string") return body;
  return body
    .filter((s) => !s.strike)
    .map((s) => s.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

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
