import { describe, expect, it } from "vitest";
import { FAVORITE_ANIMALS, isFavoriteAnimal } from "./animals";

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
