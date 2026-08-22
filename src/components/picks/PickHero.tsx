import { BlurReveal } from "@/components/ui/BlurReveal";
import {
  BLUR_REVEAL_CLASS,
  cascadeStarts,
  revealDelay,
  wordCount,
} from "@/components/ui/blur-reveal";
import { Label } from "@/components/ui/Label";
import { LocalTime } from "@/components/ui/LocalTime";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { cn } from "@/lib/cn";
import { getTeam, type TeamId } from "@/lib/nfl/teams";
import { isKickedOff, type Game } from "@/lib/nfl/types";
import { countdown } from "@/lib/time";
import { isHome, opponentOf } from "@/lib/league/view";
import { stripGradient } from "./pick-hero";

/**
 * The My Picks hero: who you are riding with this week.
 *
 * The team's colour lives in three vertical strips behind its logo, and nothing
 * else on the module is coloured — eyebrow, name, matchup and lock copy are all
 * ordinary page text. That is the whole design, and it is why this file is no
 * longer 250 lines: the predecessor washed the entire module in the team colour,
 * so every string sat *on* that wash and the component had to compute per-team
 * gradient endpoints and flip its text between ink and white to clear WCAG AA at
 * the card's worst point. Decoration nothing has to be legible on top of needs
 * none of that.
 *
 * Two invariants worth keeping:
 *
 *  - **The module is the same height for every team.** The row is a fixed
 *    height, the strips are `h-full` of it, and the name is size-clamped rather
 *    than wrapped. A previous version's height varied with the pick, so the page
 *    grew and shrank as you moved along the week strip; here that is structural
 *    rather than a thing to remember.
 *  - **Nothing in the tree may take `overflow-hidden`.** From `lg` the logo is
 *    pinned left-of-centre inside the strips and deliberately overhangs them to
 *    the right, into the gap before the team name. Below `lg` it is centred on
 *    the strips instead and overhangs nothing — the two placements are the
 *    design, not a breakpoint that was left half-finished.
 */
