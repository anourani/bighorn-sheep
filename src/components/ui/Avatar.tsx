"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/league/name";

/**
 * A player's avatar. Shows their uploaded sticker when set, otherwise the
 * initials mark ("AN") in the brand circle — the app's identity fallback. If the
 * image fails to load (offline, deleted) it degrades to the same initials, so a
 * player is never rendered as a blank circle. Mirrors {@link TeamLogo}: a plain
 * <img> avoids next/image remotePatterns config for the Supabase storage domain.
 */
export function Avatar({
  firstName,
  lastName,
  avatarUrl,
  size = 40,
  className,
}: {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = initials(firstName, lastName);

  if (!avatarUrl || failed) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn(
          "inline-grid shrink-0 place-items-center rounded-full bg-brand-sheen font-semibold leading-none text-white ring-2 ring-white/20",
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      >
        {label}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Supabase storage URL; a plain img avoids next/image remotePatterns config
    <img
      src={avatarUrl}
      alt={label}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full object-cover ring-2 ring-white/20", className)}
      style={{ width: size, height: size }}
    />
  );
}
