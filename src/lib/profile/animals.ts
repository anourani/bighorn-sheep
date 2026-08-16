/**
 * The favorite-animal picker on the account page.
 *
 * Ten storybook animals, kept as a code constant rather than a database check
 * constraint or an enum: adding an eleventh should be a one-line change, not a
 * migration run by hand against production (see CLAUDE.md — nothing in this repo
 * applies migrations automatically). The column is plain nullable text and
 * `updateFavoriteAnimal` validates against this list before writing.
 *
 * Order is alphabetical because it is the order the <select> renders in.
 */
export const FAVORITE_ANIMALS = [
  "Bear",
  "Cat",
  "Dog",
  "Duck",
  "Elephant",
  "Fox",
  "Giraffe",
  "Koala",
  "Lion",
  "Penguin",
] as const;

export type FavoriteAnimal = (typeof FAVORITE_ANIMALS)[number];

/**
 * Whether a value is one of the ten. Rows written before an animal was removed
 * from the list — or by hand in the SQL editor — will fail this, which is why
 * the UI treats an unrecognised stored value as "not set" rather than trying to
 * render it as a selected option.
 */
export function isFavoriteAnimal(value: unknown): value is FavoriteAnimal {
  return typeof value === "string" && (FAVORITE_ANIMALS as readonly string[]).includes(value);
}

/**
 * The artwork behind each animal — this is what a player's avatar actually is.
 * Choosing an animal on the account page is the only way to set one.
 *
 * `Partial`, not a full Record, and that is the point: an animal with no art yet
 * is simply absent, `animalAvatarSrc` returns null, and {@link Avatar} falls back
 * to the initials mark. Shipping the remaining animals is a PNG plus a line here,
 * with no change to any component, query or type.
 *
 * Paths must stay under `/icons/` — the service worker's runtime cache only
 * accepts `/_next/static/` and `/icons/` (src/app/sw.js/route.ts), so art
 * anywhere else would be refetched on every load and be missing offline.
 * `animals.test.ts` asserts both the prefix and that each file really exists,
 * because a wrong filename degrades to the initials mark and so looks exactly
 * like an animal that was never picked.
 */
export const ANIMAL_AVATARS: Partial<Record<FavoriteAnimal, string>> = {
  Bear: "/icons/animals/bear.png",
  Cat: "/icons/animals/cat.png",
  Dog: "/icons/animals/dog.png",
  Duck: "/icons/animals/duck.png",
  Elephant: "/icons/animals/elephant.png",
  Fox: "/icons/animals/fox.png",
  Koala: "/icons/animals/koala.png",
  Penguin: "/icons/animals/penguin.png",
};

/** The avatar image for an animal, or null when unset, unknown, or not yet drawn. */
export function animalAvatarSrc(animal: string | null | undefined): string | null {
  return isFavoriteAnimal(animal) ? (ANIMAL_AVATARS[animal] ?? null) : null;
}