export function PickHero({
  teamId,
  game,
  weekName,
  now,
  weekFinalKickoff,
}: {
  teamId: TeamId | null;
  game: Game | undefined;
  /** Formatted week label — "Week 5", "Preseason 2", "Hall of Fame". */
  weekName: string;
  now: Date;
  weekFinalKickoff: Date | null;
}) {
  if (!teamId || !game) {
    return <NoPickHero weekName={weekName} now={now} weekFinalKickoff={weekFinalKickoff} />;
  }

  const team = getTeam(teamId);
  if (!team) {
    return <NoPickHero weekName={weekName} now={now} weekFinalKickoff={weekFinalKickoff} />;
  }
  const opp = getTeam(opponentOf(game, teamId));
  const home = isHome(game, teamId);
  const kicked = isKickedOff(game, now);
  const cd = countdown(new Date(game.kickoff), now);

  const eyebrow = eyebrowFor(weekName);
  const matchup = `${home ? "vs." : "@"} ${opp?.name ?? "TBD"}`;
  const lockLines = kicked
    ? [ink("This game has kicked off — your pick is now visible to the group.")]
    : [
        ink(`Locks in ${cd.label}`),
        mute("Only you can see this pick until the game kicks off"),
      ];

  /* Every piece of the module replays together, off one key. See `replayFor`. */
  const replay = replayFor(weekName, teamId, game.id, kicked);

  /* The cascade, in the order it reads: the eyebrow, a wave across the three
     colour strips, the mark landing on them, then the name and everything to
     its right. The strips and the logo are one slot each — they are not split.
     The rest element collects the lock column, whose line count varies by
     branch, which is exactly why those lines are built as data above rather
     than as JSX: the counts here cannot drift from what renders.

     The `= 0` defaults are unreachable — `cascadeStarts` returns exactly one
     entry per count — and are here only because `noUncheckedIndexedAccess`
     types every element of a `number[]` as possibly undefined. */
  const [
    eyebrowAt = 0,
    stripAt = 0,
    stripBt = 0,
    stripCt = 0,
    logoAt = 0,
    cityAt = 0,
    nameAt = 0,
    matchupAt = 0,
    dateAt = 0,
    timeAt = 0,
    ...lockAt
  ] = cascadeStarts([
    wordCount(eyebrow),
    1,
    1,
    1,
    1,
    wordCount(team.location),
    wordCount(team.name),
    wordCount(matchup),
    1,
    1,
    // One slot per LINE, not per word — `LockLines` reveals them whole.
    ...lockLines.map(() => 1),
  ]);

  return (
    <Shell eyebrow={eyebrow} start={eyebrowAt} replay={replay}>
      <PickRow>
        {/* The key is on the GROUP, not on each strip and the logo separately:
            the three strips and the mark over them are one object, and one key
            remounts all four so their animations restart together. A CSS
            animation has no other way to replay — see `BlurReveal`, which does
            the same thing internally for every piece of text below. */}
        <Strips key={replay}>
          {/* The one place the team's colour appears. `down`/`up`/`down` so the
              three read as one object catching light, not three copies of a bar. */}
          <Strip gradient={stripGradient(team.color, "down")} start={stripAt} />
          <Strip gradient={stripGradient(team.color, "up")} start={stripBt} />
          <Strip gradient={stripGradient(team.color, "down")} start={stripCt} />

          {/* Centred over the strips below `lg`; from `lg` offset right of them,
              where it overhangs into the gap before the name.

              `w-max` is load-bearing and its absence is a silent bug. This span
              is absolutely positioned with a `left` and no width, so without it
              the span shrink-to-fits into the space between that offset and the
              strip group's right edge — 65px at `lg` — and Tailwind preflight's
              `img { max-width: 100% }` then quietly overrides TeamLogo's inline
              width and letterboxes the logo into it. An 80px logo rendered at
              50px wide, at every breakpoint, and looked merely "a bit small"
              rather than broken. `w-max` makes the width `max-content`, which is
              a definite width, so shrink-to-fit never applies.

              Sizes are the Figma's own (50 / 80) with a middle step between.
              `lg:left-[18px]` is the Figma's number too, and holds the mark's
              centre 58px from the strip group's left edge (18 + 80/2); change
              the size and that offset has to move with it.

              Three elements rather than one because TeamLogo writes width/height
              as an inline style, which no responsive class can reach.
              `aria-hidden` because the <h1> already names the team. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-max -translate-x-1/2 -translate-y-1/2 lg:left-[18px] lg:translate-x-0"
          >
            {/* The reveal goes on a span INSIDE this wrapper, never on the
                wrapper itself. Those `-translate-*` classes compile to a
                `transform`, and `blur-in` animates `transform` too — so the
                keyframe would replace the centring for its whole 1250ms and
                fling the logo to the strips' top-left corner before it snapped
                back into place.

                `block` rather than the default `inline-block`, so this span does
                not sit on a baseline of its own: an inline-block would add a
                second line box's descender inside the wrapper and lift the
                `-translate-y-1/2` centring a couple of pixels. It renders no
                width of its own either way, so the `w-max` above is still what
                keeps preflight off the logo. */}
            <BlurReveal start={logoAt} className="block">
              <TeamLogo teamId={teamId} size={50} className="md:hidden" />
              <TeamLogo teamId={teamId} size={64} className="hidden md:block lg:hidden" />
              <TeamLogo teamId={teamId} size={80} className="hidden lg:block" />
            </BlurReveal>
          </span>
        </Strips>

        <Identity>
          <Name
            city={team.location}
            cityStart={cityAt}
            name={team.name}
            nameStart={nameAt}
            replay={replay}
          />
          <Rule />
          <Meta>
            {/* The `<span>` around the matchup is load-bearing now that the
                words animate separately. `Meta` is a flex row with `gap-1`, so
                two bare word spans would become flex items in their own right —
                the whitespace between them dropped (a flex container discards
                whitespace-only text nodes) and the gutter set by `gap` instead.
                Every wrapper below is doing the same job. */}
            <span>
              <BlurReveal text={matchup} start={matchupAt} replayKey={replay} />
            </span>
            <MetaDivider />
            {/* One piece each, not split into words: `LocalTime` rewrites its
                own text in an effect once it knows the viewer's zone, so there
                is nothing stable to split. */}
            <BlurReveal start={dateAt} replayKey={replay}>
              <LocalTime iso={game.kickoff} mode="date" />
            </BlurReveal>
            <MetaDivider />
            <BlurReveal start={timeAt} replayKey={replay}>
              <LocalTime iso={game.kickoff} mode="clockzone" />
            </BlurReveal>
          </Meta>
        </Identity>
      </PickRow>

      <LockColumn>
        <LockLines lines={lockLines} starts={lockAt} replay={replay} />
      </LockColumn>
    </Shell>
  );
}

