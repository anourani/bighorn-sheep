# Working in this repo

Last Man Standing — a private NFL survival league PWA. Next.js 15 (App Router) +
React 19 + TypeScript, Supabase (Postgres + auth + storage), deployed on Netlify.

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run build      # production build
```

**There is no CI.** No `.github/workflows` exists, so nothing runs on a pull
request — the green checks on a PR are Netlify's own redirect/header linters and
do not test the app. Run typecheck, tests, and build locally before pushing, and
never describe a PR as passing on the strength of those checkmarks.

---

## The database is deployed by hand. This causes most bugs here.

`netlify.toml` does not touch Supabase, and neither does anything else. Merging a
PR that adds a migration deploys the *code* and leaves the *database* behind, and
the app looks completely healthy until it fails at runtime — usually a 404 on
whichever RPC is missing.

**Whenever you touch `supabase/migrations/`, say explicitly in your summary that
the migration must be applied to production by hand, and hand over the SQL.**
Don't assume anyone infers it from the diff.

To find out what production actually has, run the read-only query in README.md
(`#### Deploying`). Present state should be everything PRESENT *except*
`profiles.display_name`, which 0004 drops.

Migrations must run in order: `0001_init` → `0002_join_by_invite` →
`0003_group_create_and_pick_flags` → `0004_profile_names_avatars` →
`0005_invite_code_without_pgcrypto` → `0006_preseason_picks` →
`0007_profile_extras_and_buy_in` → `0008_private_profile_fields` →
`0009_public_standings`.

**0009 needs a second, separate statement.** Applying it publishes nothing; the
landing page stays in its no-data state until a row is inserted into
`public_league` (see README, `#### Deploying`). That is the intended default —
the public board is opt-in.

**0004 is one-shot.** Its backfill reads `display_name` and a later statement
drops that column, so a second run fails with "column display_name does not
exist". Same reason `supabase/setup.sql` (a bundle of all migrations, for fresh
projects only) must never be replayed onto an existing database.

**Never rewrite an applied migration.** Add a new numbered one. 0003 still
contains a line known to be broken, annotated and pointing at 0005, precisely
because it has already run against real databases.

---

## Supabase traps that have already bitten

**`search_path = public` hides every extension function.** Supabase installs
extensions into the `extensions` schema. Every function here is declared
`security definer set search_path = public`, so an unqualified call to anything
from pgcrypto — `gen_random_bytes`, `digest`, `crypt` — raises `42883: function
does not exist` at runtime, even though 0001 does `create extension pgcrypto`.
This killed `create_group` for the app's entire life before anyone noticed.

Prefer `pg_catalog` builtins inside function bodies: `gen_random_uuid()` (core
since PG13, cryptographically random), `md5`, `random`. If you genuinely need
pgcrypto, schema-qualify it (`extensions.digest(...)`).

Note the asymmetry that makes this so easy to miss: a *column default* like
`default gen_random_uuid()` resolves its function once at DDL time and stores the
OID, so it keeps working forever. Only unqualified calls **inside a function
body** are re-resolved at call time against `search_path`. A schema can look
perfectly healthy while one function is dead.

**Auth → URL Configuration.** Site URL must be the **bare origin** with no path.
Supabase falls back to the Site URL whenever `emailRedirectTo` isn't on the
redirect allowlist, and it carries the `?code=` along — so a Site URL with a path
silently strands magic links on a page that can't exchange them, and sign-in
breaks with no error anywhere. `src/middleware.ts` now forwards a stray `?code=`
to `/auth/callback` as a safety net, but the setting still has to be right.

**Deploy previews hit that same fallback, and it looks nothing like a bug.**
`src/components/auth/LoginFlow.tsx` builds `emailRedirectTo` from
`window.location.origin`, so a preview correctly asks to come back to
`https://deploy-preview-12--bighorn-sheep.netlify.app/auth/callback`. But
`https://bighorn-sheep.netlify.app/**` does not cover that host: the allowlist is
globbed with `.` **and** `/` as separators, so the wildcard spans paths, not
subdomains. GoTrue discards the origin, substitutes the Site URL, and the
middleware safety net then dutifully completes the exchange — **on production**.
The symptom is therefore not a dead link but a successful sign-in on the wrong
site, which reads as a redirect bug rather than a config one. One entry fixes it
for every future preview and branch deploy:

