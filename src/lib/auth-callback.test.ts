import { describe, expect, it } from "vitest";
import { exchangeFailureReason, hasVerifierCookie, joinFailureReason } from "./auth-callback";

// What @supabase/ssr actually writes: `<storageKey>-code-verifier`, where the
// default storage key is `sb-<project-ref>-auth-token`.
const VERIFIER = "sb-abcdefghijklmnop-auth-token-code-verifier";
const SESSION = "sb-abcdefghijklmnop-auth-token";

describe("hasVerifierCookie", () => {
  it("finds the verifier among the other auth cookies", () => {
    expect(hasVerifierCookie([SESSION, VERIFIER, "NEXT_LOCALE"])).toBe(true);
  });

  it("is false when the jar has everything but the verifier", () => {
    expect(hasVerifierCookie([SESSION, "NEXT_LOCALE"])).toBe(false);
    expect(hasVerifierCookie([])).toBe(false);
  });

  it("does not mistake a chunked session cookie for the verifier", () => {
    expect(hasVerifierCookie([`${SESSION}.0`, `${SESSION}.1`])).toBe(false);
  });
});

describe("exchangeFailureReason", () => {
  // Verified against the installed @supabase/auth-js: it reads the verifier
  // from storage and throws AuthPKCECodeVerifierMissingError with this code
  // before it ever calls GoTrue.
  const VERIFIER_MISSING_ERROR = {
    name: "AuthPKCECodeVerifierMissingError",
    code: "pkce_code_verifier_not_found",
  };
  const FLOW_STATE_ERROR = { name: "AuthApiError", code: "flow_state_not_found" };

  // The reported bug: the link landed on a deploy permalink, so the verifier
  // cookie set on the real site was never sent. Nothing had expired.
  it("blames the origin when the verifier never arrived", () => {
    expect(exchangeFailureReason(VERIFIER_MISSING_ERROR, [SESSION])).toBe("verifier_missing");
  });

  it("blames the link when the verifier was present and it still failed", () => {
    expect(exchangeFailureReason(FLOW_STATE_ERROR, [SESSION, VERIFIER])).toBe("link_expired");
  });

  it("still catches a missing verifier if auth-js renames that error", () => {
    expect(exchangeFailureReason({ name: "AuthApiError", code: "something_new" }, [SESSION])).toBe(
      "verifier_missing",
    );
  });

  it("trusts the typed error even when the cookie is somehow still present", () => {
    expect(exchangeFailureReason(VERIFIER_MISSING_ERROR, [SESSION, VERIFIER])).toBe(
      "verifier_missing",
    );
  });

  it("does not fall over on an error with no code at all", () => {
    expect(exchangeFailureReason(null, [SESSION, VERIFIER])).toBe("link_expired");
    expect(exchangeFailureReason({}, [SESSION])).toBe("verifier_missing");
  });
});

describe("joinFailureReason", () => {
  it("maps the RPC's raised exceptions onto copy keys", () => {
    expect(joinFailureReason('unhandled exception: entry_closed')).toBe("entry_closed");
    expect(joinFailureReason('unhandled exception: invalid_code')).toBe("invalid_code");
  });

  it("falls back rather than leaking Postgres text to the URL", () => {
    expect(joinFailureReason('duplicate key value violates unique constraint "members_pkey"')).toBe(
      "join_failed",
    );
  });
});