/**
 * The same module with nothing picked. It keeps the filled state's skeleton
 * exactly — including invisible stand-ins for the city and matchup lines — so
 * the headline's baseline does not move as you step between a picked week and an
 * unpicked one.
 */
function NoPickHero({
  weekName,
  now,
  weekFinalKickoff,
}: {
  weekName: string;
  now: Date;
  weekFinalKickoff: Date | null;
}) {
  const cd = weekFinalKickoff ? countdown(weekFinalKickoff, now) : null;

  const eyebrow = eyebrowFor(weekName);
  const lockLines = [
    ...(cd ? [ink(`Week locks in ${cd.label}`)] : []),
    mute("Miss the final kickoff and it counts as a loss."),
  ];

  /* Nothing else here can change — there is no team and no game — so the week
     is the whole key. Stepping between an unpicked week and a picked one swaps
     this component for `PickHero`, which React remounts on its own. */
  const replay = replayFor(weekName, null, null, false);

  /* The same sequence as the filled state minus the logo, the city and the
     matchup: those last two render as invisible stand-ins holding their lines'
     height, and an invisible word has nothing to reveal. The strips DO animate
     — they are on screen, inert grey rather than absent. */
  const [
    eyebrowAt = 0,
    stripAt = 0,
    stripBt = 0,
    stripCt = 0,
    nameAt = 0,
    ...lockAt
  ] = cascadeStarts([
    wordCount(eyebrow),
    1,
    1,
    1,
    wordCount(NO_PICK),
    // One slot per LINE, not per word — `LockLines` reveals them whole.
    ...lockLines.map(() => 1),
  ]);

  return (
    <Shell eyebrow={eyebrow} start={eyebrowAt} replay={replay}>
      <PickRow>
        <Strips key={replay}>
          {/* Inert: no gradient, no logo. The strips are still here because
              their absence would move the headline. */}
          <Strip start={stripAt} />
          <Strip start={stripBt} />
          <Strip start={stripCt} />
        </Strips>

        <Identity>
          <Name name={NO_PICK} nameStart={nameAt} replay={replay} />
          {/* No <Rule/> here: from `lg` it would be a hairline dividing the
              headline from empty space. The matchup below is `invisible` rather
              than absent because it holds that line's height, and so the
              headline lands where a team name's does — but the rule has nothing
              to separate, and a rule with nothing beside it reads as a mistake. */}
          <Meta className="invisible">&nbsp;</Meta>
        </Identity>
      </PickRow>

      <LockColumn>
        <LockLines lines={lockLines} starts={lockAt} replay={replay} />
      </LockColumn>
    </Shell>
  );
}

// ── The reveal ───────────────────────────────────────────────────────────────
//
// Every piece of this module — the three colour strips, the mark, and each line
// of text — fades in from blurred and slightly oversized, 40ms apart, reading
// left to right and top to bottom. The arithmetic is in `ui/blur-reveal.ts`;
// what lives here is the ORDER, and when the whole thing plays again.

/** The headline of the empty state, named because its word count is counted. */
const NO_PICK = "No Pick Made";

function eyebrowFor(weekName: string): string {
  return `Your ${weekName} Pick`;
}

/** A lock-column line and the ink it takes. */
type LockLine = { text: string; mute: boolean };
const ink = (text: string): LockLine => ({ text, mute: false });
const mute = (text: string): LockLine => ({ text, mute: true });

/**
 * The one value that decides when the module replays. It is shared by every
 * piece rather than each keying on its own content, so a change replays the
 * WHOLE cascade — the module re-forming, rather than a handful of unrelated
 * animations firing while the rest of it sits still.
 *
 * Between them these four cover every way the content can change: a team tap
 * (the team and its game, and with them the strips' colour, the mark, the
 * matchup, the kickoff and the countdown), a week change (the week name, and
 * usually the pick with it), and a game crossing kickoff mid-session, which
 * swaps the lock column wholesale. Tapping the team that is already picked
 * changes none of them, and correctly plays nothing.
 *
 * The countdown label needs no term of its own: `now` is memoized from the
 * server's `nowIso` in `MyPicksClient` and never ticks, so the label only moves
 * when the game does.
 *
 * Note what must NOT carry a key: `<PickHero>` itself, at its call site. Its
 * root `<section>` is a direct `.stagger` child, so remounting it would replay
 * `reveal-up` — a 12px lift of the whole block — on every single tap.
 */
