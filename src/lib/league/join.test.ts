import { describe, expect, it } from "vitest";
import {
  JOIN_ERROR_COPY,
  JOIN_NOTICE_COPY,
  joinErrorCopy,
  joinNoticeCopy,
  normalizeInviteCode,
} from "./join";

describe("joinErrorCopy", () => {
  it("maps every reason the server action can return", () => {
    for (const reason of [
      "invalid_code",
      "entry_closed",
      "join_failed",
      "not_authenticated",
      "unexpected_error",
    ]) {
      expect(joinErrorCopy(reason)).toBe(JOIN_ERROR_COPY[reason]);
    }
  });

  it("falls back rather than rendering a bare reason code", () => {
    expect(joinErrorCopy("something_new")).toContain("Couldn't join");
    expect(joinErrorCopy("something_new")).not.toContain("something_new");
  });
});

describe("joinNoticeCopy", () => {
  it("maps every reason the auth callback can bounce back", () => {
    for (const reason of ["entry_closed", "invalid_code", "join_failed"]) {
      expect(joinNoticeCopy(reason)).toBe(JOIN_NOTICE_COPY[reason]);
    }
  });

  it("falls back rather than rendering a bare reason code", () => {
    expect(joinNoticeCopy("something_new")).toContain("couldn't add you");
    expect(joinNoticeCopy("something_new")).not.toContain("something_new");
  });

  // The whole reason this dictionary is separate from JOIN_ERROR_COPY: sign-in
  // has already succeeded by the time a notice fires, so copy telling someone to
  // sign in or to re-check a field they cannot see is worse than no copy.
  it("never tells an already-signed-in reader to try the code again", () => {
    expect(JOIN_NOTICE_COPY.entry_closed).not.toBe(JOIN_ERROR_COPY.entry_closed);
    expect(JOIN_NOTICE_COPY.invalid_code).not.toBe(JOIN_ERROR_COPY.invalid_code);
  });

  it("says sign-in worked before it says the join didn't", () => {
    for (const reason of ["entry_closed", "invalid_code", "join_failed"]) {
      expect(JOIN_NOTICE_COPY[reason]).toMatch(/^You're signed in, but/);
    }
  });
});

describe("normalizeInviteCode", () => {
  it("accepts the codes create_group generates", () => {
    expect(normalizeInviteCode("A1B2C3D4")).toBe("A1B2C3D4");
  });

  it("trims, and accepts older mixed-case and hyphenated codes", () => {
    expect(normalizeInviteCode("  bighorn-26  ")).toBe("bighorn-26");
  });

  it("rejects empty and absent values", () => {
    expect(normalizeInviteCode(null)).toBeNull();
    expect(normalizeInviteCode(undefined)).toBeNull();
    expect(normalizeInviteCode("")).toBeNull();
    expect(normalizeInviteCode("   ")).toBeNull();
  });

  it("rejects anything that could carry meaning into a redirect", () => {
    expect(normalizeInviteCode("../../etc/passwd")).toBeNull();
    expect(normalizeInviteCode("https://evil.example")).toBeNull();
    expect(normalizeInviteCode("A1B2 C3D4")).toBeNull();
    expect(normalizeInviteCode("<script>")).toBeNull();
  });

  it("rejects a code long enough to be a payload rather than a code", () => {
    expect(normalizeInviteCode("A".repeat(32))).toBe("A".repeat(32));
    expect(normalizeInviteCode("A".repeat(33))).toBeNull();
  });
});
