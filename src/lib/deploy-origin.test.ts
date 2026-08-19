import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalNetlifyHost,
  canonicalNetlifyUrl,
  canonicalOrigin,
  publicOrigin,
} from "./deploy-origin";

const SITE = "bighorn-sheep.netlify.app";
const DEPLOY_ID = "6a7f9b1f91786e00086f40d4";
const PERMALINK = `${DEPLOY_ID}--${SITE}`;
const DOMAIN = "https://sheepwithglasses.com";

// `canonicalOrigin` defaults to `process.env.NEXT_PUBLIC_APP_URL`, which Next
// inlines at build time but which is a real runtime read under vitest. Clearing
// it keeps every case that omits the argument meaning "the variable is unset" —
// which is the deliberate state outside production — rather than depending on
// whoever's shell is running the suite.
const REAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});
afterEach(() => {
  if (REAL_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = REAL_APP_URL;
});

describe("canonicalNetlifyHost", () => {
  it("resolves a deploy permalink to the site it is a snapshot of", () => {
    expect(canonicalNetlifyHost(PERMALINK)).toBe(SITE);
  });

  it("leaves the canonical host alone", () => {
    expect(canonicalNetlifyHost(SITE)).toBeNull();
  });

  it("never matches its own output, so a redirect cannot loop", () => {
    const once = canonicalNetlifyHost(PERMALINK);
    expect(once).not.toBeNull();
    expect(canonicalNetlifyHost(once!)).toBeNull();
  });

  // The whole point of keying on the 24-char hex id. Previews and branch
  // deploys share the `--` shape but are real, separate origins: sign-in there
  // stores its verifier cookie on that host, so redirecting away would break
  // the exchange rather than repair it.
  it("leaves deploy previews and branch deploys alone", () => {
    expect(canonicalNetlifyHost(`deploy-preview-12--${SITE}`)).toBeNull();
    expect(canonicalNetlifyHost(`main--${SITE}`)).toBeNull();
    expect(canonicalNetlifyHost(`claude-email-signup--${SITE}`)).toBeNull();
  });

  it("ignores hosts that aren't Netlify", () => {
    expect(canonicalNetlifyHost("localhost:3000")).toBeNull();
    expect(canonicalNetlifyHost("lastmanstanding.example.com")).toBeNull();
    expect(canonicalNetlifyHost(`${DEPLOY_ID}--bighorn-sheep.example.com`)).toBeNull();
  });

  it("wants the full 24 characters, and only hex", () => {
    expect(canonicalNetlifyHost(`6a7f9b1f--${SITE}`)).toBeNull();
    expect(canonicalNetlifyHost(`zzzzzzzzzzzzzzzzzzzzzzzz--${SITE}`)).toBeNull();
  });

  it("keeps a site name that itself contains a double hyphen", () => {
    expect(canonicalNetlifyHost(`${DEPLOY_ID}--my--site.netlify.app`)).toBe("my--site.netlify.app");
  });
});

describe("publicOrigin", () => {
  // The confirmed bug: the browser was on production, the emailed link pointed
  // at production, and the visitor still landed on the permalink — because the
  // callback built its redirect from the host the Netlify function saw.
  it("never hands back a deploy-permalink origin", () => {
    expect(publicOrigin(new URL(`https://${PERMALINK}/auth/callback?code=abc`))).toBe(
      `https://${SITE}`,
    );
  });

  it("leaves an already-correct origin alone", () => {
    expect(publicOrigin(new URL(`https://${SITE}/auth/callback?code=abc`))).toBe(`https://${SITE}`);
  });

  it("keeps localhost usable in development, port and all", () => {
    expect(publicOrigin(new URL("http://localhost:3000/auth/callback"))).toBe(
      "http://localhost:3000",
    );
  });

  // Previews and branch deploys are real origins holding their own cookies;
  // rewriting them would break sign-in there rather than repair it.
  it("leaves previews and branch deploys on their own origin", () => {
    expect(publicOrigin(new URL(`https://deploy-preview-12--${SITE}/auth/callback`))).toBe(
      `https://deploy-preview-12--${SITE}`,
    );
    expect(publicOrigin(new URL(`https://main--${SITE}/auth/callback`))).toBe(`https://main--${SITE}`);
  });

  it("ignores the path and query entirely", () => {
    expect(publicOrigin(new URL(`https://${PERMALINK}/app?next=%2Fapp&invite=WOLF7`))).toBe(
      `https://${SITE}`,
    );
  });
});

describe("canonicalNetlifyUrl", () => {
  it("carries the code and the invite across to the real site", () => {
    const url = new URL(`https://${PERMALINK}/auth/callback?code=abc123&next=/app&invite=WOLF7`);
    expect(canonicalNetlifyUrl(url)?.toString()).toBe(
      `https://${SITE}/auth/callback?code=abc123&next=/app&invite=WOLF7`,
    );
  });

  // GoTrue's Site-URL fallback drops everything but `code`, and drops the path
  // too — this is the shape the reported bug actually arrived in.
  it("handles the bare fallback shape, code only at the root", () => {
    const url = new URL(`https://${PERMALINK}/?code=abc123`);
    expect(canonicalNetlifyUrl(url)?.toString()).toBe(`https://${SITE}/?code=abc123`);
  });

  it("returns null when there is nothing to correct", () => {
    expect(canonicalNetlifyUrl(new URL(`https://${SITE}/auth/callback?code=abc123`))).toBeNull();
    expect(canonicalNetlifyUrl(new URL("http://localhost:3000/auth/callback?code=abc"))).toBeNull();
  });

  it("does not mutate the URL it was given", () => {
    const url = new URL(`https://${PERMALINK}/?code=abc123`);
    canonicalNetlifyUrl(url);
    expect(url.host).toBe(PERMALINK);
  });
});

describe("canonicalOrigin", () => {
  it("sends a permalink to the custom domain when the site knows its own", () => {
    expect(canonicalOrigin(PERMALINK, DOMAIN)).toBe(DOMAIN);
  });

  // The deliberate state outside production: previews and branch deploys leave
  // NEXT_PUBLIC_APP_URL blank, and their permalinks belong on netlify.app.
  it("falls back to the netlify host when the variable is blank", () => {
    expect(canonicalOrigin(PERMALINK, undefined)).toBe(`https://${SITE}`);
    expect(canonicalOrigin(PERMALINK, "")).toBe(`https://${SITE}`);
    expect(canonicalOrigin(PERMALINK, "   ")).toBe(`https://${SITE}`);
  });

  // A trailing slash or a stray path in the dashboard must not reach the
  // redirect — `/login` appended to `…com/app` would 404.
  it("takes the origin only, ignoring any path or trailing slash", () => {
    expect(canonicalOrigin(PERMALINK, `${DOMAIN}/`)).toBe(DOMAIN);
    expect(canonicalOrigin(PERMALINK, `${DOMAIN}/app`)).toBe(DOMAIN);
    expect(canonicalOrigin(PERMALINK, `${DOMAIN}/app?x=1#y`)).toBe(DOMAIN);
  });

  it("survives a malformed variable rather than taking sign-in down", () => {
    expect(canonicalOrigin(PERMALINK, "not a url")).toBe(`https://${SITE}`);
    expect(canonicalOrigin(PERMALINK, "sheepwithglasses.com")).toBe(`https://${SITE}`);
  });

  // canonicalNetlifyHost never matches its own output; this inherits that only
  // by refusing a permalink-shaped override, so a redirect cannot loop.
  it("refuses an override that is itself a permalink", () => {
    expect(canonicalOrigin(PERMALINK, `https://${PERMALINK}`)).toBe(`https://${SITE}`);
    const once = canonicalOrigin(PERMALINK, DOMAIN);
    expect(canonicalOrigin(new URL(once!).host, DOMAIN)).toBeNull();
  });

  // The regression that matters most. A preview is its own origin holding its
  // own verifier cookie; rewriting it to production would break sign-in there.
  it("leaves everything that is not a permalink alone, even with a domain set", () => {
    expect(canonicalOrigin(SITE, DOMAIN)).toBeNull();
    expect(canonicalOrigin(`deploy-preview-12--${SITE}`, DOMAIN)).toBeNull();
    expect(canonicalOrigin(`main--${SITE}`, DOMAIN)).toBeNull();
    expect(canonicalOrigin("localhost:3000", DOMAIN)).toBeNull();
    expect(canonicalOrigin("sheepwithglasses.com", DOMAIN)).toBeNull();
  });

  it("reads NEXT_PUBLIC_APP_URL when no override is passed", () => {
    process.env.NEXT_PUBLIC_APP_URL = DOMAIN;
    expect(canonicalOrigin(PERMALINK)).toBe(DOMAIN);
  });
});

describe("publicOrigin with a custom domain", () => {
  it("hands back the custom domain for a permalink", () => {
    expect(publicOrigin(new URL(`https://${PERMALINK}/auth/callback?code=abc`), DOMAIN)).toBe(
      DOMAIN,
    );
  });

  it("still leaves previews, branch deploys and localhost on their own origin", () => {
    expect(publicOrigin(new URL(`https://deploy-preview-12--${SITE}/auth/callback`), DOMAIN)).toBe(
      `https://deploy-preview-12--${SITE}`,
    );
    expect(publicOrigin(new URL(`https://main--${SITE}/auth/callback`), DOMAIN)).toBe(
      `https://main--${SITE}`,
    );
    expect(publicOrigin(new URL("http://localhost:3000/auth/callback"), DOMAIN)).toBe(
      "http://localhost:3000",
    );
  });

  it("leaves the custom domain itself alone", () => {
    expect(publicOrigin(new URL(`${DOMAIN}/auth/callback?code=abc`), DOMAIN)).toBe(DOMAIN);
  });
});

describe("canonicalNetlifyUrl with a custom domain", () => {
  it("carries the code and the invite across to the custom domain", () => {
    const url = new URL(`https://${PERMALINK}/auth/callback?code=abc123&next=/app&invite=WOLF7`);
    expect(canonicalNetlifyUrl(url, DOMAIN)?.toString()).toBe(
      `${DOMAIN}/auth/callback?code=abc123&next=/app&invite=WOLF7`,
    );
  });

  it("still returns null for a host that needs no correction", () => {
    expect(canonicalNetlifyUrl(new URL(`${DOMAIN}/auth/callback?code=abc`), DOMAIN)).toBeNull();
  });
});