```
https://**--bighorn-sheep.netlify.app/**
```

**The magic-link sender lives only in Auth → Emails → SMTP Settings.**
`signInWithOtp()` has no sender parameter, so no code change can affect it. The
sender must be a domain verified with the SMTP provider — a `@gmail.com` sender
is rejected by every transactional provider and surfaces as **HTTP 500** on
`/auth/v1/otp`.

**`NEXT_PUBLIC_*` values are inlined at build time.** Changing one in the Netlify
dashboard does nothing until the site is rebuilt.

The one that bites is `NEXT_PUBLIC_APP_URL`, which builds invite links in
`WhosIn.tsx` and `AdminSettingsModal.tsx`. Being a build-time constant, it holds
the *same* host in every context unless it's scoped per deploy context — so a
deploy preview hands out **production** invite links, and "Copy link" looks wrong
while nothing is actually broken.

It **is** set in the Netlify environment (verified Aug 2026), but as *"Same value
in all deploy contexts"*, which is exactly the failure above. Nothing in the repo
sets it — it's absent from `netlify.toml` — so the fallback in
`StandingsClient.tsx` (`?? "https://bighorn.example"`, a domain that does not
exist) is what ships anywhere the variable is missing. To fix the preview case,
switch it to *"Different value for each deploy context"* in Netlify and give each
context its own origin.

---

## Next.js + Netlify traps

**Server Action IDs are build hashes.** A tab holding client JS from an earlier
deploy posts an ID the running server doesn't know: the request 404s and Next
throws `UnrecognizedActionError`. Every Server Action call site therefore wraps
its body and calls `isStaleDeploymentError` / `reloadOnce` from
`src/lib/deploy-skew.ts`. Keep that pattern on any new call site.

**The service worker is generated from a template string** in
`src/app/sw.js/route.ts`. A stray backtick or `${` in a comment inside that
string produces a worker that doesn't parse — and the build still succeeds,
because the template is valid TypeScript either way. `src/app/sw.js/route.test.ts`
parses what the route actually serves; keep it passing.

It is served from a route (not `public/`) so its bytes change every deploy and
the browser actually runs `install`/`activate`. Never precache HTML routes there:
that markup names build-specific chunks, so caching it lets a superseded build
come back from the dead. Only content-addressed paths (`/_next/static`, `/icons`)
are cached.

`NEXT_PUBLIC_DISABLE_SW=1` in the Netlify env is the escape hatch — it ships a
worker that drops its caches and unregisters itself, which is the only way to
recover users' browsers en masse.

---

## Error-handling conventions

**Never render a raw `error.message` from a Supabase client.** `auth-js`
short-circuits on any 5xx *before* parsing the response body and builds the
message with `JSON.stringify(response)` — always the literal string `"{}"`, which
is truthy and therefore defeats `error.message || "friendly fallback"`. It
rendered `{}` to a real user. Use `errorMessage(error, fallback)` from
`src/lib/errors.ts`.

**Server actions return stable codes, never database text.** Callers key off
`res.error` in a copy dictionary with a `??` fallback (see `JoinByCode.tsx`,
`MyPicksClient.tsx`). Returning
`error.message` puts raw Postgres text — constraint names and all — one
`?? res.error` away from the UI. Map to `unexpected_error` and `console.error`
the detail so it lands in the Netlify function logs.

Action bodies are wrapped in `attempt()` in `src/app/app/actions.ts`, which turns
an unexpected throw into `{ ok: false, error: "unexpected_error" }`. `createClient()`
throws outright when env vars are missing, and an uncaught throw in a Server
Action reaches the browser as an opaque client-side exception.

**Error boundaries exist now** (`src/app/global-error.tsx`, `src/app/app/error.tsx`)
and surface the message and digest. Their absence is why a whole class of failure
was indistinguishable from any other for so long. Don't remove them.

---

## Debugging protocol

Every wrong turn in this repo's history came from theorising before looking. The
symptoms are unusually uninformative — a blank page, a generic error, a styled
page with no styles — and they map to completely unrelated causes.

1. **Get the real error first.** Browser console and the Network tab's status
   codes are worth more than any amount of code reading. Ask for them.
