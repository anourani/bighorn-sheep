import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANIMAL_AVATARS, animalAvatarSrc, FAVORITE_ANIMALS, isFavoriteAnimal } from "./animals";

describe("FAVORITE_ANIMALS", () => {
  it("offers exactly ten animals", () => {
    expect(FAVORITE_ANIMALS).toHaveLength(10);
  });

  it("has no duplicates", () => {
    expect(new Set(FAVORITE_ANIMALS).size).toBe(FAVORITE_ANIMALS.length);
  });

  it("is alphabetical, because that is the order the select renders", () => {
    const sorted = [...FAVORITE_ANIMALS].sort((a, b) => a.localeCompare(b));
    expect([...FAVORITE_ANIMALS]).toEqual(sorted);
  });
});

describe("isFavoriteAnimal", () => {
  it("accepts every animal on the list", () => {
    for (const animal of FAVORITE_ANIMALS) expect(isFavoriteAnimal(animal)).toBe(true);
  });

  it("rejects an animal that is not on the list", () => {
    expect(isFavoriteAnimal("Wombat")).toBe(false);
  });

  // The value arrives from a <select> in a browser the server does not control,
  // so the action validates it rather than trusting the option list.
  it("is case-sensitive, so a client cannot smuggle a variant past the action", () => {
    expect(isFavoriteAnimal("koala")).toBe(false);
    expect(isFavoriteAnimal("KOALA")).toBe(false);
  });

  it("rejects non-strings, including the null used to clear the field", () => {
    expect(isFavoriteAnimal(null)).toBe(false);
    expect(isFavoriteAnimal(undefined)).toBe(false);
    expect(isFavoriteAnimal(7)).toBe(false);
    expect(isFavoriteAnimal("")).toBe(false);
  });
});

describe("ANIMAL_AVATARS", () => {
  // Trailing slash matters: without it the last segment is replaced, not appended.
  const PUBLIC_DIR = new URL("../../../public/", import.meta.url);
  const entries = Object.entries(ANIMAL_AVATARS) as [string, string][];

  it("maps only animals that are on the list", () => {
    const strays = entries.map(([animal]) => animal).filter((a) => !isFavoriteAnimal(a));
    expect(strays, "An animal renamed in FAVORITE_ANIMALS must be renamed here too.").toEqual([]);
  });

  it("serves every image from /icons/, the only path the service worker caches", () => {
    const misplaced = entries.filter(([, src]) => !src.startsWith("/icons/animals/"));
    expect(
      misplaced,
      "The service worker's runtime cache accepts only /_next/static/ and /icons/ " +
        "(src/app/sw.js/route.ts). Art outside /icons/ is refetched on every load and " +
        "missing offline, which nothing else in the app would report.",
    ).toEqual([]);
  });

  // The failure this catches is invisible at runtime: a missing file 404s, Avatar's
  // onError swaps in the initials mark, and the result is indistinguishable from a
  // player who never picked an animal. Nothing in the browser says anything is wrong.
  it("points at image files that actually exist in public/", () => {
    const missing = entries
      .filter(([, src]) => !existsSync(new URL(`.${src}`, PUBLIC_DIR)))
      .map(([animal, src]) => `${animal} → public${src}`);

    expect(
      missing,
      "Artwork is missing from public/icons/animals/. Add the PNG at the exact path " +
        "listed, or drop the animal from ANIMAL_AVATARS until its art is ready — an " +
        "unmapped animal falls back to initials on purpose.",
    ).toEqual([]);
  });
});

describe("animalAvatarSrc", () => {
  it("returns the artwork for an animal that has some", () => {
    expect(animalAvatarSrc("Bear")).toBe("/icons/animals/bear.png");
    expect(animalAvatarSrc("Cat")).toBe("/icons/animals/cat.png");
  });

  // The eight animals still waiting on art stay selectable; they just render the
  // initials mark. This is what makes shipping the rest additive.
  it("returns null for an animal whose art has not shipped yet", () => {
    const undrawn = FAVORITE_ANIMALS.filter((a) => !(a in ANIMAL_AVATARS));
    for (const animal of undrawn) expect(animalAvatarSrc(animal)).toBeNull();
  });

  it("returns null for unset, unknown, and non-string values", () => {
    expect(animalAvatarSrc(null)).toBeNull();
    expect(animalAvatarSrc(undefined)).toBeNull();
    expect(animalAvatarSrc("")).toBeNull();
    expect(animalAvatarSrc("Wombat")).toBeNull();
    expect(animalAvatarSrc("bear")).toBeNull();
  });
});
