import { LandingHeader } from "@/components/landing/LandingHeader";
import { LeaguePitch } from "@/components/landing/LeaguePitch";
import { BlurReveal } from "@/components/ui/BlurReveal";
import { BLUR_REVEAL_CLASS, blockStarts, wordCount } from "@/components/ui/blur-reveal";
import { Headcount } from "@/components/app/Headcount";
import { PublicStandings } from "@/components/landing/PublicStandings";
import { Label } from "@/components/ui/Label";
import { cn } from "@/lib/cn";
import { loadPublicLeague } from "@/lib/league/load";

export const metadata = {
  title: "Last Man Standing — NFL Survival League",
  description:
    "A private, invite-only NFL survivor league. Pick one team a week, win to advance, and the last man standing wins.",
};

/**
 * ISR rather than `force-dynamic`: this page reads no cookies and no headers,
 * so it caches — one database read a minute regardless of traffic, and
 * middleware still runs per-request, so a signed-in visitor is still redirected
 * to /app and never sees the cached HTML.
 *
 * The staleness is bounded and one-directional. Picks were filtered by SQL at
 * fetch time, so a clock up to 60s behind can only leave a padlock on a pick
 * that has just unlocked — never reveal one early.
 */
export const revalidate = 60;

/** The title's two lines, hoisted so their word count is taken from the text
 *  that actually renders and cannot drift from it. */
const EYEBROW = "Welcome to";
const HEADLINE = "Last Man Standing";

/**
 * How long the page holds still before anything moves.
 *
 * It is a real cost — for one second a visitor sees the header and an empty
 * column — and it is deliberate: the pause is what makes the title read as
 * arriving rather than as having always been there. Everything below is timed
 * off it, so this single number shifts the whole page.
 */
const LEAD_MS = 1000;

/**
 * The public landing page (the canonical root). Signed-in visitors are
 * redirected to /app by middleware; everyone else gets the league's current
 * standing plus the two ways in.
 *
 * `loadPublicLeague()` is total — null covers "Supabase unconfigured",
 * "migration 0009 not applied" and "no league published" alike. All three drop
 * the status and standings sections and keep the header, title and description,
 * so the invite path still works and the page reads as deliberate rather than
 * broken. That is also the state this ships in, before the publish row is
 * inserted by hand.
 */