2. **Split client from server.** A private/incognito window has no service
   worker and no cache on first load. If a problem reproduces there, it is not
   the browser's cache — stop blaming it.
3. **Reproduce locally before blaming the host.** `npm run build && npx next start`
   serves the real production server; if it behaves there, the fault is in the
   deployment, not the code.
4. **Two errors in one console are often two unrelated bugs.** A 404 and a 500
   appeared together on the login page and shared no cause whatsoever.
5. **When one layer is fixed, expect the next to fail.** Fixing a crash exposes
   the real error underneath it. Say so out loud rather than implying the fix is
   the end.

Note that `*.netlify.app` is blocked by the egress policy in agent sessions — the
live site can't be fetched from here. The user has to run browser checks.

---

## Open issues

**Two entries here were wrong for months and cost real debugging time. Verify an
environment claim against Netlify or the database before repeating it — this
file is not evidence.** Both are corrected below; the pattern is the lesson.

- The magic-link sender is still another project's domain. Needs a domain owned
  by this app, verified with the SMTP provider.
- `NEXT_PUBLIC_APP_URL` is set, but shared across all deploy contexts, so
  previews hand out production invite links. See the Supabase traps section.
- `poll-scores` runs `*/5 * * * *` all year, including February. The code comment
  says to narrow it to Thu/Sun/Mon game windows in production; nobody has. Costs
  function minutes, not correctness.
- `docs/go-live.md` Step 1 still walks through 0006's constraint rename, long
  since applied. Steps 2–4 are current.

### Resolved — do not re-open

- ~~`SUPABASE_SERVICE_ROLE_KEY` is not set, so `poll-scores` no-ops.~~ **It is
  set** (verified in the Netlify dashboard, Aug 2026), the schedule is loaded,
  and the scorer polls and writes on schedule. The claim survived because
  `poll-scores` logged nothing and its only output — the returned `Response` —
  is discarded by Netlify's cron, so a working run and a dead one looked
  identical. It now `console.log`s every verdict; read that log before
  theorising about it.
- ~~`CRON_SECRET` is never read.~~ `src/lib/cron-auth.ts` reads it, and
  `load-schedule` **fails closed** — a 503 when it's unset, so an unset secret
  never means "anyone may reload the schedule". `poll-scores` is deliberately
  *not* gated: Netlify's cron cannot send a custom header, and recognising the
  platform by `user-agent` would be worse than no check. The rationale is
  written out at the bottom of `cron-auth.ts`.
- ~~Everything downstream of creating a group is unexercised against real
  data.~~ Partly resolved: the schedule is loaded and the scorer writes. Still
  genuinely unexercised is anything that needs a *completed regular-season
  game* — elimination, strike accrual, the weekly lock/reveal cycle at a real
  kickoff. None of that has run against live results yet, so treat Week 1 as
  the first real test.

---

## Things that are true now and weren't

- **There is no create-a-league path.** One standalone league for the inaugural
  season, so every player arrives via an invite code. `CreateGroupModal` and the
  `createGroup` server action are gone — an exported Server Action is a
  reachable HTTP endpoint, not dead code. The `create_group` RPC remains in the
  database because the league still has to be created through it once;
  `docs/dry-run.md` documents that path, and it needs `set local
  request.jwt.claims` because the function reads `auth.uid()`.
- **The landing page reads real league data.** `/` is anonymous-only (middleware
  redirects signed-in visitors to `/app`) and every 0001 policy is `to
  authenticated`, so it goes through one anon-callable RPC,
  `public_league_snapshot()` (0009). Three things about it are load-bearing:
  - **The pick-privacy lock is in SQL, not TypeScript.** The anon key ships in
    the browser bundle, so anyone can call the RPC directly; filtering in the
    server component would be theatre. Un-kicked picks are absent from the
    payload entirely.
  - **Publication is a pointer table (`public_league`) with RLS on and no
    policies**, not a column on `groups`. 0001's `"groups update by admin
    (unlocked)"` policy lets any admin UPDATE their own group row, and RLS
    cannot restrict *which columns* an update writes — so a flag on `groups`
    would let any league admin publish their own members' board with the anon
    key.
  - **The function takes no arguments.** A group id or invite code parameter
    would make it a universal standings reader for every league in the project.
