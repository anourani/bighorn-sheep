"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/league/name";
import { animalAvatarSrc } from "@/lib/profile/animals";

/**
 * A player's avatar — the animal they picked on the account page, otherwise the
 * initials mark ("AN") in the brand circle.
 *
 * The animal is the *only* source of an avatar: there is no photo upload, so a
 * player changes how they appear by changing one <select>. Not in the standings
 * grid, which this used to claim and never did — that table has only ever drawn
 * a rank and a name, and the redesign's 146px name column has no room for one. Animals still waiting on artwork resolve to null and
 * render the initials mark, which is also what happens if the PNG fails to load —
 * a player is never rendered as a blank circle.
 *
 * The art sits on a neutral fill rather than the brand gradient: the PNGs are
 * transparent character art and several of them are warm-toned, which would
 * disappear into orange. Mirrors {@link TeamLogo}: a plain <img> and
 * `object-contain`, so nothing is cropped and next/image config stays unnecessary.
 */
export function Avatar({
  firstName,
  lastName,
  favoriteAnimal,
  size = 40,
  shape = "circle",
  className,
}: {
  firstName: string;
  lastName: string;
  /** One of FAVORITE_ANIMALS, or null when unset or no longer on the list. */
  favoriteAnimal: string | null;
  size?: number;
  /**
   * "square" is the account page's header portrait. The white ring is dropped
   * with it: it exists to lift a circle off a slate panel and only reads as a
   * halo on the white page.
   */
  shape?: "circle" | "square";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = initials(firstName, lastName);
  const round = shape === "circle" ? "rounded-full ring-2 ring-white/20" : "rounded-control";
  const src = animalAvatarSrc(favoriteAnimal);

  if (!src || failed) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn(
          "inline-grid shrink-0 place-items-center bg-brand-sheen font-semibold leading-none text-white",
          round,
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn("inline-block shrink-0 overflow-hidden bg-fill-soft", round, className)}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled /public asset; a plain img keeps next/image out of the picture entirely */}
      <img
        src={src}
        alt={`${label}, ${favoriteAnimal}`}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
        // Keeps the art clear of the ring without a percentage padding class,
        // which would resolve against the element's width and not its box.
        style={{ padding: Math.round(size * 0.06) }}
      />
    </span>
  );
}