function replayFor(
  weekName: string,
  teamId: TeamId | null,
  gameId: string | null,
  kicked: boolean,
): string {
  return `${weekName}|${teamId ?? "none"}|${gameId ?? "none"}|${kicked}`;
}

/**
 * The lock column's lines, each revealed in turn — a whole line at a time, NOT
 * word by word like everything above it.
 *
 * This is where the module's length was going. "Only you can see this pick
 * until the game kicks off" is eleven words, so at one slot each the privacy
 * line alone was eleven of the module's twenty-nine pieces and the cascade
 * spent its whole tail crawling across 12px grey type nobody reads twice. As
 * whole lines the module is sixteen pieces, and the wave ends on the lock copy
 * rather than dragging through it.
 */
function LockLines({
  lines,
  starts,
  replay,
}: {
  lines: LockLine[];
  starts: number[];
  replay: string;
}) {
  return (
    <>
      {lines.map((line, i) => (
        // Keyed on the text so a line that survives a rebuild is reconciled in
        // place; the reveal inside restarts regardless, off `replay`.
        <p key={line.text} className={line.mute ? "text-shell-mute" : "text-shell-ink"}>
          <BlurReveal start={starts[i] ?? 0} replayKey={replay}>
            {line.text}
          </BlurReveal>
        </p>
      ))}
    </>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────
//
// Split into named pieces because the two states share every one of them, and a
// second copy of this markup is exactly how the empty state drifts out of
// alignment with the filled one.
//
// The breakpoint throughout is `lg`, not `md`: the desktop row needs ~986px to
// hold an 80px headline beside a 168px lock column, and the shell is
// `max-w-shell` (1000px) inside a `px-4` gutter. It is also where WeekStrip and
// StandingsGrid change shape, so the page turns over at one width.

/**
 * Outer frame: the eyebrow, and the row/lock split below it.
 *
 * `py-10 lg:py-12` and `space-y-2 lg:space-y-3` are the Figma's four numbers, and
 * together they are the module's height: 40 + 15 + 8 + 92 + 8 + 39 + 40 = 242 on a
 * phone, and 48 + 17.6 + 12 + 132 + 48 = 258 from `lg`, where the lock copy sits
 * beside the row rather than under it and so adds nothing. Both frames land
 * exactly. A wrong number here shows up as a few pixels rather than as anything
 * obviously broken, so check the arithmetic before adjusting either by eye.
 */
function Shell({
  eyebrow,
  start,
  replay,
  children,
}: {
  /** Built by the caller, not from `weekName` here, because the caller has to
   *  count its words to lay out the rest of the cascade behind it. */
  eyebrow: string;
  start: number;
  replay: string;
  children: React.ReactNode;
}) {
  return (
    // `[--blur-ms:650ms]` sets this module's reveal pace, and only this
    // module's: `blur-in` reads its duration from that property, so every piece
    // below — strips, mark and text alike — inherits it without a prop being
    // threaded to a dozen call sites. Half the landing page's 1250ms, because
    // this module re-forms on every team tap and a title you look at once can
    // afford to take its time. A custom property declaration is not an
    // animation, so it does not collide with the `reveal-up` that `.stagger`
    // applies to this same element.
    <section className="space-y-2 py-10 [--blur-ms:650ms] lg:space-y-3 lg:border-b lg:border-shell-line lg:py-12">
      <Label className="lg:text-base lg:leading-[1.1]">
        <BlurReveal text={eyebrow} start={start} replayKey={replay} />
      </Label>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        {children}
      </div>
    </section>
  );
}

/** Strips, logo and text. Its fixed height is what sizes the strips. */
function PickRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[92px] items-center gap-2 md:h-[112px] md:gap-4 lg:h-[132px] lg:gap-[50px]">{children}</div>
  );
}

function Strips({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex h-full shrink-0 items-center gap-1">{children}</div>
  );
}

