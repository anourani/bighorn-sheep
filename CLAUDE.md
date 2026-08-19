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
`0009_public_standings` → `0010_account_closure_and_league_buy_in` →
`0011_admin_settings`.

**0010 is what the redesigned account page reads and writes**, and until it is
applied that page shows a $0 buy-in and Delete Account fails with
`close_failed`. It adds `groups.buy_in_cents` / `site_fee_cents`, the
policy-less `account_closures` table, `close_own_account()` and
`set_group_buy_in()`, and **redefines `set_member_buy_in` so `buy_in_paid_at` is
stamped on every change** rather than only the paid branch — the card prints
"UNPAID · Updated 10/21, 2:47 PM", which 0007's `else null` made unrenderable. Replayable;
0007 is untouched.

**0011 is what the admin settings drawer reads and writes**, and it went
unapplied for long enough to cost a real debugging session: renaming the league
failed with "Couldn't save that. Try again.", which is the *catch-all* of
`setGroupName`'s error ladder, and the Data Feed tab showed nothing — two
symptoms, one missing migration. **Applied to production 2026-08-19.** Preseason
access **fails open**, so nobody loses practice to a late migration. Replayable.
Five things in it are worth knowing:

- **A missing RPC now says so.** `rpcErrorCode` in `actions.ts` reads PostgREST's
  `PGRST202` / `42883` / "schema cache" and a bare `42501` (grants not replayed —
  each migration does `revoke all … from public` first, so pasting a body without
  its `grant execute` fails identically to the function not existing) and returns
  `migration_missing`. Every admin ladder used to end in a catch-all whose copy
  read "try again", which is an invitation to click Save forever. The `known`
  substrings are tested FIRST, because `not_admin` also raises `42501`.

- **`set_group_rules` tests two conditions, not one.** 0001 declared
  `settings_locked_at` to freeze the rules and **nothing in this project has ever
  written it** — grep: readers only, in the RLS policy, the rules modal, the
  admin drawer and the mock fixture. A lock gated on that column alone would
  never fire. The function also tests `entry_closes_at <= now()`, which is the
  same "the season has started" fact `seasonPhase()` derives everywhere else, and
  the drawer mirrors both.
- **`set_member_preseason` has a window `set_member_buy_in` doesn't** — it
  refuses after `entry_closes_at`, because practice ends at Week 1 and never
  returns. Money admin stays open all season; practice admin does not.
- **`set_group_name` deliberately has no lock check at all**, which is the whole
  feature: 0001's `"groups update by admin (unlocked)"` refuses *every* `groups`
  write once the season starts, so a typo in a league name was unfixable outside
  the SQL editor. Name always editable, rules frozen — two definer functions
  differing by one test, because RLS cannot restrict which columns an update
  writes.
- **The `show_preseason` backfill is fenced inside its own column-creation
  guard**, for 0004's lesson turned around: a bare `UPDATE` out in the file would
  re-run on every replay and silently re-enable every member an admin had since
  turned off. It is also non-deterministic (it reads `now()`), so replayable and
  deterministic are not the same property here.

**Never widen a `select()` to name a column a pending migration adds.** PostgREST
raises `42703` on an unknown column rather than returning undefined, so
`submitPick` selecting `show_preseason` before 0011 landed would have made
`membership` null and turned *every pick in the app* into `not_a_member` — one
late migration escalating from "an admin panel is broken" to "nobody can play".
It uses `select("*")` and reads `?? true`.

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

**`new URL(request.url).origin` is not the host the browser asked for.** Behind
Netlify, a server handler can see the running deploy's *permalink*
(`<24-hex-deploy-id>--bighorn-sheep.netlify.app`) instead. Build a redirect from
it and you send the visitor to a different origin, where the session cookies you
just wrote do not apply — so a **successful** sign-in lands them signed out, and
`middleware.ts` then bounces them off `/app` to the landing page. The reported
symptom is "I clicked the link and ended up on the marketing page at a weird
URL", which reads as a redirect bug in the callback rather than a host bug.

It also propagates: their browser is now *on* the permalink, so the next sign-in
they start builds `emailRedirectTo` from it, and the emailed `redirect_to`
genuinely points there. Do not read that as the cause — it is the previous
failure's residue. `publicOrigin()` in `src/lib/deploy-origin.ts` is what every
self-redirect must go through. It derives the origin from the URL alone and
never from `x-forwarded-host`: a request header used to build a redirect is an
open redirect, and the header buys nothing here anyway.

