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
    // Deliberately no background class: this wrapper is transparent so the grid
    // in `AmbientBackground` shows through here exactly as it does on /app. It
    // used to paint `bg-bg` to sit over the old orange bloom; with the bloom
    // gone that only produced a flat column between two grid gutters on screens
    // wider than `max-w-shell`.
    <div className="mx-auto flex min-h-dvh max-w-shell flex-col">
      <LandingHeader />

      <main className="flex-1">
        {/* The design gives the title block no horizontal padding, so the
            heading hangs left of the brand name above it. Transcribed as given;
            `px-4` here and on the description is the fix if it reads as a slip
            in the browser rather than intent. */}
        <section className="pb-5 pt-[60px]">
          <Label className="text-base">Welcome to</Label>
          {/*
            88px at full width. An arbitrary clamp rather than a new
            `display-*` fontSize token on purpose: tailwind-merge classifies
            `text-display-*` as a colour and silently drops it whenever a
            `cn()` call also passes one — the bug documented in Label.tsx. With
            one call site a token buys nothing and carries that risk.
            5.5rem = 88px, reached at ~978px; −2px ÷ 88px = −0.023em, so the
            tracking scales with the size instead of crushing the mobile step.
          */}
          <h1 className="mt-2 text-[clamp(2.5rem,9vw,5.5rem)] font-semibold leading-none tracking-[-0.023em] text-black">
            Last Man Standing
          </h1>
        </section>

        {/* `align-items: flex-end` in the spec positions the block, not the text
            inside it — the paragraph stays left-aligned within its 436px. */}
        <section className="flex justify-end pb-4">
          <p className="max-w-[436px] text-base leading-[1.25] text-shell-mute">
            A private NFL survivor pool with friends. Pick one team a week. Win to survive, lose
            or tie and you&apos;re out. The last one standing takes the season.
          </p>
        </section>

        {board ? (
          <>
            <StatusReport status={board.status} className="px-4 py-5" />
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