/** One strip. No gradient means the empty state's inert grey.
 *
 *  It carries the reveal itself rather than sitting inside a `<BlurReveal>`:
 *  the strips are flex items of a `h-full` row, and an extra span between them
 *  and `Strips` would take that row's sizing and leave the strip auto-height.
 *  It has no transform classes of its own, so the keyframe's `scale` is free to
 *  apply here — unlike the logo's wrapper next door. Its replay comes from the
 *  key on `Strips`. */
function Strip({ gradient, start }: { gradient?: string; start: number }) {
  return (
    <span
      className={cn(
        "h-full w-4 rounded-[4px] md:w-[18px] lg:w-5",
        BLUR_REVEAL_CLASS,
        !gradient && "bg-shell-dark",
      )}
      style={{
        animationDelay: `${revealDelay(start)}ms`,
        ...(gradient ? { backgroundImage: gradient } : null),
      }}
    />
  );
}

/** City + name, the rule, and the matchup — stacked on a phone, a row from `lg`. */
function Identity({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center lg:h-full lg:flex-row lg:items-center lg:gap-4">
      {children}
    </div>
  );
}

/**
 * The headline, sized to stay on one line at every width.
 *
 * `(100vw - 96px)` is the room the name actually has: the page's 32px gutter,
 * the 56px strip group and the 8px beside it. Dividing by `6.75` — a
 * deliberately generous em-width for the longest names in the league
 * ("Commanders", "Buccaneers") in Inter SemiBold — lands on exactly the design's
 * 44px at a 393px phone and shrinks below that rather than overflowing. Tracking
 * is in `em` so it stays proportional as the clamp bites.
 */
function Name({
  city,
  cityStart = 0,
  name,
  nameStart,
  replay,
}: {
  city?: string;
  cityStart?: number;
  name: string;
  nameStart: number;
  replay: string;
}) {
  return (
    <div className="flex flex-col justify-center pt-2 lg:py-5">
      {city ? (
        <Label>
          <BlurReveal text={city} start={cityStart} replayKey={replay} />
        </Label>
      ) : (
        // Holds the line the city would occupy, so "No Pick Made" sits where a
        // team name does.
        <Label className="invisible">&nbsp;</Label>
      )}
      <h1 className="max-w-full font-semibold leading-none tracking-[-0.04em] text-shell-ink text-[clamp(1.5rem,calc((100vw_-_96px)/6.75),2.75rem)] md:tracking-[-0.03em] md:text-[3.5rem] lg:tracking-[-0.025em] lg:text-[5rem]">
        <BlurReveal text={name} start={nameStart} replayKey={replay} />
      </h1>
    </div>
  );
}

/** The vertical hairline between the name and the matchup. Desktop only. */
function Rule() {
  return <div className="hidden h-full w-px shrink-0 bg-shell-line lg:block" />;
}

/** Matchup, date and kickoff — one line on a phone, three from `lg`.
 *
 *  12px on a phone, the design's body-14 (14px / 135%) from `lg`. Both are
 *  written with the slash shorthand that binds a leading to its size, rather
 *  than as a size beside a separate `leading-*`, and that is load-bearing
 *  rather than a style preference: a `text-*` utility carries a line-height of
 *  its own, and the `lg:`-prefixed one is emitted AFTER any unprefixed
 *  `leading-*` — so the pair silently reverts to the default 1.5 from `lg` up.
 *  Binding both halves into one utility per breakpoint is the only form that
 *  cannot come apart. `src/app/page.tsx` carries the same note for the same
 *  reason.
 *
 *  Spelled as an arbitrary value and NOT as a new `fontSize` token: `cn()` runs
 *  tailwind-merge, which parses a non-t-shirt name like `text-body-14` as a
 *  COLOUR and deletes it outright the moment a caller passes one — the trap
 *  `ui/Label.tsx` documents for `text-label-md`. */
function Meta({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 py-1 text-xs/[1.4] font-medium text-shell-ink lg:h-full lg:flex-col lg:items-start lg:justify-center lg:gap-0.5 lg:text-[14px]/[1.35]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Separates the matchup's three parts on a phone; from `lg` they stack instead. */
function MetaDivider() {
  return <span className="h-5 w-px shrink-0 bg-shell-line lg:hidden" />;
}

/** Lock and privacy copy: under a rule on a phone, a right-hand column from `lg`. */
function LockColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-shell-line pt-2 text-xs font-medium leading-[1.4] lg:w-[168px] lg:shrink-0 lg:border-t-0 lg:pt-0">
      {children}
    </div>
  );
}
