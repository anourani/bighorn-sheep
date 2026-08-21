import { Fragment } from "react";
import { cn } from "@/lib/cn";
import { BLUR_REVEAL_CLASS, revealDelay, splitWords } from "./blur-reveal";

/**
 * Reveals its content with the `blur-in` keyframe — opacity 0 -> 1,
 * blur(12px) -> blur(0), scale(1.04) -> scale(1) over 1250ms — one piece at a
 * time, 40ms apart.
 *
 * Two modes:
 *
 *   <BlurReveal text="Last Man Standing" start={2} />   // a word per span
 *   <BlurReveal start={13}><LocalTime … /></BlurReveal>  // one piece, unsplit
 *
 * `start` is the piece's index in the WHOLE cascade, not within this call, so
 * several of these across a module read as one wave. `cascadeStarts` in
 * `blur-reveal.ts` computes those indices; see its note on why they cannot come
 * from a counter incremented as each piece renders.
 *
 * DELIBERATELY NOT a client component. There are no hooks here, so it renders
 * inside the landing page's server tree and adds nothing at all to that route's
 * JS — the animation is pure CSS on server-rendered markup and starts at the
 * first paint, with no hydration to wait for. It still compiles into the client
 * bundle where a client component imports it, as `PickHero` does.
 *
 * The delay is an inline `animationDelay` rather than the `style={{ "--i": i }}`
 * custom property the effect is usually written with. `--i` needs an
 * `as React.CSSProperties` cast — TypeScript does not accept custom properties
 * on `CSSProperties` — and nothing in this repo sets an inline custom property
 * today (`Panel.tsx`'s `--hairline` is a Tailwind arbitrary-property class,
 * which cannot carry a per-element value). An inline declaration outranks the
 * `animation` shorthand the utility class applies, so the delay survives.
 */
export function BlurReveal({
  text,
  children,
  start = 0,
  replayKey,
  className,
}: {
  /** Split into one animated span per word. Omit and `children` is one piece. */
  text?: string;
  children?: React.ReactNode;
  /** This piece's first slot in the cascade — see `cascadeStarts`. */
  start?: number;
  /**
   * Change this to play the reveal again. CSS animations do not restart on
   * their own, so the value is used as a React `key` below and a new one
   * remounts the spans, which is what re-runs the animation from the top.
   *
   * It is applied HERE rather than at the call sites so that no consumer can
   * forget it — `PickHero` has a dozen of these and they all have to replay
   * together. Left undefined (the landing title) the content mounts once and
   * never replays.
   */
  replayKey?: string;
  className?: string;
}) {
  return (
    <Piece key={replayKey} text={text} start={start} className={className}>
      {children}
    </Piece>
  );
}

function Piece({
  text,
  children,
  start,
  className,
}: {
  text?: string;
  children?: React.ReactNode;
  start: number;
  className?: string;
}) {
  // One piece: the whole of `children` resolves together. This is how the team
  // logo and the two <LocalTime> elements join the cascade — LocalTime rewrites
  // its own text in an effect after hydration, so splitting it into words would
  // animate spans whose content is about to be replaced.
  if (text === undefined) {
    return (
      <span className={cls(className)} style={{ animationDelay: `${revealDelay(start)}ms` }}>
        {children}
      </span>
    );
  }

  const words = splitWords(text);
  return (
    <>
      {words.map((word, i) => (
        <Fragment key={`${i}-${word}`}>
          {/* A real whitespace text node BETWEEN the spans, never inside them.
              Inside, a trailing space on an inline-block collapses; omitted
              altogether, the words run together in the accessible name and in
              anything copied off the page — "LastManStanding". */}
          {i > 0 ? " " : null}
          <span
            className={cls(className)}
            style={{ animationDelay: `${revealDelay(start + i)}ms` }}
          >
            {word}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * `inline-block` is load-bearing and not decoration: `transform` and `filter`
 * have no effect on a non-replaced inline box, so a plain `<span>` would fade
 * and never blur or scale.
 *
 * It goes through `cn()` precisely BECAUSE a caller may need to override it —
 * the logo passes `block`. A plain concatenation leaves both tokens on the
 * element, and the winner is then decided by Tailwind's own source order rather
 * than by the class string: `inline-block` is emitted after `block`, so it wins
 * and the caller's override silently does nothing. That cost the logo 3px of
 * vertical centring, because an inline-block sits on a baseline and adds a
 * second line box's descender inside the `-translate-y-1/2` wrapper. Measured
 * against the unmodified component, not reasoned about.
 */
function cls(className?: string): string {
  return cn("inline-block", BLUR_REVEAL_CLASS, className);
}
