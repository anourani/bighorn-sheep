"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { getTeam, type TeamId } from "@/lib/nfl/teams";

const SIZES = { xs: 20, sm: 28, md: 36, lg: 48, xl: 56 } as const;

/**
 * ESPN team-logo CDN. Our `team.id` is the lowercase ESPN abbreviation, so it
 * maps straight onto the CDN path. Swapping to bundled `/public/logos/${id}.png`
 * later is a one-line change here.
 */
function logoUrl(id: TeamId): string {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${id}.png`;
}

/** Black or white text, whichever stays legible on a solid brand color. */
function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0B1220" : "#FFFFFF";
}

/**
 * A team's real logo, loaded from the ESPN CDN. If the image can't load
 * (offline, blocked, or missing) it degrades to a color-mark: a rounded square
 * in the team color with the team abbreviation — the same identity language as
 * {@link TeamMark}. Explicit width/height keep the fallback swap shift-free.
 */
export function TeamLogo({
  teamId,
  size = "md",
  className,
}: {
  teamId: TeamId;
  /** A named size token, or an explicit pixel size. */
  size?: keyof typeof SIZES | number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const team = getTeam(teamId);
  const px = typeof size === "number" ? size : SIZES[size];

  if (!team || failed) {
    const bg = team?.color ?? "#64748B";
    return (
      <span
        role="img"
        aria-label={team ? `${team.location} ${team.name}` : teamId.toUpperCase()}
        className={cn(
          "inline-grid shrink-0 place-items-center rounded-[6px] font-semibold leading-none ring-1 ring-black/10",
          className,
        )}
        style={{
          width: px,
          height: px,
          backgroundColor: bg,
          color: readableOn(bg),
          fontSize: Math.max(9, Math.round(px * 0.32)),
        }}
      >
        {team?.abbr ?? teamId.toUpperCase().slice(0, 3)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote CDN logo; a plain img avoids next/image remotePatterns config
    <img
      src={logoUrl(teamId)}
      alt={`${team.location} ${team.name}`}
      width={px}
      height={px}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: px, height: px }}
    />
  );
}