**The preview wildcard also matches a deploy permalink, and that lets sign-in
happen on a frozen copy of the site.** `https://**--bighorn-sheep.netlify.app/**`
is there for deploy previews, but it equally matches
`https://<24-hex-deploy-id>--bighorn-sheep.netlify.app` — the permanent
per-deploy address Netlify shows on the deploy page. `login/page.tsx` builds
`emailRedirectTo` from `window.location.origin`, so anyone who reaches `/login`
on a permalink gets a magic link addressed back to the permalink, Supabase
accepts it as allowlisted, and **nothing errors anywhere**. They sign in against
an old build on an origin whose cookies are its own.

Read the `redirect_to` in the emailed link before diagnosing this. It is the
whole answer, and it distinguishes the two cases that look identical from the
outside: if `redirect_to` still carries the `/auth/callback` path the app asked
for, Supabase **honoured** it and the odd host came from the browser — someone
was on the permalink. If `redirect_to` is a bare origin with the path thrown
away, that is the Site-URL fallback above, and the allowlist is what to fix.

`src/middleware.ts` now redirects `/login` off a permalink before any verifier
cookie exists, which is the only place the fix is free. Previews and branch
deploys are deliberately exempt — they are their own origins by design.

**Never let a failed magic link report the app's guess instead of GoTrue's
answer.** `/auth/v1/verify` is the first hop of the link; on rejection it
redirects to `redirect_to` with `error`/`error_code`/`error_description` and
**no `code`**. The callback used to treat "no code" as `link_expired`, so
"expired or was already used" got printed over the top of whatever actually
happened, with nothing logged. `verifyErrorReason` in `src/lib/auth-callback.ts`
now reads those params, and the login page reads them from the URL **fragment**
too — GoTrue sometimes puts them there, and a fragment never reaches the server,
so that class of failure was previously invisible on both sides.

Two more things worth knowing when the exchange itself fails. auth-js checks its
own storage and throws `AuthPKCECodeVerifierMissingError` *before* it calls
GoTrue, so **the Supabase auth logs show nothing at all** — an empty log is not
evidence the link was never clicked. And it deletes the verifier cookie on any
failure, so read the cookie jar *before* the exchange or every failure looks like
a missing verifier.

**The emailed token is single-use and spent by a GET, so anything that follows
links can burn it.** Corporate mail scanners do. The service worker used to be
another way: it caught failed navigations and answered `/offline`, which spends
the code on a page that cannot complete it and makes the next click report a
link that genuinely is used up. `/auth/callback` is now excluded from the
worker's fetch handler and the response is `no-store`.

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

**Production and previews live on different hosts now, and the allowlist needs
both.** Production is `https://sheepwithglasses.com`; previews, branch deploys
and deploy permalinks are all still on `*.netlify.app`, because that is Netlify's
domain and nothing about a custom domain moves them. So the redirect allowlist
legitimately carries `https://sheepwithglasses.com/**` *and* the `netlify.app`
wildcard above, and the wildcard is not leftover cruft to tidy away — deleting it
breaks sign-in on every future preview. The Site URL is the custom domain alone.

**The magic-link sender lives only in Auth → Emails → SMTP Settings.**
`signInWithOtp()` has no sender parameter, so no code change can affect it. The
sender is `noreply@sheepwithglasses.com`, relayed through Resend.

**Two unrelated things both surface as HTTP 500 on `/auth/v1/otp`, and the
symptom does not tell them apart.** The app renders "Our sign-in service is
having trouble" for either — `errorMessage()` in `src/lib/errors.ts` maps every
`status >= 500` to that one string, and nothing in it mentions email. The causes:

- **The sender's domain isn't verified with the provider.** A `@gmail.com`
  sender is rejected by every transactional provider.
- **The API key is authorised for a different domain.** Resend scopes a key to
  one domain, and a key issued for another project refuses to send as this one.
  This is not hypothetical: the key in Supabase was scoped to `timeline.academy`,
  so the first sign-in attempt after the domain cutover failed exactly this way
  with the sender, host, port and username all correct.

**Read Resend → Logs before touching any field.** It is the only place the real
reason appears — `API key not authorized for this domain` in the second case —
and the fixes are completely different. A rejected send is logged there with its
request body; a send that never arrives at all points at the credentials instead.
Guessing between the two costs a round trip each time.

**`NEXT_PUBLIC_*` values are inlined at build time.** Changing one in the Netlify
dashboard does nothing until the site is rebuilt.

The one that bites is `NEXT_PUBLIC_APP_URL`, which builds invite links in
`WhosIn.tsx`, `AdminSettingsDrawer.tsx` and `MoreSection.tsx`. It is scoped
*"Different value for each deploy context"* in Netlify: production holds
`https://sheepwithglasses.com`, and **previews, branch deploys, Preview Servers
and Local development are deliberately blank.** Nothing in the repo sets it —
it's absent from `netlify.toml`.

**Blank outside production is the intended state, not a misconfiguration.** It
was once "Same value in all deploy contexts", which is why previews used to hand
out *production* invite links — a link that looks wrong while nothing errors.
Each context now answers "which site am I?" for itself.

