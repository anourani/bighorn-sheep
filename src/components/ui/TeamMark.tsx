import { cn } from "@/lib/cn";
import { getTeam, type TeamId } from "@/lib/nfl/teams";

/** Team color dot + abbreviation code, optionally with the nickname. */
export function TeamMark({
  teamId,
  showName = false,
  muted = false,
  className,
}: {
  teamId: TeamId;
  showName?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const team = getTeam(teamId);
  if (!team)
    return <span className={cn("text-sm font-semibold", className)}>{teamId.toUpperCase()}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn("h-2.5 w-2.5 rounded-full ring-1 ring-black/10", muted && "opacity-40")}
        style={{ backgroundColor: team.color }}
      />
      <span className={cn("text-sm font-semibold tracking-wide", muted && "opacity-70")}>
        {team.abbr}
      </span>
      {showName ? <span className="truncate text-sm opacity-80">{team.name}</span> : null}
    </span>
  );
}
