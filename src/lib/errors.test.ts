import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

const FALLBACK = "Couldn't send the link. Try again.";

describe("errorMessage", () => {
  it('rejects the "{}" auth-js produces for every 5xx', () => {
    // auth-js short-circuits 5xx before parsing the body and sets
    // message = JSON.stringify(response), which is always "{}". It is truthy,
    // so `error.message || fallback` used to render it to the user verbatim.
    expect(errorMessage({ message: "{}" }, FALLBACK)).toBe(FALLBACK);
  });

  it("prefers a status-derived message over the generic fallback", () => {
    expect(errorMessage({ message: "{}", status: 500 }, FALLBACK)).toMatch(/having trouble/i);
    expect(errorMessage({ message: "{}", status: 429 }, FALLBACK)).toMatch(/too many/i);
  });

  it("passes real prose through", () => {
    expect(errorMessage({ message: "Email rate limit exceeded" }, FALLBACK)).toBe(
      "Email rate limit exceeded",
    );
  });

  it("falls through the alternate fields Supabase uses", () => {
    expect(errorMessage({ error_description: "Invalid login" }, FALLBACK)).toBe("Invalid login");
    expect(errorMessage({ msg: "Signups not allowed" }, FALLBACK)).toBe("Signups not allowed");
    expect(errorMessage({ error: "bad_request" }, FALLBACK)).toBe("bad_request");
  });

  it("rejects the other empty shapes", () => {
    for (const junk of ["", "   ", "[]", "null", "undefined"]) {
      expect(errorMessage({ message: junk }, FALLBACK)).toBe(FALLBACK);
    }
  });

  it("handles values that aren't error objects at all", () => {
    expect(errorMessage("Something specific", FALLBACK)).toBe("Something specific");
    expect(errorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(42, FALLBACK)).toBe(FALLBACK);
  });

  it("reads a real Error instance", () => {
    expect(errorMessage(new Error("boom"), FALLBACK)).toBe("boom");
  });
});