**Every consumer therefore resolves it as `appUrl || window.location.origin` —
`||`, never `??`.** A Netlify variable left blank inlines as `""`, not
`undefined`, and `??` passes an empty string straight through: the link comes out
as a relative `/login?invite=…`, which is not something anyone can paste into a
message. `MoreSection.tsx` used `??` and had exactly this bug latent in it.

**`InviteCta` resolves the origin inside the click handler, not in render.**
`AdminSettingsDrawer` can do it in render because the drawer never renders on the
server (`open` starts false), but `InviteCta` is on `/app/standings`, which
builds as `ƒ` — server-rendered on demand. Reading `window` in its render body
would break the server pass. A handler only ever runs in the browser, and nothing
renders the link itself (the card shows `group.inviteCode`), so there is no
hydration concern either.

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

## Styling traps that have already bitten

**Tailwind's preflight caps every image at `max-width: 100%`, and that outranks
an inline width.** `TeamLogo` sets `style={{ width, height }}` from its `size`
prop, which beats any Tailwind sizing class — but not the reset. Put the image in
an absolutely-positioned wrapper carrying a `left` and no width, and the wrapper
shrink-to-fits into the space between that offset and its containing block's
right edge; `max-width: 100%` of *that* then silently letterboxes the image.

`PickHero`'s logo was the case. The wrapper sat at `left-[18px]` inside a 68px
strip group, so the available width was 50px — and an 80px logo drew 80px tall
and **50px wide**, the 50px one 28px. Nothing errors, nothing overflows, and the
only symptom is that the logo looks a little small, which reads as a design
opinion rather than a bug. It shipped, went through review, and the first
diagnosis blamed transparent padding inside the ESPN artwork and nearly scaled
every box 1.37x **on top of** the clamp.

Two fixes, both wanted: `w-max` on the wrapper (`max-content` is a definite
width, so shrink-to-fit never applies, and the wrapper stops mispositioning a
centred logo as well as mis-sizing it), and `max-w-none` in `TeamLogo` so no
future call site can hit it.

The general rule is the debugging protocol's, in a new place: **measure the
rendered box before theorising about why an image looks wrong.**
`getBoundingClientRect()` on the `<img>` returned 50x80 where the inline style
said 80x80, and that single number was the entire answer — after a paragraph of
plausible reasoning about CDN artwork that was not.

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

**Entries here have been wrong for months at a time and cost real debugging
time. Verify an environment claim against Netlify, Resend or the database before
repeating it — this file is not evidence.** Resolved below, the
`SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` entries are the ones that were
*false*; the others were true and have since been fixed. Both kinds are worth
reading, but only the first kind is the lesson.

- `poll-scores` runs `*/5 * * * *` all year, including February. The code comment
  says to narrow it to Thu/Sun/Mon game windows in production; nobody has. Costs
  function minutes, not correctness.
- `docs/go-live.md` Step 1 still walks through 0006's constraint rename, long
  since applied. Steps 2–4 are current.

### Resolved — do not re-open

- ~~The magic-link sender is still another project's domain.~~ It is
  `noreply@sheepwithglasses.com` as of Aug 2026, on a domain verified with
  Resend. Worth knowing *how* this was settled, because the entry sat here as a
  suspicion for months: **Resend → Logs** showed `SMTP v1.0.0` requests
  returning 200 for days beforehand, which proved Resend was always the relay
  and only the sender's domain was another project's (`timeline.academy`). The
  log is the check to repeat — the Supabase SMTP screen alone tells you what is
  configured, not what is actually being sent.
- ~~`NEXT_PUBLIC_APP_URL` is shared across all deploy contexts, so previews hand
  out production invite links.~~ Scoped per deploy context as of Aug 2026:
  production holds the custom domain, every other context is blank on purpose.
  The code change that made blank safe is in the Supabase traps section — the
  `||` vs `??` note, which is the part that is easy to undo by accident.
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

