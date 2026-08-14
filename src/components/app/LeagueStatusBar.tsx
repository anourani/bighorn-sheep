import { loadLeague } from "@/lib/league/load";
import { statusLine, survivorCounts, type StatusLineInput } from "@/lib/league/view";
import { countdown } from "@/lib/time";

/**
 * The league's standing right now: the week, a survivors/deaths tally, and a
 * proportional strip of one cell per member (grey = eliminated, orange = alive).
 * Pre-season shows a countdown to kickoff and who has joined so far.
 *
 * This is page content, not chrome, which is the whole point of it living here
 * instead of in `AppHeader`. Two consequences fall out of the move: it scrolls
 * away instead of holding a quarter of a phone screen, and it is *fresher* —
 * Next preserves layouts across sibling-route navigation, so in the header its
 * week and countdown held their values until a full page load, whereas a page
 * component re-renders on every tab switch.
 *
 * Shape: this async wrapper takes no props and calls the request-memoized
 * `loadLeague()`, so each `page.tsx` is a one-liner and the account page — which
 * has no `LeagueData` to hand down — works identically at zero extra cost
 * (`AppHeader` already calls `loadLeague()` on every /app request).
 * {@link LeagueStatusBarView} beside it takes plain props, which is what makes
 * the whole thing renderable in a fixture harness with no database.
 */
export async function LeagueStatusBar() {
  const load = await loadLeague();
  if (load.kind !== "ok") return null;

  const { group, members, currentWeek, phase, nowIso } = load.data;

  if (phase === "preseason") {
    // Computed server-side and deliberately not ticking — see load.ts:335-337.
    const startsIn = countdown(new Date(group.entryClosesAt), new Date(nowIso));
    return (
      <LeagueStatusBarView status={{ kind: "preseason", joined: members.length, startsIn: startsIn.label }} />
    );
  }

  const { alive, eliminated } = survivorCounts(members);
  return <LeagueStatusBarView status={{ kind: "season", week: currentWeek, alive, eliminated }} />;
}

/**
 * The bar itself, from plain data. Everything it renders — both lines of copy
 * and both cell counts — derives from the one `status` union, so a fixture is a
 * single object and the two variants cannot drift apart.
 */
export function LeagueStatusBarView({ status }: { status: StatusLineInput }) {
  const { lead, primary, secondary } = statusLine(status);

  const eliminated = status.kind === "season" ? status.eliminated : 0;
  const alive = status.kind === "season" ? status.alive : status.joined;
  const stripLabel =
    status.kind === "season"
      ? `${alive} of ${alive + eliminated} players still alive, ${eliminated} eliminated`
      : `${alive} players joined, all alive`;

  /*
    Full-bleed by negative margin. `main` is `flex-1 px-4 pb-28 pt-5`
    (src/app/app/layout.tsx:15) and this is its first child, so without this it
    would sit 16px in, 20px down, and its border would stop short of the shell's
    edges. -mx-4 puts the edges exactly on the shell's (main's content box is
    968px inside a 1000px border box), -mt-5 cancels the top padding so the bar
    meets the header, and mb-5 gives it back to whatever follows.

    That is an implicit dependency on main's exact padding — hence naming it
    here. Stripping main's padding and pushing it into the pages looks cleaner
    but is 6+ files rather than 3 (main also renders app/error.tsx, and
    NoLeagueState has no horizontal padding of its own), and it would establish
    an invariant the next route added will silently violate.
  */
  return (
    <div className="-mx-4 -mt-5 mb-5 flex items-center gap-6 border-b border-shell-line px-4 py-2">
      <div className="flex shrink-0 flex-col gap-1">
        <span className="text-sm font-medium leading-[1.2] text-shell-ink">{lead}</span>
        <div className="flex gap-1.5 whitespace-nowrap text-sm font-medium leading-[1.2]">
          {/* The design gives this #000000 while the line above it is #1E1E1E —
              two near-identical blacks 8px apart, almost certainly unintentional.
              Transcribed as given and flagged, per this repo's habit of noting
              spec oddities rather than silently normalising them. */}
          <span className="text-black">{primary}</span>
          <span className="text-shell-soft">{secondary}</span>
        </div>
      </div>

      {/*
        One cell per member, eliminated first. Known limit, pre-existing and
        deliberately not fixed here: given px-4, gap-6, a ~160px text block and
        2px gaps, cells fall below 1 CSS pixel at roughly 59 members at 390px
        (262 at 1000px), and past ~87 on a phone the gaps consume the whole
        track. The fix, recorded so it isn't re-derived: a pure
        `survivorStrip(alive, eliminated, { maxCells })` in view.ts returning
        per-member cells below a ~48 threshold and a two-segment proportional bar
        above it, which preserves the ratio — the only information left at 1px.
      */}
      <div className="flex flex-1 items-center gap-0.5" role="img" aria-label={stripLabel}>
        {Array.from({ length: eliminated }).map((_, i) => (
          <span key={`out-${i}`} className="h-10 min-w-0 flex-1 rounded-[2px] bg-shell-line" />
        ))}
        {Array.from({ length: alive }).map((_, i) => (
          <span key={`alive-${i}`} className="h-10 min-w-0 flex-1 rounded-[2px] bg-shell-alive" />
        ))}
      </div>
    </div>
  );
}
