import { cn } from "@/lib/cn";
import { HeadcountGrid } from "@/components/app/HeadcountGrid";
import { championGridColumns } from "@/components/app/headcount-grid";
import { seasonLabels, type HeadcountChampionInput } from "@/lib/league/view";

/**
 * The headcount slot once the league has a confirmed winner: an orange "1"
 * tile, "We've crowned our champion.", the winner's name, and the week the
 * title was clinched over the league's cube field — one orange cube, every
 * other entry grey. PRD "Champion Headcount", variant 5b.
 *
 * `Headcount` renders this in its own place when `kind === "champion"`, so it
 * keeps that component's contract exactly: a Server Component, the section
 * root IS the card, and a host passes vertical spacing only — never `px-*`,
 * which would land inside the fill.
 *
 * Two layouts, turning over at `lg` as the rest of the app does. Below it the
 * card stacks: the name block, then a rule, then the stat line over the same
 * `HeadcountGrid` the tally card draws (16px cubes, the orphan rule and all).
 * From `lg` it is two equal columns, and the cube field is a plain CSS grid
 * that fills the right-hand one in two rows — see `championGridColumns` for
 * why that needs no measuring.
 */
export function ChampionHeadcount({
  champion,
  className,
}: {
  champion: HeadcountChampionInput;
  className?: string;
}) {
  const { winnerName, clinchedWeek, total, season } = champion;
  const labels = seasonLabels(season);
  const columns = championGridColumns(total);

  return (
    <section
      aria-label={`${winnerName}, champion of the ${labels.long} Last Man Standing. Clinched in Week ${clinchedWeek}. 1 of ${total} entries remaining.`}
      className={cn(
        "flex flex-col gap-3.5 rounded-control bg-fill-soft p-3",
        "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-0 lg:p-4",
        className,
      )}
    >
      <div className="flex items-stretch gap-3 lg:gap-4 lg:pr-6">
        {/* The tile takes its height from the text beside it — the row's own
            stretch — so it is always exactly three lines tall. */}
        <div
          aria-hidden
          className="relative w-[68px] shrink-0 rounded bg-accent lg:w-20"
        >
          <span className="absolute bottom-2 left-2.5 text-[32px] font-semibold leading-[0.8] tracking-[-1.5px] text-white lg:bottom-2.5 lg:left-3 lg:text-[40px]">
            1
          </span>
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="text-[13px] font-medium leading-[1.35] text-shell-mute lg:text-sm">
            We&apos;ve crowned our champion.
          </p>
          <h2 className="truncate text-[32px] font-semibold leading-none tracking-[-1px] text-black lg:text-[40px] lg:tracking-[-1.2px]">
            {winnerName}
          </h2>
          {/* One colour, no accent span. The phone takes the short season so
              the line holds together from 375px; the desktop has the room for
              both years in full. */}
          <p className="mt-1 text-[13px] font-medium leading-[1.35] text-shell-ink lg:text-sm">
            <span className="min-[375px]:whitespace-nowrap lg:hidden">
              Winner of the {labels.short} Last Man Standing.
            </span>
            <span className="hidden lg:inline">
              Winner of the {labels.long} Last Man Standing.
            </span>
          </p>
        </div>
      </div>

      {/* Desktop: the stat line over a cube field that fills the column, with
          `justify-between` so there is no slack above or below either. */}
      <div className="hidden min-w-0 flex-col justify-between gap-2 border-l border-shell-line pl-6 lg:flex">
        <ClinchedLine week={clinchedWeek} />
        <div
          role="img"
          aria-label={`1 of ${total} entries remaining`}
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn("aspect-square rounded-[2px]", i === 0 ? "bg-accent" : "bg-shell-line")}
            />
          ))}
        </div>
      </div>

      {/* Phone: under a rule, the same stat line over today's headcount grid
          with one entry standing — the winner — and everyone else out. */}
      <div className="flex flex-col gap-2.5 border-t border-shell-line pt-3 lg:hidden">
        <ClinchedLine week={clinchedWeek} />
        <div className="px-0.5">
          <HeadcountGrid
            headcount={{ kind: "season", week: clinchedWeek, alive: 1, eliminated: total - 1 }}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * "W6 CLINCHED". The abbreviation is drawn and the long form spoken — the
 * pattern `Headcount` uses for its own "W6" — because "W6" read aloud names
 * nothing.
 */
function ClinchedLine({ week }: { week: number }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className="text-[20px] font-semibold leading-none text-accent">
        <span aria-hidden>W{week}</span>
        <span className="sr-only">Week {week}</span>
      </span>
      <span className="text-[11px] font-semibold uppercase leading-none tracking-[0.06em] text-shell-mute lg:text-xs">
        Clinched
      </span>
    </p>
  );
}
