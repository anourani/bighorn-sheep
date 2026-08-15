import { LandingHeader } from "@/components/landing/LandingHeader";
import { StatusReport } from "@/components/app/StatusReport";
import { PublicStandings } from "@/components/landing/PublicStandings";
import { Label } from "@/components/ui/Label";
import { loadPublicLeague } from "@/lib/league/load";

export const metadata = {
  title: "Last Man Standing — NFL Survival League",
  description:
    "A private, invite-only NFL survivor pool. Pick one team a week, win to survive, last one standing takes the season.",
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
    // `bg-bg`, not `bg-white`: this wrapper is opaque and paints over
    // `AmbientBackground`, so a literal white here would leave the landing page
    // the one screen that ignores the page colour.
    <div className="mx-auto flex min-h-dvh max-w-shell flex-col bg-bg">
      <LandingHeader />

      <main className="flex-1">
        {/* Both mock-ups now inset the title block by 16px, so the heading
            lines up with the brand name above it and the sections below rather
            than hanging left of everything. The top step is the mobile/desktop
            difference: 40px on a phone, 60px once there's room. There is no gap
            between eyebrow and heading in either — both are set `leading-none`,
            and the design stacks them flush. */}
        <section className="px-4 pb-5 pt-10 sm:pt-[60px]">
          <Label className="text-base">Welcome to</Label>
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
            sentence as primary ink and the rest as secondary. */}
        <section className="flex justify-end px-4 pb-4 sm:pt-4">
          <div className="w-full text-base leading-[1.35] sm:w-[339px]">
            <p className="text-shell-ink">A private NFL survivor pool with friends.</p>
            <p className="text-shell-mute">
              Pick one team a week. Win to survive, lose or tie and you&apos;re out. The last one
              standing takes the season.
            </p>
          </div>
        </section>

        {board ? (
          <>
            <StatusReport status={board.status} className="px-4 py-3" />
            <section className="flex flex-col gap-6 px-4 py-6">
              <Label className="text-base">League</Label>
              <PublicStandings data={board} />
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
