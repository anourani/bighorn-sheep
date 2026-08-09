import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Netlify deploys EVERY file in the functions directory as a function, and derives
 * the function's name from the filename. A name may only contain alphanumerics,
 * hyphens and underscores — so a single `poll-scores.test.ts` sitting next to the
 * real functions failed the entire deploy with:
 *
 *   Incorrect function names. Name should consist of only alphanumeric
 *   characters, hyphen & underscores
 *
 * It cost five failed deploys to spot, because the local build passes: `next build`
 * never looks in netlify/functions, and vitest is perfectly happy to run a test
 * from there. Nothing but Netlify itself objected.
 *
 * This test lives at netlify/function-names.test.ts — one level ABOVE the functions
 * directory, which is why it isn't caught by its own rule.
 */

const FUNCTIONS_DIR = new URL("./functions/", import.meta.url);

/** Netlify's rule: the name (filename minus extension) is [A-Za-z0-9_-]+ */
const VALID_NAME = /^[A-Za-z0-9_-]+$/;

function functionFiles(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
}

describe("netlify/functions", () => {
  it("contains only files whose names are legal Netlify function names", () => {
    const offenders = functionFiles().filter((file) => {
      const name = file.replace(/\.(ts|js|mts|mjs|cts|cjs)$/, "");
      return !VALID_NAME.test(name);
    });

    expect(
      offenders,
      "Every file in netlify/functions is deployed as a function, and its name may " +
        "only contain letters, numbers, hyphens and underscores. A dotted name like " +
        "`poll-scores.test.ts` fails the whole Netlify build. Move helpers and tests " +
        "into src/lib instead.",
    ).toEqual([]);
  });

  it("holds no test files at all", () => {
    // Belt and braces: a test file is the realistic way this rule gets broken, and
    // naming one `polltargets.test.ts` would satisfy the regex above while still
    // being deployed as a pointless function.
    const tests = functionFiles().filter((f) => /\.(test|spec)\./.test(f));
    expect(tests, "Tests for function logic belong in src/lib beside the pure code.").toEqual([]);
  });

  it("still contains the functions the app depends on", () => {
    // Guards against a rename or accidental deletion — load-schedule is the one-time
    // schedule loader, poll-scores the 5-minute scorer.
    const names = functionFiles().map((f) => f.replace(/\.[^.]+$/, ""));
    expect(names).toContain("load-schedule");
    expect(names).toContain("poll-scores");
  });
});