export default async function LandingPage() {
  const league = await loadPublicLeague();
  // No members means an empty band and a headers-only table — both read as
  // broken, so treat it the same as no league at all.
  const board = league && league.members.length > 0 ? league : null;

  /* The page arrives one block at a time: the title holds for `LEAD_MS`, then
     each block below waits for the one above it to land and half a second more.
     `blockStarts` does that arithmetic — see its note on why "land" is measured
     from the easing's 98% point rather than the animation's formal end.

     The title is the only block that cascades internally; the other two are
     one piece each, so each resolves as a whole. Three blocks, not four: the
     headcount and the standings table animate together. When no league is
     published `board` is null and the third never renders — its start is
     computed anyway, and costs nothing.

     The `= 0` defaults are unreachable (`blockStarts` returns one entry per
     count) and satisfy `noUncheckedIndexedAccess`. */
  const [titleAt = 0, copyAt = 0, boardAt = 0] = blockStarts(
    [wordCount(EYEBROW) + wordCount(HEADLINE), 1, 1],
    LEAD_MS,
  );

  return (
    // Deliberately no background class: this wrapper is transparent so the grid
    // in `AmbientBackground` shows through here exactly as it does on /app. It
    // used to paint `bg-bg` to sit over the old orange bloom; with the bloom
    // gone that only produced a flat column between two grid gutters on screens
    // wider than `max-w-shell`.
    <div className="mx-auto flex min-h-dvh max-w-shell flex-col">
      <LandingHeader />

      {/* `overflow-x: clip` guards the reveal, not the layout. `blur-in` starts
          on `transform: scale(1.04)`, and below `lg` both the headcount grid and
          the standings Panel already reach the viewport edges by cancelling
          their host's `px-4` with `-mx-4` — so their block scales past the
          viewport and the page grows a horizontal scrollbar for the length of
          the animation.

          IT ONLY HAPPENS WHERE THE SCROLLBAR IS AN OVERLAY, i.e. on the phones
          this full-bleed exists for. `html` carries `scrollbar-gutter: stable`,
          so on a classic-scrollbar desktop the reserved 15px is wider than the
          4% the block grows by and swallows it whole. Measured at 393px, with
          this class removed: mobile emulation overflows the document by 9px
          (the block draws 408.72px and its right edge lands at 400.86), while
          the same page on the desktop profile overflows by 0. So checking this
          in a desktop browser proves nothing, and the obvious conclusion there
          — that the class does nothing — is wrong.

          `clip` rather than `hidden` on purpose: `hidden` would make this a
          scroll container, which is the one thing that would break the
          `position: sticky` cells inside StandingsGrid's own horizontal
          scroller. `clip` clips without scrolling, so their scrollport is
          untouched. What gets clipped is a blurred, near-transparent edge
          mid-animation; the settled page is 1:1. */}
      <main className="flex-1 overflow-x-clip">
        {/* Both mock-ups now inset the title block by 16px, so the heading
            lines up with the brand name above it and the sections below rather
            than hanging left of everything. Both steps are mobile/desktop
            differences: 40/60px above, 24/32px below. There is no gap between
            eyebrow and heading in either — the design stacks them flush, and
            the only thing separating them is the eyebrow's own line box. */}
        <section className="px-4 pb-6 pt-10 sm:pb-8 sm:pt-[60px]">
          {/* `block` is load-bearing, not decoration: `Label` renders a bare
              `span`, and an inline box takes its height from the parent's strut
              — 16px x the inherited 1.5 = 24px — so its own `leading` is simply
              ignored and the title block sits 8px taller than the design. As a
              block it sets its own line box, which is the other half of this:
              1.1 on a phone (18px), `leading-none` on desktop (16px). */}
          {/* The eyebrow and the heading are ONE cascade, not two: five words a
              `BLUR_STEP_MS` apart, so "Welcome to" has not finished resolving
              before "Last" begins. The heading's first word simply takes the
              slot after the eyebrow's last, which is all either element needs to
              know about the other. Both carry the same `delayMs`, so the whole
              title moves together when `LEAD_MS` changes.

              Nothing replays here. The text is a literal and the page is static,
              so this runs once, off server-rendered markup, and `BlurReveal`
              itself adds no JS to the route. */}
          <Label className="block text-base leading-[1.1] sm:leading-none">
            <BlurReveal text={EYEBROW} start={0} delayMs={titleAt} />
          </Label>
          {/*
            64px on a phone (H1 MOBILE), 88px at the shell's full width (H1
            Desktop). An arbitrary clamp rather than a new `display-*` fontSize
            token on purpose: tailwind-merge classifies `text-display-*` as a
            colour and silently drops it whenever a `cn()` call also passes one
            — the bug documented in Label.tsx. With one call site a token buys
            nothing and carries that risk.

            The ramp is anchored on the two mock widths: 3rem + 4vw is 63.7px at
            393px and exactly 88px at 1000px, where `max-w-shell` caps the
            column and the size should stop growing. The 3.5rem floor only
            engages below ~360px, so narrow phones shed a little rather than
            overflowing "Standing".

            Tracking is a flat −2px, not the −0.023em it used to be: the design
            specifies −2px at both 64px and 88px, so it does not scale.
          */}
          <h1 className="text-[clamp(3.5rem,3rem_+_4vw,5.5rem)] font-semibold leading-none tracking-[-2px] text-black">
            <BlurReveal text={HEADLINE} start={wordCount(EYEBROW)} delayMs={titleAt} />
          </h1>
        </section>

        {/* `align-items: flex-end` in the spec positions the block, not the text
            inside it — the copy stays left-aligned within its 339px, and takes
            the full width on a phone, where the design drops the right-hand
            offset entirely.

            The copy itself is `LeaguePitch`, shared verbatim with the login
            hero: three paragraphs in the design's ink / mute / mute-with-an-ink
            span, and no geometry of its own — that is this wrapper's job, and
            it is the only thing the two heroes disagree about. */}
        <section className="flex justify-end px-4 pb-14 sm:pb-10 sm:pt-4">
          {/* 18px on a phone, 16px once the block is offset to the right — the
              design sizes this copy up when it is the widest thing on screen.

              The `/[1.35]` shorthand rather than a separate `leading-[1.35]`:
              `text-*` sets a line-height of its own, and a `sm:`-prefixed one is
              emitted after any unprefixed `leading-*`, so the pair silently
              reverts to 1.5 from `sm` up. Binding both to one utility per
              breakpoint is the only form that cannot come apart. */}
          {/* The reveal goes on THIS div and not on the section around it. That
              section is `flex justify-end`, i.e. full width, and `scale(1.04)`
              about a full-width box's centre would swing right-aligned copy
              sideways as it settles; about a 339px box it barely moves. Same
              reason the headcount and the standings below carry it on the
              element that holds their content rather than on a wrapper. */}
          <div
            className={cn(
              "w-full text-lg/[1.35] sm:w-[339px] sm:text-base/[1.35]",
              BLUR_REVEAL_CLASS,
            )}
            style={{ animationDelay: `${copyAt}ms` }}
          >
            <LeaguePitch />
          </div>
        </section>

        {board ? (
          /* The headcount and the table are ONE block of the sequence, not
             two. They are one thought — the week's tally and the board that
             tally is read off — and revealing them apart made the grid look
             like it belonged to the description above it. It also cost 1.2s: as
             separate blocks the page did not finish until 5.93s.

             Hence a wrapper rather than the fragment that was here. It also
             does the job the headcount section cannot do for itself: `Headcount`
             is shared with the signed-in standings page and takes only
             `headcount` and `className`, and widening a shared component's props for one
             host's animation is the wrong trade when a block box does the same
             job. The wrapper must stay full-width and padding-free — both
             children bleed with `-mx-4` against the `px-4` on their own
             sections, and a wrapper that inset or shrank either one would
             break that. */
          <div className={BLUR_REVEAL_CLASS} style={{ animationDelay: `${boardAt}ms` }}>
            {/* Still `px-4` at every width. The grid inside goes edge to edge
                below `lg` on its own, by cancelling this inset — the label above
                it stays put, which is the whole point of the mobile variant. */}
            <Headcount headcount={board.headcount} className="px-4 pb-2 sm:py-3" />
            {/* The design drops the "League" eyebrow that used to sit here: the
                table follows the headcount directly in both mock-ups. */}
            {/* 200px, and it is measured from the PADLOCK NOTE rather than from
                the table — `PublicStandings` renders that note and
                `StandingsGrid` renders its own result legend, both as
                `space-y-2` siblings *below* the Panel. So the table's bottom
                border actually sits 248.5px off the foot of the document
                (8 + 16.5 legend, 8 + 16 note, then this), and anyone measuring
                to the table will not find this number. An arbitrary value
                because the scale has no 200px step — 48 is 192 and 52 is 208 —
                and the eyebrow above already spells its 60px the same way.

                It is a floor, not a guarantee: the wrapper is `min-h-dvh` with
                `main` on `flex-1`, so on a viewport taller than the page main
                absorbs the slack and the real gap is larger. With a populated
                table the page outgrows the viewport and this is what shows. */}
            <section className="px-4 pb-[200px] sm:pt-5">
              <PublicStandings data={board} />
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