- **There are two ways to make a pick, and the grid is the default.** `TeamGrid`
  draws all 32 teams as square cards, one tap to pick; `WeekSchedule` is the old
  radio-group over the week's matchups and is unchanged. `PickFilters` switches
  between them, and orders the grid by team record or alphabetically. Six things
  are load-bearing:
  - **Both surfaces are handed the same derived values.** `MyPicksClient` already
    computed the week's `games`, the `usedByTeam` map with its two week-scoped
    exclusions, `byes`, `pickTeam` and `interactive`, and both layouts take those
    verbatim. A new rule about what is pickable goes in that one place; putting it
    in a layout means the other layout disagrees with it, silently.
  - **The geometry is exact, not approximate**, and both ends come off the
    mockups. Desktop is six 154.66px cards with 8px gutters inside the 968px
    column, which is `max-w-shell` (1000) minus the shell's `px-4`. Mobile is
    three 125.66px cards at 393px, full-bleed via `-mx-4` with 4px of padding and
    4px gutters. Change `main`'s `px-4` or `max-w-shell` and both stop matching.
    The column count steps at `480px`/`md`/`lg` — holding three across up to `lg`
    would draw 328px cards on a tablet. `lg` is still where the *shape* turns
    over: it is where the grid stops bleeding.
  - **The selected card's edge is `ring-2 ring-inset`, not a border.** A 2px
    border sits inside the *content* box as well as the card, which took 4px off
    the width the logo is sized from — so the logo visibly shrank the moment you
    picked it, 90.66px to 86.66px. A ring is a box-shadow and costs no layout.
    Measured, not reasoned about.
  - **Logos are greyscale at rest and come up in colour on hover or once
    picked.** Figma reaches that with `mix-blend-luminosity`; over a neutral card
    that is the same picture as `grayscale`, without the isolation and
    stacking-context rules a blend mode drags in.
  - **`TeamLogo` has a `fill` prop** for the desktop logo, which is sized off the
    column rather than in pixels — `size` is an inline style no breakpoint class
    can reach, which is why `PickHero` renders three copies. At 32 cards that
    would have been 64+ `<img>` elements. `max-w-none` is still load-bearing under
    `fill`: preflight's cap is relative to the intrinsic 500px artwork, not to the
    box.
  - **Layout and sort live in `localStorage`** (`lms:picks:*`), so they are
    per-device and are *not* part of `LeagueData`. `useStoredChoice` renders the
    default first and reads storage in an effect — seeding state from
    `localStorage` in a `useState` initializer is a hydration mismatch, since the
    server has no such thing. The cost is one paint for anyone who changed the
    setting.

- **Team records are derived on the client, and nothing stores them.** The `games`
  table has no standings columns and neither `load-schedule` nor `poll-scores`
  writes any; `TeamRecord` in `src/lib/league/types.ts` had exactly one producer,
  a demo table in `src/lib/mock/data.ts` that **no file imports**.
  `recordsThroughWeek` in `src/lib/league/records.ts` folds `gameWinner` over the
  regular-season schedule the client already holds, counting weeks *strictly
  before* the one on screen so the badge means "record coming into this week" and
  doesn't shift between Thursday and Monday night. Two consequences: preseason is
  excluded outright, and **every team reads 0-0 until the scorer marks a real
  regular-season game final** — which, per Open issues, has never happened. That
  is not a bug in the fold.

- **`orderPickerTeams` is no longer dead code.** It was written and unit-tested
  for a picker that was deleted, and the grid now uses it. It grew one option,
  `groupUnavailable`, which defaults to `true` purely so its original tests keep
  meaning what they said; the grid passes `false`, because bye and already-spent
  cards sort *in place* — "Team Record" is a straight ranking of all 32, and a
  card must not move merely because you spent it. "ABCs" needs no sort key of its
  own: `TEAMS` is already alphabetical by city and then nickname.

- **The My Picks pick module is no longer a team-coloured card.** The team's
  colour is three vertical gradient strips behind the logo — `stripGradient` in
  `src/components/picks/pick-hero.ts`, a fixed .25 -> .80 alpha ramp, alternating
  direction per strip. Everything else (eyebrow, city, name, matchup, lock copy)
  is ordinary page text on the page background. Because nothing is set *on* the
  colour any more, the ~90 lines that computed per-team gradient endpoints and
  flipped `PickHero`'s text between ink and white to clear WCAG AA went with the
  wash. (That is about the hero only — `readableOn()` in `TeamLogo.tsx` survives
  for the logo's failure tile, and is a weighted-average brightness test, not a
  WCAG ratio.) Four things are load-bearing:
  - **The row height is fixed** — 92 / 112 / 132px at base / `md` / `lg` — and the
    team name is size-clamped rather than wrapped, so the module is the same
    height for every team. An earlier version's height varied with the pick, so
    the page grew and shrank as you moved along the week strip. It is now
    structural rather than a thing to remember.
  - **Nothing in the tree may take `overflow-hidden`.** From `lg` the logo is
    pinned `left-[18px]` inside a 68px strip group and deliberately overhangs it
    to the right, into the 50px gap before the name. Below `lg` it is centred on
    the strips instead. Both placements are the design.
  - **The layout switches at `lg`, not `md`** — the desktop row needs ~986px for
    an 80px headline beside a 168px lock column, and it is where `WeekStrip` and
    `StandingsGrid` change shape too, so the page turns over at one width. `md`
    steps the *scale* only.
  - **The strips take the same ramp for all 32 teams**, so a dark team (LV
    `#000000`, CLE `#311D00`) reads as a grey-to-black bar. That is accepted, not
    an oversight.

