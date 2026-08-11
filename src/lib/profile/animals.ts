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
