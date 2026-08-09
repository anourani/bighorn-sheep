import { afterEach, describe, expect, it } from "vitest";
import { arg, flag, isUuid, listArg } from "./lib";

/**
 * These pin the argv parsing for the rehearsal harness.
 *
 * `arg()` used to match only `--name=value`, while every documented invocation in
 * docs/dry-run.md and README.md used the space-separated form. So every flag was
 * silently dropped and both scripts ran on their defaults — `--phase kickoff`
 * became "final" (fabricating scores and running eliminations when the operator
 * asked only to lock picks), and `--winners kc,dal` became a coin flip. Nothing
 * errored, which is why it went unnoticed.
 */

const ORIGINAL_ARGV = process.argv;

function withArgv(args: string[]): void {
  // argv[0] is the node binary and argv[1] the script path; the parser scans the
  // whole array, so the prefix only needs to be realistic.
  process.argv = ["node", "script.ts", ...args];
}

afterEach(() => {
  process.argv = ORIGINAL_ARGV;
  delete process.env.PHASE;
  delete process.env.KICKOFF_IN;
  delete process.env.FORCE;
});

describe("arg", () => {
  it("reads the space-separated form", () => {
    withArgv(["--phase", "kickoff"]);
    expect(arg("phase", "final")).toBe("kickoff");
  });

  it("reads the equals form", () => {
    withArgv(["--phase=kickoff"]);
    expect(arg("phase", "final")).toBe("kickoff");
  });

  it("falls back to the default when absent", () => {
    withArgv([]);
    expect(arg("phase", "final")).toBe("final");
    expect(arg("phase")).toBeUndefined();
  });

  it("prefers argv over the environment variable", () => {
    process.env.PHASE = "final";
    withArgv(["--phase", "kickoff"]);
    expect(arg("phase", "final")).toBe("kickoff");
  });

  it("falls back to the environment variable before the default", () => {
    process.env.PHASE = "kickoff";
    withArgv([]);
    expect(arg("phase", "final")).toBe("kickoff");
  });

  it("maps a dashed flag name onto an underscored env var", () => {
    process.env.KICKOFF_IN = "30";
    withArgv([]);
    expect(arg("kickoff-in", "10")).toBe("30");
  });

  // Without this guard, `--phase --force` would report the phase as "--force" and
  // then throw on an unknown phase — an error that reads as a bug in the script
  // rather than a mistyped command.
  it("does not swallow a following flag as a value", () => {
    withArgv(["--phase", "--force"]);
    expect(arg("phase", "final")).toBe("final");
  });

  it("does not confuse a flag with one that shares its prefix", () => {
    withArgv(["--week-label", "wildcard"]);
    expect(arg("week", "1")).toBe("1");
  });

  it("keeps a value that merely contains a dash", () => {
    withArgv(["--group", "BIGHORN-7F3K"]);
    expect(arg("group")).toBe("BIGHORN-7F3K");
  });

  it("accepts an empty value in the equals form", () => {
    withArgv(["--group="]);
    expect(arg("group", "fallback")).toBe("");
  });
});

describe("flag", () => {
  it("detects a bare flag", () => {
    withArgv(["--force"]);
    expect(flag("force")).toBe(true);
  });

  it("is false when absent", () => {
    withArgv(["--week", "3"]);
    expect(flag("force")).toBe(false);
  });

  it("reads truthy environment values", () => {
    withArgv([]);
    process.env.FORCE = "1";
    expect(flag("force")).toBe(true);
    process.env.FORCE = "true";
    expect(flag("force")).toBe(true);
    process.env.FORCE = "no";
    expect(flag("force")).toBe(false);
  });
});

describe("listArg", () => {
  it("splits a comma list from either flag form", () => {
    withArgv(["--winners", "kc,dal,buf"]);
    expect(listArg("winners")).toEqual(["kc", "dal", "buf"]);
    withArgv(["--winners=kc,dal,buf"]);
    expect(listArg("winners")).toEqual(["kc", "dal", "buf"]);
  });

  it("trims and drops empties", () => {
    withArgv(["--winners", " kc , ,dal, "]);
    expect(listArg("winners")).toEqual(["kc", "dal"]);
  });

  it("is empty when the flag is absent", () => {
    withArgv([]);
    expect(listArg("winners")).toEqual([]);
  });
});

describe("isUuid", () => {
  it("accepts a uuid and rejects an invite code", () => {
    expect(isUuid("3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).toBe(true);
    expect(isUuid("BIGHORN-7F3K")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