- **The admin settings panel is a full-width bottom drawer, not a modal.**
  `AdminSettingsDrawer.tsx` (was `AdminSettingsModal.tsx`) renders
  `ui/Drawer.tsx`. Three tabs — Members (roster, two switches per row, invite),
  Rules (game rules **and** the buy-in amount), Data Feed — with the league name
  above them. Eight things are load-bearing:
  - **`Drawer` is a second primitive, and `Modal` is untouched.** Every geometry
    decision inverts between them (`max-w-app` → full bleed, `sm:items-center` →
    always `items-end`, `max-h-[92vh]` → `max-h-[90dvh]`), and a shared `variant`
    prop would have had to decide whether `Drawer`'s focus trap and focus restore
    apply to `Modal`'s five callers — either answer is wrong. `Modal` is still
    the default for anything that fits in a 480px card.
  - **`dvh`, not `vh`, on anything anchored to the bottom edge.** On iOS Safari
    `vh` is the *large* viewport — it ignores the URL bar — so `92vh` on a
    bottom-pinned panel puts its last ~60px under the browser chrome. `Modal`
    escapes this only by centring from `sm`.
  - **The height is FIXED at `h-[90dvh]`, not `max-h`.** It was `max-h` — sized
    to whichever tab was open — and because a sheet anchored to the bottom edge
    grows *upward*, switching tabs made the header lurch rather than the foot
    settle. One height for all three.
  - **The drawer slides both ways, and that costs a third state.** `rendered`
    outlives `open` for the length of `drawer-down`, and the scroll lock, the
    focus trap and the focus restore all key off `rendered` — releasing them on
    `open` would unlock the page and hand focus back while a panel is still on
    screen. Unmounting is driven by `animationend` with a 500ms `setTimeout`
    backstop, because a missed event would otherwise strand the drawer on screen
    with the page locked behind it. `prefers-reduced-motion` needs no special
    case: `globals.css` clamps every duration to `0.001ms`, so it fires next
    frame. **`Modal` deliberately does NOT do this** and still vanishes on close.
  - **The close button is absolutely positioned in the panel's corner**, not laid
    out with the title, and the `pr-12` that keeps the title clear of it is on
    the header ROW rather than on `DRAWER_RAIL`. Padding the rail would inset the
    header's text 48px from the body's rail and break the alignment with the page
    behind, which is the drawer's whole premise.
  - **The drawer must not be a child of `.stagger`.** `globals.css`'s
    `.stagger > *` applies `reveal-up 0.5s both` with an `:nth-child` delay, and a
    dialog rendered as a direct child inherits it on its own `fixed inset-0`
    root — the drawer was the 6th child, so it sat at opacity 0 for 275ms and
    then faded in over 500ms while its own 320ms slide played invisibly. Reads as
    a pop-in with no slide, and lengthening the slide makes it worse. `Drawer`
    portals to `document.body` **and** `StandingsClient` renders both dialogs
    outside the `.stagger` div; the account page hit this first and documents it
    at `AccountClient.tsx`.
  - **`globals.css` sets `scrollbar-gutter: stable` for the drawer's sake.**
    Every dialog locks the page with `body { overflow: hidden }`, which on
    classic-scrollbar platforms shifts the page ~15px right while the fixed
    drawer stays put — and the drawer's whole premise is that its content column
    lines up with the page behind it. macOS/iOS overlay scrollbars hide the
    problem, which is why it would otherwise ship looking fine.
  - **Nothing inside it may scroll.** No panel carries `max-h` or `overflow`; the
    drawer's BODY (`min-h-0 flex-1 overflow-y-auto`, a flex sibling of the fixed
    header) is the only scroller, so a short tab doesn't scroll and a long one
    scrolls the whole drawer. The `min-h-0` is not optional — a flex child
    defaults to `min-height: auto` and refuses to shrink below its content, so
    without it the panel grows past 90dvh and the page behind scrolls instead. A
    sixteen-row roster is exactly what tempts a `max-h-64` in there; there is a
    comment above the `<ul>` saying so.
  - **The tab bar IS now sticky, inside the drawer's header — a deliberate
    reversal.** It used to be a plain flow child, and the reasoning was sound at
    480px: the bar was never more than a short scroll from the top of the
    viewport, so pinning it bought nothing and cost height. At 90dvh with a long
    roster under it, it scrolls out of sight and the other two tabs become
    unreachable without scrolling back. Sticky is a pin, not a scroll region, so
    the invariant above is untouched. Don't "fix" it back.
  - **The name is above the tab bar, not in a tab.** It names the thing all three
    tabs are about, and it replaced `Modal`'s static `description={group.name}`.
    In a tab, "rename any time" would have meant "rename any time you're on the
    right tab". It rides in `Drawer`'s `aside` slot, which is **one** instance
    reordered with `order-*` — rendering it twice behind `lg:hidden` would
    duplicate the input's `id` and split its React state.
  - **`ui/Tabs.tsx` is a real tablist; `ui/Segmented.tsx` is not, and is still
    unused.** `Segmented` puts `role="tablist"`/`role="tab"` on a plain value
    selector with no panels, so extending it would have left every other caller
    claiming a role it doesn't fulfil. The visual treatment is deliberately
    identical. `tabs.ts`'s `nextTabIndex` **wraps**, where `week-strip.ts`'s
    `nextIndex` **clamps** — WAI-ARIA wraps for tabs, and the strip clamps
    because arrowing off Week 1 onto Week 18 would fling its scroller.
  - **The rules editor is native radios in a `<fieldset disabled>`**, not a
    `Segmented`. Disabling propagates for free, and a second `role="tablist"`
    inside a dialog that already has one would be a real a11y bug.
  - **Only the active panel is rendered**, not hidden. It keeps the drawer exactly
    as tall as what's on screen, and it makes "fetch the feed status when the
    Data Feed tab opens" fall out of mount rather than needing a visibility
    effect. The active tab is plain `useState` and survives close/reopen, because
    `Drawer` returns null when closed so only its *subtree* unmounts.

