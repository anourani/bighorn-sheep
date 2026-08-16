import { LandingHeader } from "@/components/landing/LandingHeader";
import { StatusReport } from "@/components/app/StatusReport";
import { PublicStandings } from "@/components/landing/PublicStandings";
import { Label } from "@/components/ui/Label";
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

  return (
    // Deliberately no background class: this wrapper is transparent so the grid
    // in `AmbientBackground` shows through here exactly as it does on /app. It
    // used to paint `bg-bg` to sit over the old orange bloom; with the bloom
    // gone that only produced a flat column between two grid gutters on screens
    // wider than `max-w-shell`.
    <div className="mx-auto flex min-h-dvh max-w-shell flex-col">
      <LandingHeader />

      <main className="flex-1">
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
          <Label className="block text-base leading-[1.1] sm:leading-none">Welcome to</Label>
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
            Last Man Standing
          </h1>
        </section>

        {/* `align-items: flex-end` in the spec positions the block, not the text
            inside it — the copy stays left-aligned within its 339px, and takes
            the full width on a phone, where the design drops the right-hand
            offset entirely. Two paragraphs because the design colours the first
            sentence as primary ink and the rest as secondary — with "last man
            standing" lifted back to primary inside the second, which is the
            phrase the league is named for. The desktop mock splits the sentence
            on the same three spans but leaves them all grey; taking the mobile
            treatment at both sizes was the call. */}
        <section className="flex justify-end px-4 pb-14 sm:pb-10 sm:pt-4">
          {/* 18px on a phone, 16px once the block is offset to the right — the
              design sizes this copy up when it is the widest thing on screen.

              The `/[1.35]` shorthand rather than a separate `leading-[1.35]`:
              `text-*` sets a line-height of its own, and a `sm:`-prefixed one is
              emitted after any unprefixed `leading-*`, so the pair silently
              reverts to 1.5 from `sm` up. Binding both to one utility per
              breakpoint is the only form that cannot come apart. */}
          <div className="w-full text-lg/[1.35] sm:w-[339px] sm:text-base/[1.35]">
            <p className="text-shell-ink">A private NFL survivor league with friends.</p>
            <p className="text-shell-mute">
              Pick one team a week. Win to advance to the next week. Lose or tie and you&apos;re
              out. The <span className="text-shell-ink">last man standing</span> wins.
            </p>
          </div>
        </section>

        {board ? (
          <>
            {/* Still `px-4` at every width. The strip inside goes edge to edge
                below `lg` on its own, by cancelling this inset — the label above
                it stays put, which is the whole point of the mobile variant. */}
            <StatusReport status={board.status} className="px-4 pb-2 sm:py-3" />
            {/* The design drops the "League" eyebrow that used to sit here: the
                table follows the status report directly in both mock-ups. */}
            <section className="px-4 pb-10 sm:pt-5">
              <PublicStandings data={board} />
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
