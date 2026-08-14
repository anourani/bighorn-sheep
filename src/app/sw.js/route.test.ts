import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * The service worker is assembled as a template string, so a stray backtick or
 * `${` in a comment silently produces a broken file — and a worker that fails to
 * parse takes the whole PWA down with no build error to warn you. These tests
 * are the guard rail: they parse what the route actually serves.
 */
describe("service worker route", () => {
  async function body(): Promise<string> {
    return await GET().text();
  }

  it("serves syntactically valid JavaScript", async () => {
    const source = await body();
    // Compiles (parses) without executing — `self` is never touched.
    expect(() => new Function(source)).not.toThrow();
  });

  it("stamps a version so each deploy is a real worker update", async () => {
    expect(await body()).toMatch(/const VERSION = "[^"]+"/);
  });

  it("never precaches HTML routes", async () => {
    const source = await body();
    const shell = source.match(/const SHELL = \[([\s\S]*?)\]/)?.[1] ?? "";
    expect(shell).toContain("/offline");
    // Caching app HTML is what lets a superseded build come back to life: the
    // markup names build-specific chunks that no longer exist on the server.
    for (const route of ['"/"', '"/app"', '"/app/standings"', '"/app/account"', '"/login"']) {
      expect(shell).not.toContain(route);
    }
  });

  it("only caches content-addressed assets", async () => {
    expect(await body()).toContain("/_next/static/");
  });

  it("stays out of the magic-link callback", async () => {
    // The emailed code is single-use. If the worker catches a failed navigation
    // to /auth/callback and answers with /offline, the sign-in is spent on a
    // page that cannot complete it and the next click reports a used-up link.
    expect(await body()).toContain('/auth/callback"');
  });

  it("is served as JavaScript at root scope, and revalidated", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("service-worker-allowed")).toBe("/");
    expect(res.headers.get("cache-control")).toContain("must-revalidate");
  });
});