- **The buy-in amount is a RULE, and it lives on the Rules tab — beside a control
  that locks, while it never does.** `set_group_rules` (0011) refuses after
  `settings_locked_at is not null or entry_closes_at <= now()`;
  `set_group_buy_in` (0010) has **no lock check and no entry-close check at
  all**, because correcting what the league costs is money admin and getting the
  number wrong is exactly the thing you discover after kickoff. Three things
  follow, and each exists to stop that asymmetry misleading an admin:
  - **The `<fieldset disabled>` wraps the two radio groups and stops there.**
    Sweeping the buy-in inputs into it would grey out a control the database
    would have accepted. This is the single most likely regression in this file
    and there is a comment in it saying so.
  - **Each card states its own lock**, via a `Pill` in its heading — "Frozen" with
    a `LockIcon` (matching what `LeagueRulesModal` prints for the same fact) or
    "Editable" for the rules, "Always editable" for the fee.
  - **The lock glyph came OFF the tab label.** It used to sit beside "Rules" once
    the season started, which was honest when the whole tab froze together and is
    a false claim about half the tab now. `locked` is no longer computed in the
    export at all.

- **The buy-in stamp carries a TIME, and that is not decoration.** It used to be
  `formatMonthDay` — "10/21" and nothing else — on both the admin roster and the
  member's account card. An admin toggling the paid switch off and back on the
  same afternoon then watched the date beside it never move, because two
  different writes formatted to the same six characters. The database was
  correct (0010 stamps `now()` on every change, both directions) and the refresh
  was correct (the stamp reads a prop, not the optimistic overlay); the FORMAT
  was throwing the change away. `formatMonthDayClock` replaced it outright, and
  `formatMonthDay` is gone rather than left unused. A stamp that cannot show a
  same-day change is not a stamp.

- **The roster's optimistic overrides are pruned once the server agrees.**
  `paidOverrides` / `preseasonOverrides` cover the gap between the tap and the
  refresh, and nothing used to clear them — so an override outlived its write and
  shadowed the server for the life of the mounted drawer, hiding any change made
  by another admin. `pruneAgreed` drops entries matching the incoming prop on
  each `members` identity change. Pruning on AGREEMENT, not on write-success, is
  what keeps it safe: an entry whose write is still in flight disagrees with the
  prop it hasn't landed in yet, so it survives and the switch doesn't flicker.

- **The score feed's health is a real reading, and an admin can trigger one.**
  The Data Feed tab used to print a hardcoded `ESPN · healthy` Pill beside a
  permanently `disabled` "Enter a result manually" button. Every terminal return
  now goes through a `finish()` funnel that writes 0011's one-row `feed_status` —
  the same argument the file already made for logging, extended to the database.
  Six things:
  - **The scorer lives in `src/lib/nfl/poll.ts`, not in the Netlify function.**
    `runScorePoll` has two callers — the five-minute cron and the "Check now"
    button via the `runFeedCheck` action — and one body is what stops a manual
    check drifting from the scheduled one. `netlify/functions/poll-scores.ts` is
    now only the schedule, the service client, the log line and the `Response`.
    It also **must not** live in `netlify/functions/`: Netlify deploys every file
    there as a function and derives the name from the filename, which is what
    `netlify/function-names.test.ts` exists to catch.
  - **"Check now" runs in-process, not over HTTP.** Whether a Netlify *scheduled*
    function's endpoint answers a request in production is a platform detail, and
    a button built on a guess about it is how the disabled manual-entry control
    came to sit there in the first place. It needs the service role
    (`src/lib/supabase/service.ts`), because `record_feed_sync` is granted to
    `service_role` alone and the poll writes past RLS; when the key isn't
    readable the action returns `feed_poll_unavailable` and the panel says so.
  - **A failing poll still resolves `ok`.** The funnel records the verdict before
    returning, so `runFeedCheck` re-reads `feed_status` and the panel says "the
    score feed is failing" and names the stage — strictly more use than a toast.
    Only a refusal *before* the poll (not an admin, inside the 60s cooldown, no
    service key) surfaces as an error line. That cooldown
    (`feedCheckedRecently`) is the only thing between a double-tap and a
    hammered provider, and it is checked before the service client is built.
  - **Two timestamps, and that is the point.** `checked_at` is stamped on every
    run; `last_ok_at` only advances on success. A fresh one beside a stale other
    reads as "we're checking and it's failing", which is a different message from
    "nothing has run at all".
  - **Staleness is the only way a dead scorer is detectable.** If Netlify stops
    invoking the function, nothing is written at all and `status` stays whatever
    it last was, forever. `describeFeed` therefore tests the age of `checked_at`
    *before* it looks at `status`.
  - **The status write can never fail the run.** A missing `feed_status` costs
    observability, never scoring. `checked_at` and the read's `now` both come
    from Postgres, so "checked 3 minutes ago" can't go negative across two
    machines' clocks — which is also why `DataFeedSection` holds the whole
    `FeedSnapshot` rather than just `describeFeed`'s one sentence: every age on
    screen is measured against the database's clock, and the six facts under the
    headline are what an admin actually came for.

- **Preseason access is per member, and it is one condition in the loader.**
  0011's `group_members.show_preseason`, set by an admin. `load.ts` simply stops
  building `LeagueData.practice` for a switched-off viewer, and that alone
  removes the preseason chips from the week strip and the practice grid from
  Standings — `MyPicksClient` already fell back to the live regular week when a
  selected preseason week left the strip, because entry closing mid-session does
  the same thing. Four consequences:
  - **It gates access, not just visibility.** `submitPick` refuses a preseason
    pick from a switched-off member; a Server Action gated only in the UI isn't
    gated.
  - **The window closes at the first Week 1 kickoff and never reopens.**
    `set_member_preseason` raises `preseason_closed` after `entry_closes_at`, and
    the drawer disables the switch on the same condition, so there is no Week 11
    in which anyone's preseason can be switched back on. The loader ignores the
    flag by then anyway — what the guard buys is that the stored value cannot
    drift from what the season allows, and that an admin isn't misled into
    thinking a toggle they just flipped did something. Disabled rather than
    hidden: a control that vanishes reads as a bug.
  - **Existing preseason picks survive**, because the round is derived at read
    time. Turning it off hides history rather than deleting it.
  - **It does not remove anyone from the round for OTHER viewers.**
    `derivePractice` still folds over every member, so a switched-off player
    keeps their line on an admin's practice table. The flag gates your access to
    the round, not your existence in it.
  - **`LeagueData.practiceEnabled` exists because a null `practice` has two
    causes.** Before it, a null mid-preseason rendered *nothing* between the
    status report and the foot of Standings — no heading, no explanation. The two
    empty states are "your admin hasn't turned this on" and "no preseason
    schedule is loaded", and they can't be told apart from the null alone.

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
- **The account page is two 322px columns in a 656px block, and every number in
  it is transcribed from the mock-ups.** `/app/account` is title → [Personal
  Details | For the Common Good] → More → Log Out on desktop, and reorders to
  … → Log Out → More on a phone. `SHOW_LEAGUE_AND_PREFERENCES` and its two hidden
  sections are **gone** — the redesign supersedes them, and `git log` is where
  they live now. Seven things are load-bearing:
  - **`lg` is where it turns over**, as everywhere else in the app, and the
    column is `max-w-[656px]` inside `main`'s 968 (`max-w-shell` less its
    `px-4`). The two columns are 322 + 12 + 322. Blocks are 32px apart on a phone
    and 48px on a desktop; the two columns are 32px apart stacked and 12px apart
    side by side, which is a real difference in the mock-ups and not rounding.
  - **DOM order is not visual order.** Log Out carries `order-3 lg:order-4` and
    More `order-4 lg:order-3`, rather than the button being rendered twice.
    `.stagger` animates on `:nth-child`, which `order` leaves alone.
  - **`variant="primary"` cannot be repainted black**, which is why
    `SPEC_BUTTON_DARK` in `src/components/account/spec.ts` pairs with
    `variant="ghost"`. `bg-brand-sheen` is a background *image*, so a background
    *colour* lands in a different tailwind-merge group and the gradient survives;
    and `shadow-none` loses to `shadow-panel-sm` outright, because tailwind-merge
    does not recognise `panel-sm` as a shadow size and so never treats the two as
    alternatives — CSS source order then favours the `extend`ed one. The button
    ships with a soft drop shadow under it and nothing errors. Measured, not
    reasoned about; same family as `Label`'s `text-label-md` trap.
  - **The favorite-animal chevron is drawn beside real text, with the `<select>`
    invisible on top at `opacity-0`.** A select's box is as wide as its *widest
    option*, not the one showing, so a chevron pinned to its right edge sat 70px
    past "Koala" at the card's edge. The select is still the interactive element,
    so the iOS wheel and the platform keyboard behaviour are unchanged.
  - **The unpaid buy-in card wears a 5px `#A71930` cap and squares its top
    corners; the paid one has neither.** That cap is the only thing that
    distinguishes the two states from across the page.
  - **The "More" rows are 8px radius where every card above them is 4px.** In the
    design at both widths — not a slip waiting to be unified.
  - **The invite row hides once entry closes**, matching `InviteCta` on
    Standings: the code still exists but `join_by_invite` refuses it. Its link is
    built from `NEXT_PUBLIC_APP_URL || window.location.origin`, which is now
    what every invite-link call site does. It once read `??` here and
    `?? "https://bighorn.example"` on Standings — a domain that does not exist —
    and both were wrong in the same way once the variable started being blank
    outside production.

  Two consequences worth knowing:
  - **The 160px avatar portrait is gone from this page.** It is not in either
    mock-up. The Favorite Animal row is still the app's only avatar picker, so a
    player chooses their animal here and sees it on Standings.
  - **The flag never gated the way into a league, and still doesn't.** A viewer
    who belongs to none gets "Join an Existing League" in the Common Good column
    instead, on `!activeLeague` alone. `/app` and `/app/standings` offer the same
    `JoinByCode` through `NoLeagueState`; three entry points is intentional.

- **The header's account button wears a red dot while the viewer's buy-in is
  unpaid**, and `AppHeader` is `async` for it. That is the one piece of league
  data the header reads — it was a plain synchronous component that read none,
  and the docblock saying so has been corrected rather than left to rot. Three
  things are load-bearing:
  - **`viewerBuyInUnpaid()` (src/lib/league/load.ts) is its own loader**, not a
    field on `loadAccount()`: the header renders on every `/app` screen and
    `loadAccount` is five queries deep for the one boolean the dot wants. This is
    one indexed read of the viewer's own membership rows, `cache()`d, resolving
    the active league exactly as `loadAccount` does so the dot and the buy-in card
    it points at cannot disagree.
  - **It fails CLOSED, where `accountClosed()` fails open.** The asymmetry is
    deliberate. A false lockout takes the league off the app; a false dot only
    tells someone they owe money they have already paid — bad, and worse than no
    dot, so an error hides it.
  - **The dot needs `-0.5` (2px) to sit the design's 1px proud of the ring**,
    because an absolutely positioned child resolves its insets against the
    *padding* box — 38px inside this `border-box` 40px circle with its 1px border.
    `-top-px` measured flush. Same arithmetic as the `after:` tap ring beside it,
    and the first version of the comment there asserted the opposite before anyone
    measured it. Nothing in that subtree may take `overflow-hidden`.

- **Deleting an account closes it. It does not delete anything.** "Delete
  Account" in the Danger Zone opens a confirm sheet and then writes one row to
  `account_closures` (0010) through `close_own_account()`. The player's profile,
  membership, picks and strikes all survive, because their line on the standings
  board is part of the season's record — `toMember` already tolerated a missing
  profile and `public_league_snapshot` already `left join`s profiles, so nothing
  on Standings changed at all. Three things are load-bearing:
  - **Closure is a policy-less side table, not a `profiles.deleted_at` column.**
    0001's `"profiles update own"` lets a user UPDATE their own row and RLS cannot
    restrict *which columns* — so a column would be clearable by the very account
    it locks out, with the anon key, from the browser. A table with RLS on and no
    INSERT/UPDATE/DELETE policies can only be written by a definer function. The
    absence of those policies **is** the enforcement.
  - **`src/app/app/layout.tsx` is the only place the lockout is enforced**, via
    `accountClosed()`, and that function **fails open**: any error — the table
    absent because 0010 has not been applied, a dropped connection — resolves to
    "not closed". Failing closed would turn one unapplied migration into the whole
    league being locked out at once.
  - **There is no way back from inside the app**, by design. Reopening is
    `delete from public.account_closures where id = '<uuid>'` in the SQL editor
    until an admin control ships. Permanently removing someone from the standings
    board is that same follow-up and does not exist yet.
