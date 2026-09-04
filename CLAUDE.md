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
`profiles.display_name`, which 0004 drops — and, until 0016 is applied by hand,
`profiles.tour_completed_at`, whose absence is what keeps the first-run tour
inert rather than broken.

Migrations must run in order: `0001_init` → `0002_join_by_invite` →
`0003_group_create_and_pick_flags` → `0004_profile_names_avatars` →
`0005_invite_code_without_pgcrypto` → `0006_preseason_picks` →
`0007_profile_extras_and_buy_in` → `0008_private_profile_fields` →
`0009_public_standings` → `0010_account_closure_and_league_buy_in` →
`0011_admin_settings` → `0012_create_group_entry_deadline` →
`0013_lock_membership_writes` → `0014_pick_consistency` →
`0015_pick_and_buy_in_reminders` → `0016_profile_tour`.

**0013 and 0014 close two direct-write holes reachable with the anon key**, and
both are pure RLS changes — idempotent, no backfill, hand-applied. 0013 drops
`group_members`' `"members insert self"` policy: membership is created only by the
`join_by_invite` / `create_group` definer functions, so a browser could otherwise
self-insert an *admin* row from the league UUID alone (the id ships in every
member's payload). 0014 tightens the `picks` insert/update `with check` so a pick's
`week` / `season_type` / `team_id` / season must match the referenced game, blocking
the inconsistent rows a direct POST could write. Neither needs an app change —
`submitPick` already writes consistent rows — so unlike 0010/0011 there is no "the
page is broken until this is applied" symptom; the only effect of skipping them is
that the holes stay open. `supabase/setup.sql` is synced to match, so a fresh
project doesn't reintroduce them.

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

**0012 is what stops a new league locking itself out, and it exists because one
already did.** `create_group` defaulted `entry_closes_at` to
`now() + interval '7 days'`, which is not the "first kickoff of Week 1" every
consumer reads it as. The inaugural league was created 2026-08-08 without
`p_entry_closes_at` and shut its own entry on 2026-08-15 — six weeks before Week
1 — taking `join_by_invite`, the preseason practice round and the rules editor
with it. It surfaced four days later as an admin asking why the preseason
switches were greyed out under "Preseason is over", which is the *least*
informative of the four symptoms. Replayable; no backfill. Four things:

- **It derives, then refuses — it never guesses.** `coalesce(p_entry_closes_at,
  min(kickoff) where season_type = 'regular' and week = 1)`, then
  `raise 'entry_deadline_unknown'` if that is still null. A wrong deadline is
  silent and, from inside the app, permanent; an error lands in front of whoever
  is in the SQL editor. Same asymmetry as `cron-auth.ts` failing closed.
- **`season_type = 'regular' and week = 1`, never the earliest game of the
  season.** A full load's first kickoff is the Hall of Fame game in early
  August, so the whole-schedule minimum would set a deadline already in the past
  and close entry the instant the league was created. `sim-advance.ts` fell into
  exactly this and carries a comment about it.
- **The signature is deliberately unchanged.** Making `p_entry_closes_at`
  required is what you actually want, and Postgres forbids a non-defaulted
  parameter after a defaulted one — `p_season` is in front of it. Requiring it
  would mean reordering, hence `drop function`, hence breaking the positional
  call in `docs/dry-run.md`. Holding the five parameters also means
  `src/lib/supabase/types.ts` needs no edit.
- **It does NOT retire `alignEntryDeadlines`.** 0012 fixes leagues at birth; the
  loader's align pass fixes the ones born earlier and re-aligns everything if
  the NFL moves the opener, which no create-time default can do.

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
`InviteCta.tsx`, `AdminSettingsDrawer.tsx` and `MoreSection.tsx`. It is scoped
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
renders the link itself, so there is no hydration concern either. (That last
clause used to read "the card shows `group.inviteCode`" — it no longer does. The
code is revealed only when the clipboard write throws.)

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

## Page layout: what a new page inherits, and what it must not add

Every `/app` route renders inside one `<main>` — `src/app/app/layout.tsx` — and the
frame is split across two elements, deliberately: the WRAPPER owns the horizontal and
`main` owns the vertical.

```
<div className="… max-w-frame px-4 …">      // the gutter
  <main className="flex-1 pb-20 pt-10 lg:pb-32 lg:pt-20">
```

40px above the first block and 80px below the last on a phone; 80 and 128 from `lg`.
Those are the mockups' numbers. The desktop pair is asymmetric on purpose — the mockup
pads its section by 80 and then pads the page wrapper by another 48, so the foot of a
page is deliberately wider than its head. Don't "balance" it.

**The horizontal has NO breakpoint, and the content column is
`min(viewport − 32, 1000)` at every width.** `maxWidth.frame` in
`tailwind.config.ts` is the 1000px column plus 16px either side, derived from
`SHELL_COLUMN`/`SHELL_GUTTER` rather than retyped as 1032, and it is capped on the
wrapper — so the column widens with the window until it reaches 1000 and then stops,
and nothing ever comes closer than 16px to the window edge. One rule, two regimes.

It was three bands before, and the middle one was an accident: `max-w-shell` on the
wrapper with `px-4 lg:px-0` on `main` gave the old 968 column between 1000 and 1023px
and then **jumped 32px wider at `lg`**, where the gutter all but vanished — 4.5px at
1024 with a classic scrollbar. The column is continuous now: measured 976 → 977 → 984
→ 993 → 1000 across 1023/1024/1031/1040/1047, with the gutter pinned at exactly 16
throughout. `DRAWER_RAIL` is `max-w-frame px-4` for the same reason — its premise is
lining up with the page behind it — and `TeamGrid`'s desktop cards are **160px, not the
154.66** they were drawn at against 968.

**A new page therefore adds no vertical padding of its own: no `py-*`, `pt-*`, `pb-*`
or `mt-*` on its root.** Every `src/app/app/*/page.tsx` is a thin Server Component
whose body is a load, a guard and a client root, so that client root is where this
goes wrong — a root that pads itself looks completely correct in isolation. It is only
wrong *relative to the other routes*, and nothing renders two page roots at once, so
nobody sees it. `NoLeagueState` carried a `py-6` for exactly this reason and sat 24px lower
than every other screen for as long as it existed.

Five more rules, roughly in the order they come up:

- **The gutter is on the WRAPPER, and `-mx-4` still reaches it.** `StandingsGrid`,
  `WeekStrip` and `TeamGrid` full-bleed by cancelling 16px with `-mx-4` (plus `lg:mx-0`
  where the bleed stops at desktop). `main` carries no padding of its own any more, and
  that changes nothing for them: a negative margin shifts a box rather than depending on
  the parent's padding, and it lands in the wrapper's 16px, which is the window edge
  wherever the wrapper is narrower than `max-w-frame`. Measured: the bled element's left
  edge is 0 below `lg` at 320 / 393 / 768 / 1023. `Headcount` is not in that list — it is
  a filled card that fills the column and bleeds nowhere. Nothing cancels the *vertical*
  padding — there is no `-mt-*` anywhere in `src/`.
- **The breakpoint is `lg` (1024px), never `md`.** It is the app's single turn-over
  width: `WeekStrip`, `StandingsGrid`, `PickHero`, the headcount card's cube scale and
  the account grid all change shape there. It is NOT where the column width turns over —
  the horizontal has no breakpoint at all now, and the two are independent on purpose:
  shape steps at 1024, width caps at 1000 wherever the window allows it. `md` steps
  *scale* only, so a page that turns over there takes desktop padding while every
  component inside it is still phone-shaped.
- **Think twice before putting `space-y-*` on a page root.** It compiles to `> * + *`,
  which outranks a child's own `mt-*` on specificity, so no single child can opt out —
  it is all-or-nothing. `StandingsClient` and `MyPicksClient` both dropped theirs for
  that reason and give each block an explicit `mt-*` instead. Use `space-y-*` only when
  every block genuinely wants the same gap and none of them owns its own seam.
- **A component carrying the design's own top and bottom padding owns the seam around
  it, and the page adds nothing.** `PickHero` is `py-10 lg:py-12` straight off its
  Figma frame, and that module is *supposed* to butt against the week strip — so a
  sibling gap stacked on top is not extra breathing room, it is the wrong number. This
  is the same mistake as a self-padding page root, one level down.
- **`.stagger` is animation only.** It sets `reveal-up` and `:nth-child` delays and
  contributes no spacing whatsoever, so adding a root to it changes no layout and
  removing spacing from a root changes no animation. It does mean a measurement taken
  before the animation settles reads 12px low — `reveal-up` starts at
  `translateY(12px)` — which looks exactly like a padding bug.

**A bottom bar exists again below `lg`, and it changed none of the above.**
`BottomTabBar` is `sticky`, so it reserves its own height at the foot of the
document instead of floating over it — the reason `main`'s `pb-*` did not have
to move for it, and the reason the measurement above is still the right check.
The full entry is under "Things that are true now and weren't".

**Routes outside `/app` inherit none of this.** `/`, `/login`, `/account-closed` and
`/offline` each render their own `<main>`, and `<body>` carries no padding.
`global-error.tsx` ships its own `<html>`/`<body>` with inline styles, and Tailwind
never reaches it at all.

**Verify by measuring, not by eye**, per the debugging protocol below — Tailwind's JIT
compiles a class it cannot find to *nothing*, so a typo like `lg:pb-32x` fails silently
and presents as padding that "didn't take":

```js
const m = document.querySelector('main');
[getComputedStyle(m).paddingTop, getComputedStyle(m).paddingBottom];
// 40px / 80px below lg, 80px / 128px from lg. `main` has NO horizontal padding —
// the gutter is the wrapper's, so check the column itself instead:
const w = m.getBoundingClientRect().width;
[w, Math.min(document.body.clientWidth - 32, 1000)]; // equal at every width
```

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

- **There is a seven-step first-run tour, and it is the only place the app
  explains the rules in-product.** `src/components/onboarding/` — a bottom sheet
  on a phone and a centred 480px card from `sm`, over a scrim, naming the three
  tabs and then the four rules that eliminate people. It fires once on `/app`
  for a member who has not seen it, and has a permanent "Show Me Around → Replay" row
  in the account page's Additional Settings. `0016_profile_tour` is the
  migration, and **it must be applied to production by hand.** Design:
  `Onboarding Flows.dc.html` flow 2A and its `TourCarousel.dc.html`. Nine things:
  - **It fails INERT, and that is the opposite of every other migration here.**
    `viewerTourCompleted()` returns `true` — "already seen" — on any error, so an
    unapplied 0016 means the tour never appears. Failing the other way would
    fire an undismissable carousel at every player on every load, because the
    dismissal write would be failing for exactly the same reason. So unlike
    0010/0011, the symptom of the missing migration is silence rather than a
    broken page, and "the tour never fires" is the first thing to check it
    against.
  - **That loader is its own isolated `select("tour_completed_at")`, and
    widening an existing one would have been the real damage.** Every other
    `profiles` read in `load.ts` names its columns, and PostgREST answers a
    missing column with `42703` rather than `undefined` — so adding this to the
    account loader's select would have taken the picks screen, the standings
    board and the account page down together in the window before 0016 landed.
    This is the "never widen a `select()`" rule with a live example; there is a
    test asserting the existing selects are untouched.
  - **The backfill is FENCED inside the column-creation guard**, on 0011's
    pattern. A bare `update ... where tour_completed_at is null` would be right
    exactly once and would then sweep up every player who joined since —
    retiring the tour for the people it exists for. The fence is what makes the
    file replayable rather than merely idempotent-looking. Deleting the
    `update` (not the block) shows the tour to the current league too.
  - **It is NOT `Modal`, and the three reasons are all chrome.** `Modal`'s
    header carries a bottom rule and renders its title at 18px semibold ink
    (this header is borderless, and its "title" is a 12px uppercase counter);
    its footer adds a top rule and its own padding where this has neither; and
    it hard-codes one entrance where this needs two. Bending `Modal` would have
    changed its five other callers, and `Drawer` — the other primitive — is
    full-bleed at every width, which is what a 480px desktop modal must not be.
    It reuses `Modal`'s class strings instead.
  - **It takes `Drawer`'s focus trap, which `Modal` does not have, and the
    reason is this surface's alone.** The page behind it is the pick grid: a
    keyboard user tabbing out of an untrapped dialog lands on a team card, and
    activating one spends that team for the season. Every other dialog sits over
    a roster or a settings list where the same escape costs nothing.
    `FOCUSABLE_SELECTOR` / `nextFocusIndex` are imported from `ui/drawer.ts`
    rather than rewritten.
  - **It must not render inside `.stagger`, and it does not portal.**
    `MyPicksClient`'s root is a `.stagger`, whose `reveal-up ... both` leaves a
    transform applied for the life of the page — which makes it a containing
    block for `fixed` descendants. So the tour mounts in `app/app/page.tsx`
    beside `MyPicksClient`, and on the account page beside the two modals. Both
    are the slots those files already use for exactly this, and there is a test
    asserting `MyPicksClient` never imports it.
  - **The 180px art frame and the 72px body are FIXED, and that is the PRD's own
    acceptance criterion** — the sheet must not change height between steps.
    The title is `truncate`d for the same reason: step 7's is the longest and
    would otherwise wrap to a second line. Neither may become content-driven.
  - **In the footer the dots yield and the buttons do not.** On the last card
    the row carries seven dots, "Not now", "Back" and the CTA, which at the
    design's own 393px frame lands within a few pixels of the content width —
    close enough that a font metric decides it. The dots are `min-w-0 flex-1
    overflow-hidden` and the controls `shrink-0`, so the failure is a clipped
    decorative dot rather than a wrapped button, which would break the fixed
    height above. The header's counter states the position in words anyway.
  - **Replaying does not complete the tour.** Only `FirstRunTour` writes; the
    account page's replay just opens the carousel, with `showSkip={false}`
    (there is nothing to skip when you asked for it) and a "Back to Account"
    CTA. Both exits from the first-run path — finished and skipped — write,
    because skipping is a decision rather than a deferral, and the replay row is
    what makes that safe.

- **The admin drawer can email the league, and its tabs are Members / League
  Settings / Data Feed / Emails.** Rules and Name merged — Name only ever existed
  because the league's name and invite link had been evicted from a rail that was
  costing the roster a third of 1000px, and both are details about the league
  rather than about its members. `0015_pick_and_buy_in_reminders` is the
  migration, and **it must be applied to production by hand.** Twelve things:
  - **`reminderWeek` is not `resolveCurrentWeek`, and conflating them is the bug
    this feature was one line away from shipping.** `resolveWeekFromKickoffs`
    returns the greatest week whose EARLIEST kickoff has passed — the week being
    *scored*. On a Wednesday in October that is week 4, which finished on Monday
    night. A reminder keyed on it would tell the league to pick for a week they
    cannot pick AND consume week 4's row in the send log's unique index, so the
    genuine week-4 reminder could never be sent. Both halves silent.
    `src/lib/league/reminders.ts` derives its own week and there is a test
    asserting the two numbers side by side.
  - **The window gate is 0014's own `with check`** — `status = 'scheduled' and
    kickoff > now()` for at least one game in the week — transcribed rather than
    invented. `weekFinalKickoff` is the right thing to PRINT and the wrong thing
    to test: a postponed game keeps its week and gains a future kickoff, so "the
    final kickoff hasn't passed" reports a finished week as open.
  - **No email address ever reaches the browser.** `reminder_due` defines who is
    due once and returns the address, granted to `service_role` alone;
    `reminder_status_for_admin` is also definer, so it may call that function
    despite the grant, and selects every column except the email. One definition,
    two projections, and the browser-facing one structurally cannot leak because
    it never names the column. Do not merge them.
  - **The limit on that claim is `first_name`.** 0004's `handle_new_user` can seed
    it with a whole address for a user created outside the app — its
    `split_part(…, ' ', 1)` splits on a space, which an email has none of, so the
    `'@'` branch below it is unreachable. The app's own signup always sends
    metadata, so it does not fire for anyone who joined normally. 0004's bug, not
    this one's, and such a name is already on the standings board anyway.
  - **Idempotence is a database property, because email is not idempotent the way
    `poll-scores` is.** A partial unique index on (group, user, season,
    season_type, week) `where kind = 'pick' and status = 'sent'`. Two asymmetries
    in it look like oversights: the `status` predicate is what lets a failed
    attempt retry, and **there is deliberately no equivalent index for
    `buy_in`** — its week is null, nulls are distinct, so the same index would
    dedupe nothing, and a debt has no natural period. Picks are keyed; buy-ins
    are throttled by an interval.
  - **The tickboxes NARROW and can never widen.** `runReminderSend` intersects
    the admin's selection with what `reminder_due` returns, so a hand-rolled POST
    naming arbitrary ids still reaches nobody who was not due — and it names
    member ids, never addresses, because addresses do not leave the server.
  - **A dry run writes NOTHING to the send log.** Writing it would burn the
    idempotence keys and silently suppress the real send afterwards, which is the
    opposite of what `load-schedule --dry` promises. Same for a refused batch:
    nothing was sent, so a row would suppress the retry for people who never got
    an email. Both have tests.
  - **The outbox pattern was considered and rejected.** Insert `pending` before
    sending and update after, and a crash leaves rows that block the retry
    forever — a member silently never reminded, which is worse and invisible than
    the duplicate the current design risks in a one-round-trip window.
  - **Reminders can only be sent from production**, and that is a feature.
    `NEXT_PUBLIC_APP_URL` is deliberately blank outside production, and rather
    than guess an origin `sendReminders` refuses. A wrong URL in a redirect is
    recoverable; the same URL in twelve inboxes is not. It is resolved from the
    server's env, never from the drawer's `appUrl` prop, which is
    `appUrl || window.location.origin`.
  - **`src/lib/mail/` is the vendor seam, and it is a raw `fetch`.** Mirrors
    `src/lib/providers/` — an interface, an injectable `fetchImpl`, a `LogMailer`
    standing in for `MockProvider`, and a `getMailer()` that returns null rather
    than throwing. Batch rather than per-recipient because of the rate limit, not
    elegance: thirty sequential sends paced to a couple of requests a second is
    ~15s, past Netlify's synchronous ceiling, so the action would report failure
    *after* the mail had gone. **Resend's batch cap and whether it supports a
    per-message `reply_to` were never verified** — resend.com is blocked by the
    agent sandbox's egress proxy. There is a note on the constant.
  - **Two long tab labels fall back below `lg`, and both controls failed when
    measured.** "League Settings" unconditionally overflows at 320 (bar 288,
    scroll 301); keeping "Data Feed" at full width overflows at 320 too and
    scrolls the *document*, because the bar is not inside `main`'s clip. Four
    tabs at 320 leave 72px each and "Members" alone wants 82.4. The cap is 620,
    not 560: at 540 the margin over "League Settings" is eight pixels.
  - **The `<fieldset disabled>` is the merge's one real hazard.** Four sections
    on League Settings, three lock behaviours: `set_group_rules` freezes once the
    season starts, while `set_group_buy_in` and `set_group_name` deliberately
    have no lock check at all. It must keep wrapping ONLY the rules radio groups.

- **Standings draws the real board during preseason now, blank, instead of a
  sentence.** `StandingsClient`'s preseason branch used to render the practice
  table or — when `practice` was null — a "Practice Standings" header and one
  line of copy, and nothing else. So a signed-out stranger on `/` saw the whole
  roster over 18 empty week columns while the members of that same league saw a
  paragraph. That branch now falls through to the same board, and the practice
  table is unchanged when it exists. Six things:
  - **It is literally the same element.** The grid plus its padlock note is
    lifted into one `regularBoard` const and placed by both branches, so the
    preseason board and the in-season board cannot drift. Those are also the
    props `PublicStandings` passes; only `viewerId` differs, and it has to — the
    landing page passes `""` because a stranger is nobody in this league.
  - **`hiddenPickUserIds` is populated in preseason now**, because
    `load.ts` used to skip the `hidden_picks_for_week` RPC on
    `phase !== "preseason"` outright. `resolveCurrentWeek` returns 1 all
    preseason, so the call asks for regular-season Week 1 — and without it a
    member who picked Week 1 early draws a hollow "No pick" circle rather than a
    padlock, and `rankMembers` buckets them `none` and sorts them BELOW people
    who have not picked at all. `public_league_snapshot` (0009) always computed
    the flag in every phase, which is exactly why the landing board already had
    those padlocks and the signed-in table did not.
  - **No migration, which is unusual here.** `hidden_picks_for_week` has existed
    since 0006, is `security definer` gated on `is_group_member(p_group_id)`,
    is granted to `authenticated` alone, and returns user_ids with no team
    attached. The same flag is already published to anonymous visitors by 0009,
    so showing it to members of the league is strictly less exposure.
  - **The visible `SectionHeader` went and an `sr-only` "Standings" replaced
    it.** It read "Practice Standings", which is a lie about the regular-season
    table now directly beneath it. The paragraph's `mt-2` went with the header it
    was spacing away from; `mb-4` stays as the seam down to the table.
  - **A blank board is not filler.** Every row is somebody who has joined, and
    the Week 1 column shows who has already picked — which is the whole question
    while entry is open. Note what makes this state the COMMON one rather than an
    edge case: 0011 adds `show_preseason` as `not null default false` and no
    join/create RPC sets it, so **every member who joined after 0011 was applied
    has practice off** until an admin turns it on for them.
  - **That default is deliberate, and it is not a bug to go and fix.** 0011 says
    so where the column is declared: "joining a league should not silently enrol
    you in a practice game, and the admin turning it on per player is the
    decision this implements." Practice is opt-in per member, by admin action.
    The one-time backfill to `true` beside it is grandfathering — it keeps
    existing members of a league still in preseason from being evicted the day
    the migration lands — and `default false` governs everyone who joins from
    there on. Read the backfill as evidence that "on" was the intended default
    and you will go looking for a defect that does not exist; this entry
    previously did exactly that. The rationale block above the column definition
    is the primary source, and it is worth reading before theorising about this
    flag at all.

- **The standings page opens on a league header, not four grey tiles.**
  `LeagueDetails` was League / Current week / Survivors / Rules as four tiles on
  a soft-grey card; it is now the league's name set large beside its money, its
  headcount and its two actions. Figma `4181:154890`; page `4082:139343`
  (desktop) and `4158:150123` (mobile). Nine things:
  - **The week and the survivor count are not missing, they moved down.** The
    `Headcount` card directly below already prints "W6" and "29 still standing",
    which is what that card is for, and keeping them here would put the same two
    numbers on one screen twice.
  - **DOM order is the mobile order and the desktop layout falls out of it.**
    Two column divs rendered once, `flex-col` below `lg` and `lg:flex-row
    lg:gap-5` above it, which stacks them full-width into exactly the mobile
    frame's sequence. Nothing is rendered twice, so no branch can drift.
  - **`Label` renders a `<span>`, and in a plain block that costs 12px.** An
    inline span's line box takes the PARENT's strut — 24px off the page's 16/1.5
    body type — not its own `leading-none` 12, so the name module came out 12px
    tall at both widths until it became a `flex flex-col`. Blockified as a flex
    item it measures itself, and the module lands on the frame's 76.4. The tiles
    this replaced were flex columns and never hit it. Measured, not reasoned
    about: 88.4 before, 76.4 after, against a frame that says 76.
  - **The title is `H4` with one override, not a third constant.** The design
    library's H4 and H3 differ by nothing but size, so desktop is
    `cn(H4, "lg:text-[32px]")`. Both are `-0.04em`, so the tracking follows the
    size for free — a transcribed `-0.96px`/`-1.28px` pair would not.
  - **It is the page's `<h1>`, which the page did not have.** `/app/standings`
    carried two `sr-only` `<h2>`s ("Standings", "Grow the League") hanging off
    nothing. The league's own name is the honest title.
  - **"Winner takes" is derived and nothing stores it.** `buyInCents ×
    memberCount`: `siteFeeCents` is the site's cut charged on top, so the pot is
    the buy-in alone. No migration — the alternative was a column, and a column
    here would be a hand-applied migration for a number that is already implied.
  - **The invite row hides once entry closes**, matching `InviteCta` further
    down the page: the code still exists but `join_by_invite` refuses it. That
    can leave the desktop's second column holding only "Rules", which is fine.
  - **Rows are `min-h-[34px]`, not the frame's fixed height.** A clipboard
    failure swaps "Copy Link" for the invite code — the same reveal `InviteCta`
    makes, and the only way to the link when the code is nowhere on screen — and
    a fixed height would clip it. Both halves are `flex-1 min-w-0`, which is what
    stops a `whitespace-nowrap` value refusing to shrink and blowing the column
    out.
  - **`phase` and `currentWeek` left the props rather than going unused**, and
    `appUrl`/`now` arrived for the invite row. `members: Member[]` became
    `memberCount: number` — only the length was ever read.

  Measured in Chromium at 1440: the block is **1000 x 102**, children 490 /
  235 / 235 at gap 20 (the frame's 490, +510, +765), name module 490 x 76.4,
  h1 32px/38.4px/-1.28px/600 `#1E1E1E`, label 12px `#757575` uppercase, row 34
  tall with 6/2 padding over a 1px `#D9D9D9` rule, value 16px/21.6px/-0.16px/600,
  link 16px `#151E9D`/500. Under mobile emulation at 393: **361 x 236.8** against
  a frame that says 237, one column, five rows, title 24px/28.8px/-0.96px.

- **The status report is the HEADCOUNT now, and its one row of proportional bars
  is a wrapped grid of equal squares.** `StatusReport` → `Headcount`,
  `SurvivorStrip` → `HeadcountGrid`, `statusLine` → `headcountLine`,
  `StatusLineInput` → `HeadcountInput`, and `PublicLeagueData.status` →
  `.headcount` (that file already used `status` for a game's and a member's).
  Figma `3720:40767` (desktop), `4118:147326` (mobile), cube atom `3746:39826`.
  Sixteen things:
  - **No cube may sit alone on the last row, and that rule is why there is JS
    here at all.** CSS can *compute* a column count — `round()`, `mod()`, `cqw`
    — but it cannot branch on one, so the size is solved against the measured
    width in `headcount-grid.ts` (pure, tested) and applied by `HeadcountGrid`.
    The solver walks the integer sizes in range nearest the design's base first
    and takes the first whose column count clears `count % columns === 1`.
  - **The two size ranges encode the direction of travel, so the solver needs no
    grow-or-shrink rule.** The phone's base IS its max (16, floor 12) so a phone
    cube can only shrink; the desktop's base IS its min (24, ceiling 30) so a
    desktop cube can only grow. There is a test asserting exactly that, because
    a future range straddling its base would make the tie-break load-bearing
    overnight.
  - **`count > columns` in the orphan test is not a micro-optimisation.** Without
    it a one-member league — one cube, alone by necessity — reports an orphan at
    every size, exhausts the range and lands on the fallback for a row it was
    never going to share.
  - **The width comes off the ResizeObserver entry, and BOTH halves of that
    matter.** It is a layout box, where `getBoundingClientRect()` is the
    transformed one — the landing page wraps this section in `blur-in`, which
    starts at `scale(1.04)`, so a rect read mid-animation is 4% wide and buys an
    extra column. That is `readColumns`/`offsetTop`'s lesson in a second place.
    And it is FRACTIONAL, where `clientWidth` is rounded: `columnsFor` restates
    CSS Grid's own `auto-fill` formula, so on the real number our count and the
    browser's cannot disagree, and on a rounded one they can. `clientWidth`
    survives only as a last-resort fallback.
  - **The measured template is explicit — `repeat(N, …)`, never `auto-fill`.** A
    browser allowed to reach its own count could reach one more than the solver
    did and put the lone cube straight back. Its `minmax(0, …)` is belt and
    braces on the same edge: given a width the tracks cannot quite fit they
    shrink together instead of overflowing. An overflow breaks out of the card's
    fill at any width, and at `lg` — where `main` keeps no horizontal inset to
    absorb it — it reaches the document.
  - **`auto-fill` IS the other template, and it is not a placeholder.** The
    class-based `repeat(auto-fill, var(--cube))` is what the server renders, what
    paints before hydration, and what a browser whose JS never arrives keeps —
    and because `auto-fill` reaches the browser's own count from the true width,
    it is already the design's size at both widths. Only a genuine orphan ever
    moves off it. Measured with JS disabled: 20 columns of 16px at 393 and 37 of
    24px at 1280, identical to the solved pass. A much softer failure than
    `TeamGrid`'s blank-if-JS-fails trade.
  - **The cube takes its width from the track and its height from
    `aspect-square`**, so the two cannot be handed different numbers — including
    on a track `minmax` has shrunk. Do not add a fixed row height; it would
    un-square exactly that case.
  - **`HeadcountGrid` is the only file that takes `"use client"`.** The label row
    stays a Server Component, which is what keeps `lib/league/view.ts` — and the
    whole ranking apparatus it imports — out of the landing page's client bundle.
    `/` still builds as `○` with `Revalidate 1m`; the boundary cost it nothing.
  - **Which range applies is `matchMedia("(min-width: 1024px)")`, not a width
    test.** Below `lg` the grid is full-bleed, so its own box IS roughly the
    viewport, and a width threshold would read a 990px browser window as a
    desktop. It is a listener, not a one-time read: measured live, 1023 → 1025
    with no reload steps the cube 16 → 24.
  - **The percentage is the share ELIMINATED, and it is drawn in accent where the
    muted half used to be.** `percent` is `round(eliminated / total)`, guarded so
    an empty league reads "0%" rather than "NaN%". The pre-season has no Type 2
    frame; it prints "N joined" and no percentage at all, because the only number
    that branch could carry is zero. Every trailing period in the old copy is
    gone, and there is a test that walks the returned strings asserting so.
  - **"W6" is drawn at BOTH widths now, so the old `sm` text swap is gone — but
    the pair isn't.** The desktop frame carries "W6 Headcount" too. The
    abbreviation names nothing out loud, so the drawn form is `aria-hidden` and
    the long one is `sr-only` at every width: the page shows "W6 Headcount", a
    screen reader hears "Week 6 Headcount". `percentLabel` does the same job one
    line down — a bare "54%" beside "29 still standing" names neither of them, so
    "34% eliminated" is what gets spoken. This component now has exactly one
    breakpoint, `lg`, where it used to have two.
  - **Still-standing cubes come FIRST, and the two frames disagree about that.**
    The desktop frame draws eliminated-first (which is what the bars did); the
    mobile frame draws alive-first. One grid cannot do both. The user's call was
    alive-first, so the orange block leads and the grey trails — which also puts
    the block "29 still standing" names at the start of the reading order.
  - **The ~59-member 1px limit is retired, and so is its recorded fix.** Those
    bars fell below one CSS pixel at roughly 59 members at 390px and their gaps
    ate the whole track past ~87; the note proposing a two-segment proportional
    bar above a ~48 threshold went with them, because a cube is 12-30px whatever
    the count and the ratio is no longer approximated. The new limit is height:
    rows are `ceil(count / columns)` at `size + gap` each, so ~21 members per
    phone row and ~37 per desktop row, and a 500-member league is ~25 rows.
    Linear and visible, rather than silent.

  - **It is a CARD now, and that ended the full-bleed contract it used to
    carry.** `rounded-control bg-fill-soft` (#F3F3F3 at 8px, the design's
    `General Card BG` and `Radius/small`), 12px of padding all round on a phone
    and 16 at the sides and foot from `lg`, where the top stays 12. It fills the
    content column at both widths and bleeds nowhere: no `-mx-4`, no host `px-4`
    contract, and it came off that list in the page-layout section above.
  - **The section root IS the card, so a host must not pass `px-*`.** The
    landing page did — `className="px-4 pb-2 sm:py-3"` — and that string would
    now pad the INSIDE of the fill rather than sit the card in from the page, so
    that host wraps it in a `px-4` div instead and passes only the vertical.
    `StandingsClient` passes only `mt-*`, which is the rule everywhere else.
  - **The 2px is inside the card now, not against the viewport.** The mobile
    frame insets its grid 2px within the card's own 12px, and the desktop frame
    does not — `px-0.5 lg:px-0`, on the wrapper rather than on the grid so the
    grid's measured box stays the box the solver lays out into.

  Measured in Chromium: at 1440, the card is **1000 x 127** for 104 cubes —
  exactly the frame — with 37 columns of 24px, gap 2, padding 12/16/16/16,
  `#F3F3F3` at radius 8, label row `flex-start` at gap 12 over a 4px section gap,
  heading 600/14px/16.8px/-0.28px `#1E1E1E`, details 500/14px/18.9px/-0.14px,
  percent `#FC5F38`. Under mobile emulation at 393 the card is **361 x 157** —
  also exactly the frame — 18 columns of 16px in a 333px grid inset 14 from the
  card edge (12 padding + 2), label row `space-between` over an 8px gap. 38 cubes
  at 1440 shrink to 23px in 38 columns, one row; 19 cubes at 393 GROW to 17px in
  17 columns, which is the tie-break firing. `document.scrollWidth ===
  window.innerWidth` at 320 / 360 / 375 / 393 / 430.

  The hosts' seams moved with it: `StandingsClient` is `mt-6 lg:mt-[30px]` above
  the card and `mt-16 lg:mt-14` below it, all four measured box-to-box off the
  page mock-ups rather than ink-to-ink, because the card owns padding on both
  sides now.

- **The signed-out header is the same pill as the signed-in one, and the mirror
  that was deliberately broken is deliberately restored.** `LandingHeader` was a
  full-width bar with a `border-b`, a 50px rounded-square mark, an "SWG"
  wordmark and two identical outline buttons pushed right by
  `justify-between`. It is now a centred floating card — `rounded-card`,
  `border-shell-line/50`, `bg-white`, `shadow-[0_6px_6px_rgba(0,0,0,0.08)]` —
  holding a 40px circular mark, a black "Log In" and an outlined "Enter Invite
  Code". Figma `4077:129623` (desktop) and `4077:136249` (mobile). Its docblock
  used to argue at length that the mirror with `AppHeader` was broken on
  purpose and not to restore it "without a signed-out frame asking for it" —
  the frames asked. Ten things:
  - **`Modal` does NOT portal, and three separate rules follow from that.**
    `LogInButton` / `InviteCodeButton` each return a fragment of a `<button>`
    and a `Modal`, and `Modal` renders a bare full-viewport fixed div inline —
    unlike `Drawer` and `Toast`, which both portal to `document.body`. So the
    dialog is a DOM descendant of the pill:
    - **The shadow must stay `box-shadow`.** Figma draws `drop-shadow`, and a
      `filter` makes its element a containing block for `fixed` descendants —
      which would pin the login dialog inside the 58px pill. `HeaderNav` refuses
      the same filter for the *weaker* reason (it has no fixed descendant); here
      it is a real bug, and `landing-header.test.ts` pins it.
    - **`pointer-events` reaches the dialog by INHERITANCE.** The header takes
      `none`, the pill `auto`, and the dialog inherits `auto` *from the pill*.
      Hoisting the modals up to the header to tidy the tree would leave them
      inheriting `none` — a full-screen dialog nobody can click, with nothing in
      the console. Measured: `getComputedStyle(dialog).pointerEvents === "auto"`.
    - Sticky plus `z-30` makes the header a stacking context, so the dialog's
      `z-50` now resolves INSIDE it. Harmless today — nothing else on `/` goes
      above `z-20` (`StandingsGrid`'s sticky first column) and the landing
      wrapper is unpositioned — and a trap the day something there wants `z-40`.
  - **It is sticky, where it sat in flow for its whole life.** The old argument
    was "the page is short"; it isn't — it carries the status band and the whole
    standings table — and a floating pill only reads as floating if something
    passes behind it. That is what makes `pointer-events-none` load-bearing
    here, exactly as on `AppHeader`: the band spans the full shell while the
    pill draws 338 of it. Measured at 393x380 with the page actually scrolling:
    `elementFromPoint` in the gutter returns the title `<section>`, not the
    `<header>`, while the pill still catches its own clicks.
  - **The safe-area inset rides on the `<header>`, and `/app`'s answer does not
    transfer.** `/` is reachable inside the installed PWA — the manifest is
    `start_url: "/app"`, `scope: "/"`, `display: standalone`, and middleware
    bounces a signed-out visitor off `/app` to here — so it renders under the
    status bar with the root layout on `viewportFit: "cover"`. `/app` puts
    `pt-[env(safe-area-inset-top)]` on its page WRAPPER, which works there only
    because its header is not the pinned thing; on a sticky element that clears
    the bar at scroll 0 and rides up under it afterwards. `PickStickyBar` is the
    precedent that transfers — the inset goes on the pinned element. It must NOT
    also go on `page.tsx`'s wrapper: that counts it twice, the trap
    `--tab-bar-h` already documents.
  - **74px, not `HeaderNav`'s 70, and that is off a frame rather than a copy
    error.** This design pads evenly (`py-2`); the signed-in row is `pb-1 pt-2`.
    Nothing reads either number — no `--header-h`, no `scroll-mt`, nothing
    anchored to a header foot in `src/`. The visible consequence is that the
    title block sits 11px lower than before (the old header was 12 + 50 + a 1px
    rule = 63). `bottom-tab-bar.test.ts` already has a test whose whole subject
    is that a 4px difference between two otherwise-identical pills is the most
    likely silent copy error, so this one is pinned too.
  - **`gap-3` and `px-2` buttons, against the signed-in pill's `gap-1` and
    `px-4`.** These are the design's `size=Small` control — 36px at 14px — not
    its 40px/16px nav button. Three deliberate divergences on one card.
  - **There is no `lg:` step anywhere in the file**, which is the one way this
    surface is simpler than the signed-in pair: the mobile and desktop
    signed-out frames are the same pill, and only the outer row padding differs
    (12 vs 16), which is inert for a centred pill. The only width-keyed classes
    are the narrow escapes below. There is a test asserting the absence.
  - **The `min-[375px]` hatch is `BottomTabBar`'s, on the same pill for the same
    reason.** The frame's `min-w-[100px]` only holds from 375 up. Measured in
    Chromium with the real self-hosted Inter, at 320 / 360 / 375 / 393 / 768 /
    1023 / 1024 / 1280: header 74 at every width, pill **338 x 58** from 375 up
    and **297 x 58** below, children 40 / 100 / 140 and 40 / 59 / 140. Only
    "Log In" moves — "Enter Invite Code" measures 140 and the floor never bound
    on it. `document.scrollWidth <= innerWidth` at all eight. The header is a
    SIBLING of `<main>`, so `main`'s `overflow-x-clip` does not cover it and an
    overflowing pill would produce a document-level scrollbar — which is
    precisely the 375px failure this file's docblock recounts.
  - **The blur is still not transcribed, and there are now three reasons.** Only
    the DESKTOP signed-out frame carries `backdrop-blur-[4px]`; the mobile
    signed-out frame and both signed-in frames don't. On the pill it is dead CSS
    (nothing shows through an opaque fill). On the band, where Figma actually
    puts it, `backdrop-filter` captures `fixed` descendants by the same rule as
    `filter` — so it would trap the dialog. And it would make this the app's only
    frosted chrome, against the split recorded above. Measured `filter` and
    `backdropFilter` both `none`.
  - **`alt={APP_NAME}` on the mark, not a sibling `sr-only` span.** With no
    wordmark and no link, the image is the only place this chrome names the app,
    and `alt` is exactly that. It also retires a comment that was wrong: the old
    file claimed an `sr-only` element "would still reserve 12px beside it" under
    a gap, but `sr-only` is `position: absolute`, so it is not a flex item and
    takes no gap at all.
  - **36 drawn, 44 tapped, and that one IS beyond the frame.** `after:inset-x-0
    after:-inset-y-1`, on `BottomTabBar`'s argument rather than `AppHeader`'s:
    this surface draws on phones. The 4px each way lands inside the pill's own
    `py-2` so it cannot overhang, and extending only on the y-axis keeps a
    button off its neighbour's taps.

- **The standings table is one component drawing three surfaces, and both its
  order and its cells were rebuilt.** `StandingsGrid` is still the only `<table>`
  in the repo: the signed-in regular table, the preseason practice table
  (`StandingsClient`) and the anonymous landing board (`PublicStandings`) all
  render it, so anything changed there lands on all three at once. Figma: sample
  `3971:95276`, row `3956:89448`, header `3986:112647`, live-week header
  `3971:90737`, tile atoms `3956:88721`. Thirteen things:
  - **`rankMembers` takes a `RankContext` now, and rank is a fact about the
    LEAGUE rather than about the viewer.** The living sort on four keys in this
    order: bucket, then team bundle, then strikes, then name/id. The buckets are
    how their current week is going — won, live, picked, no pick, lost.
    `pickSignals` derives all of it through `viewCurrentPick` with an **empty
    viewer id**, so nobody's own pick counts as revealed early. Pass a real one
    and your row would sort on information no other row was sorted on, and two
    players looking at the same table would see different orders. It is the one
    place in the app that deliberately declines the viewer's own privilege.
  - **Inside a bucket, everyone on the same REVEALED team is bundled, biggest
    bundle first.** Five Raiders backers, then four Rams, then two Saints — so
    the week reads as the league's consensus rather than as an alphabetical
    list. Four things about it:
    - **It outranks strikes.** A bundle broken up by strike count is not a
      bundle. Strikes still order members *within* one.
    - **It keys on `revealed`, never `hasPick`.** An un-kicked pick is real but
      secret, and clustering on it would leak the team through the row order —
      neighbours would be neighbours BECAUSE they share a pick, which is the
      fact the padlock exists to hide. A hidden pick carries no bundle and sits
      after every bundle in its bucket.
    - **Equal-size bundles order by TEAM ID, not by their members.** A member
      key would let one player joining or leaving reshuffle bundles that did not
      change. This is why the tie-rule test expects `gb` before `kc`.
    - **Counted over the living only, and never across buckets.** The dead are
      not in a bundle, so their picks cannot inflate one; and a big bundle in a
      later bucket never outranks a small one ahead of it, because bucket is
      still the first key. (A team's game has one status, so everyone backing it
      lands in one bucket anyway — a league-wide count and a per-bucket count
      agree, and counting once is simpler.)
  - **A hidden pick sorts as `picked`, and that needs `hiddenPickUserIds`.**
    Under RLS a rival's un-kicked pick reaches the client as nothing but the
    team-less flag, so without reading it someone who HAS picked buckets as
    someone who has not. Nothing leaks which team — "has selected a team" is
    exactly what the bucket means, and the bundle key is null for them.
  - **The eliminated block is frozen, and that is the feature.** Dead members
    stay below every living one, ordered by `eliminatedWeek` descending. The
    living block only shrinks, each new casualty stacks onto the TOP of the dead
    block, and nobody already out ever moves again — so scrolling down in week 15
    reads the league's history backwards, ending on whoever went out first. This
    branch is unchanged from the old sort; what changed is that it is now
    load-bearing rather than incidental. It also makes "losers last" and the
    freeze agree rather than compete: a member eliminated THIS week carries the
    highest possible elimination week, so they land directly under the living.
    **The dead take no bundle key**, deliberately — their order is a positional
    guarantee, and any secondary key would break it the week a team's backers
    shifted.
  - **`PICK_BUCKET` and `pickSignals` live in `lib/league/view.ts`, not beside
    the grid's other pure helpers.** They read the same week through the same
    `viewCurrentPick` and look like they belong in `standings-grid.ts` — but that
    module imports `view.ts`, so the reverse import is a real cycle. `lib/` never
    depends on `components/`; `RankedMemberView` exists for the same reason.
  - **Signals are derived once per member into a Map, not inside the
    comparator.** A comparator body runs O(n log n) times and `viewCurrentPick`
    walks the game index on every call. `pickSignals` returns the bucket and the
    revealed team TOGETHER for the same reason — they come off one `PickView`,
    and deriving them separately would walk that index twice per member.
  - **A LOSS stays tinted for the rest of the season; a WIN is tinted only in the
    week being played.** That asymmetry is `cellFor`'s and it is what makes the
    frozen table readable: a red tile is the week somebody took a strike, while
    green on every survived week would be a wall of colour saying nothing. A
    settled push reads untinted like a win — it survived — and a tie in a league
    that counts ties as losses arrives in `history` as a loss already.
  - **A win has a fill at all for the first time.** The old grid painted `""` for
    a win and washed only loss/push/live, so the legend had no swatch to explain.
  - **`gameForTeam` is still consulted ONLY for `week === currentWeek`**, in
    `cellFor` and now in `rankMembers` too. The landing page narrows its `games`
    payload to that single week on the strength of it, so a lookup for any other
    week returns undefined THERE while the signed-in app — which holds the whole
    season — carries on looking correct. Both modules have a test asserting which
    weeks the index is asked for.
  - **Rows are zebra-striped off the RENDERED index, and the viewer's row takes
    `ink-wash` INSTEAD of its stripe.** One class from one ternary: every fill
    lands in tailwind-merge's single background-colour group, so emitting two
    silently drops one by argument order. All three are opaque because the row's
    first cell is sticky. `ink.wash` is `#6B7280` at 12% resolved at build time
    (`#EDEEF0`), `fill.stripe` is `#F8F8F8` — its own token rather than
    `fill.raised` `#FAFAFA`, because two units is legible in a table of
    alternating rows.
  - **An eliminated row is NOT faded, and the "Out" chip is gone.** The
    component set has 20%-opacity and red-tinted variants; the user's call was
    that position carries it — the frozen block plus the red tile on the week
    they went out. Position is unavailable to a screen reader, so the row carries
    an `sr-only` "Eliminated" instead. The 146px name column has no room for a
    chip at 48px rows anyway.
  - **The table opens on the live week.** `scrollLeftForWeek` parks the scroller
    so the accent-chipped column clears the 146px sticky edge — by week 10 it is
    otherwise off the right edge on a phone. Assigned directly, never smooth:
    this is where the table STARTS, not a movement, so there is no motion for
    `prefers-reduced-motion` to reduce. It is a plain effect rather than a layout
    one, because the auto table layout has to settle before the offsets are real.
    It takes a column INDEX, not a week number — the practice table's columns are
    P1..P3 followed by previewed regular weeks, where week numbers are neither
    unique nor ordered.
  - **`NAME_COL_W` / `WEEK_COL_W` are constants because the scroll arithmetic
    reads them.** Header and body cells share the table's columns, so alignment
    is structural — but the scroll lands a column-width off if either drifts from
    the class, and nothing would throw.

- **The desktop header is a centred floating pill, and it renders the same three
  destinations as the phone's bottom bar.** Figma `4048:60997`, button
  `4048:61019`. `AppHeader` is now a positioning wrapper and nothing else —
  `sticky top-0 z-30 hidden lg:block` — and `HeaderNav` draws the whole of it:
  the app mark as a 40px circle, then Picks / Standings / Account as `h-10
  min-w-[100px]` text buttons, inside a `rounded-card border border-shell-line/50
  bg-white` pill with a `shadow-[0_6px_6px_rgba(0,0,0,0.08)]`. Seven things:
  - **The header carries no background any more.** It was `bg-bg/[0.12]
    backdrop-blur-sm` across its full width; the pill has its own fill now and
    everything around it is transparent, so page content scrolls through the
    gutters and vanishes behind the pill. Same floating-pill reading
    `BottomTabBar` takes at the other edge. The whole `bg-bg/[0.12]`-not-`bg-bg/12`
    paragraph went with the fill it described.
  - **The pill is OPAQUE, and `BottomTabBar` and `LandingHeader` are the same
    card at the other edge and on the front door — `PickStickyBar` is the one
    frosted surface left.** Figma puts
    `backdrop-blur-[4px]` on a `bg-white` fill, where it cannot show through;
    the blur is dropped rather than shipped as dead CSS, and the border plus the
    shadow are what make it a card rather than glass. Deliberate, and confirmed
    with the user — the app now has both treatments on purpose.
  - **`box-shadow`, not Figma's `drop-shadow` filter.** Indistinguishable on an
    opaque rounded rectangle, and a `filter` would make the pill a containing
    block for fixed descendants and a stacking context for nothing.
  - **`HeaderNav` returns ONE element now**, where it used to return a fragment
    of two so `AppHeader`'s `flex-1` rails could centre a pill on the shell's
    true midpoint. That whole apparatus — the rail formula, the 218px pill, the
    356px intrinsic row, the wordmark's `min-[480px]` breakpoint, the account
    circle's `after:-inset-[3px]` tap ring and the dot's `-0.5` padding-box
    offset — is gone, because `justify-center` on one pill replaces all of it.
  - **`TABS` is gone and `BOTTOM_TABS` is now `NAV_TABS`.** The two-item list
    existed only while desktop pulled Account out as a round button and mobile
    carried it as a peer; both navs draw the same three now, so one list, and a
    name that is not a lie about which surface uses it.
  - **The wordmark is gone from the signed-in app entirely** — the variant is
    "Logged in - Minimal" and mobile has no header — so `APP_NAME` survives in
    the chrome only as the mark's `aria-label`. `APP_SHORT_NAME` outlived this
    by one redesign — `LandingHeader` still read it — and is **gone now**: the
    signed-out header dropped its wordmark too, taking the acronym's only reader
    with it, so the export and its docblock were deleted rather than left
    behind. Both marks name the app themselves now: this one through its link's
    `aria-label`, the signed-out one through the image's `alt`, because that
    mark is not a link.
  - **The transparent bar would have swallowed clicks, and the fix belongs one
    level up from where it looks like it does.** The `<header>` spans the whole
    1000px shell while only its middle ~400px is drawn, so the band beside the
    pill reads as live content; `pointer-events-none` on the header with `auto`
    on the pill lets clicks through. That is `Toast`'s argument (a full-width
    positioner around a small card), not `PickStickyBar`'s (which swallows taps
    *because* it is the full-width opaque surface). That is not a rule about
    shape: `BottomTabBar` is also a positioner around a small pill and it
    swallows anyway, because its undrawn band is ~28px at the bottom edge and a
    fall-through there spends a team. Pass through when the dead band is large
    and what is behind it is plainly live; swallow when it is small and costly to
    hit. Putting it on the row inside
    the header does NOT work — `elementFromPoint` in the gutter still returned
    the `<header>`, because a parent receives what its `none` child declines.
    Measured, after the first attempt got it wrong.
  - **The `<nav>` scopes to the three buttons; the pill is a plain div.** The
    mark links to `/app` and so does the Picks button, so wrapping the whole pill
    in the landmark would put two links to one destination inside it, one
    `aria-current="page"` and one not. The old header had the mark outside the
    `<nav>` and this keeps that true, at the cost of one extra `gap-1`.
  - **Beware the comment scanner here.** Rewriting this header left four class
    names alive only in prose — and removing the account circle orphaned a fifth
    in `BottomTabBar` — each shipping a real rule, because `content` is
    `./src/**/*.{ts,tsx,mdx}` and Tailwind scans comments. Describe a class you
    do not use; never spell it.
  - **The header is 70px now, and nothing noticed.** Verified by search rather
    than assumed: no `scroll-mt`, no `--header-h`, no `top-[…]` offset anywhere
    in `src/` reads it, and `main`'s `lg:pt-16` comes from the mockups' page
    rhythm rather than from the header. The one real cost is that the account
    control drops from a 44px tap area to the 40px its two neighbours already
    had — a pointer-driven desktop surface, and now consistent with them.

  Measured in Chromium at 1280×900 with the real self-hosted Inter: header
  1000 × **70**, pill **395.9 × 58** (the frame says 397; Chromium renders
  "Standings" 1.1px narrower than Figma and the pill hugs its content), children
  40 / 100 / 109.9 / 100 at `gap-1`, shadow `rgba(0,0,0,0.08) 0px 6px 6px`,
  `backdropFilter: none`, rest `#757575` → hover `#1E1E1E` → selected black on
  `#F3F3F3`, dot 12px `#CD1411` inset 2/2. At 1023px the header is
  `display: none` and nothing about mobile moved.

- **The My Picks page has a second, condensed pick module that pins to the top
  of a phone once the real one scrolls away.** `PickStickyBar` — 89px, the
  eyebrow over a 51px row of [three team-colour strips with the logo centred on
  them] [city / team name] [rule] [matchup / date / kickoff]. It slides in the
  moment `PickHero`'s bottom edge passes the top of the viewport, slides out on
  the way back, is `lg:hidden`, and **renders nothing at all when the week has no
  pick**. Not tappable. Figma `4042:123420`. Nine things:
  - **It MUST portal, and the usual reason is the weaker of two.** The familiar
    one is that `.stagger > *` hands every direct child `reveal-up` at an
    `:nth-child` delay, so a fixed root would sit invisible through its own
    slide. The harder one: that animation's fill-mode is `both`, so a transform
    is applied to every direct child for the life of the page — and **any
    non-`none` transform is a containing block for `position: fixed`
    descendants**. So a fixed element anywhere in the `.stagger` SUBTREE, not
    merely a direct child, is pinned to a page block instead of the viewport.
    Measured in Chromium at 393×852: a `fixed inset-x-0 top-0` element rendered
    inside `.stagger` reports `top: 12`, where the portalled one reports `top:
    -90` (correctly off screen). That disposes of "render it inside the grid's
    `mt-4` wrapper to avoid renumbering the delays", which otherwise looks
    clever.
  - **An `IntersectionObserver`, the app's first, chosen over the ScrollTrigger
    already in this route's bundle.** The reason is that **ScrollTrigger caches
    start positions and IO caches nothing**. `use-card-reveal.ts` measures what
    that costs inside `.stagger` — starts 12px low, cards masked indefinitely
    without a manual `refresh()` wired to an `animationend`. The same 12px settle
    is visible in this bar's own trace and IO simply re-evaluated through it. The
    hero also genuinely moves after first paint here, because the preseason
    banner mounts and unmounts above it. **Not** an argument for it: reduced
    motion, which is a property of how you animate rather than how you detect
    scroll.
  - **The predicate is one clause — `rect.bottom <= 0` — and it is pure and
    tested.** `!isIntersecting && top < 0` says the same thing only while the
    module is shorter than the viewport (242 against ~852). `heroScrolledPast`
    in `pick-hero.ts` is the literal transcription instead.
  - **A CSS transition, not a keyframe pair, and the reason is INTERRUPTION.**
    The trigger is a position the thumb oscillates around: a class-swapped
    animation restarts from its first keyframe on every class change, so
    re-crossing mid-slide snaps the bar off screen and replays. A transition
    reverses from wherever it is. `Drawer` and `Toast` need keyframe pairs
    because they mount and unmount and the element has to survive its own exit;
    this one is mounted continuously. Their 320/280 asymmetry is still honoured,
    stated per branch rather than as a reversed direction — which would reverse
    the easing with it.
  - **`ref` is a plain prop on `PickHero` (React 19, no `forwardRef`), and the
    caller holds it in STATE via a callback ref.** That is correctness, not
    style: stepping between a picked and an unpicked week swaps `Shell` for
    `NoPickHero` at the same position, so React replaces the `<section>` DOM
    node, and a `useRef` plus a mount-once effect would leave the observer
    watching a detached element forever. Rejected alternative: wrapping
    `<PickHero>` in a ref'd div. It does not renumber anything (it replaces
    PickHero in the slot rather than adding one) — but it would move `reveal-up`
    onto the wrapper and quietly falsify the "its root `<section>` is a direct
    `.stagger` child, so remounting replays `reveal-up`" comment that the no-`key`
    rule rests on.
  - **`aria-hidden`, permanently, and legal only because nothing inside is
    focusable.** Every string is a verbatim restatement of `PickHero`, which is
    not removed when this appears — only scrolled above the fold — so it is still
    in the tree with the same six strings. Portalled to the end of `body` while
    painting at the top of the screen, it would also read detached from what it
    describes. **If it ever becomes tappable the `aria-hidden` must come off**;
    there is a test pinning the pair, and another stopping the team name becoming
    a heading element (a duplicate of the hero's `<h1>` would corrupt
    heading-jump navigation the moment it were exposed).
  - **No `pointer-events-none`, and that INVERTS `Toast`.** Toast disables them
    because it is a full-width positioner around a small card. This *is* the
    full-width surface, and a tap falling through it lands on a team card the
    reader cannot see — which on this page spends a team for the season. It
    swallows taps. Off screen it is unhittable regardless.
  - **The fill is `bg-bg/80` behind a 4px blur, and it is the PAGE colour, not
    white.** #FDFDFD at 80%, so the grid reads faintly through it — the same
    family as `AppHeader`'s old `bg-bg/[0.12]`. It was briefly the exact pair
    `BottomTabBar`'s track took at the other edge of the same screen; that bar is
    the desktop header's solid white pill now, so **this is the only frosted
    surface left**, and the picks screen carries a translucent bar at the top
    with a solid pill at the foot. Decided, not drifted into. The blur still sits
    on this element's own rounded box, so it clips to the radius with no
    `overflow` involved. It arrived together with the matchup
    block going from #858585 at 14px to **`shell-ink` at 12px**, and the pair is
    the point: at #858585 that line measured 3.5:1 on solid white and would have
    lost contrast the moment the fill let the page through. Note `80` IS on
    Tailwind's opacity scale where `12` is not — `bg-bg/12` compiles to nothing,
    which is the trap the old header's own fill carried an arbitrary value for.
  - **The row's 51px is the matchup stack's own height (3 × 12px at 1.4), and it
    is still stated rather than derived.** So is the column's 89 — the frame
    declares it and centres a 67px container in it. Both were `py-*` with a
    content-driven height for one revision, and when the matchup block dropped
    from 14px to 12px the bar silently shrank to 83. The height is also the slide
    distance, so exactly one thing is allowed to decide it.
  - **`tracking-[-0.01em]` did not have to change when that size did**, and a
    `-0.14px` would have. Figma reports letter-spacing as percent × 100, so `em`
    IS the percentage and survives a size move; px is a conversion to redo. The
    reason `type-scale.ts` and `surfaces.tsx` both insist on it, demonstrated.
  - **The bar measures 90px, not the frame's 89.** `border-b` sits outside an
    auto height even under `border-box`; the content column is exactly 89. A
    known, accepted 1px — spell the hairline as an inset shadow if it ever has to
    be exactly 89.
  - **`w-max` on the logo wrapper is PROPHYLAXIS here, not load-bearing**, and
    that is measured rather than assumed. It and `TeamLogo`'s baked-in
    `max-w-none` are redundant: all four combinations at this geometry
    (36-in-44) and at `PickHero`'s (80-in-68) give 36/36/36/22 and 80/80/80/68 —
    **only removing BOTH** reproduces the squash-and-offset. Kept because it
    costs nothing and a future call site could drop `TeamLogo` for a bare
    `<img>`. Do not describe it as load-bearing; `PickHero`'s case is the one
    where the trap actually fired.

  Two things moved into `pick-hero.ts` to get there, and both are tested for the
  first time: `matchupLine` (the "vs."/"@" convention and the `TBD` fallback —
  **not** `team-grid.ts`'s `matchupLabel`, which prints "Home vs. Ravens";
  named apart deliberately) and `resolvePick` (the one definition of "there is a
  pick to draw", so the bar cannot claim a pick the hero is drawing as "No Pick
  Made"). The bar takes `matchupLine`'s `long` form — `abbr + name`, "vs. LAC
  Chargers" — because that is already how the team cards on this same page read,
  and `location + name` overflows the matchup column below 360px.

- **`pick-hero.ts` has value imports now, and they are RELATIVE on purpose.**
  There is no `vitest.config.ts` in this repo, so vitest never reads tsconfig's
  `paths`. `@/` survives in tested modules today only where it is an `import
  type`, which esbuild erases — a `@/` VALUE import resolves under Next and fails
  under vitest. `team-grid.ts` and `week-strip.ts` already spell theirs
  `../../lib/...`; anything imported by a test must.

- **The mobile bar IS the desktop pill, at the other edge.** Figma
  `4033:121668`. Same white fill, `border-shell-line/50`, 6px shadow,
  `rounded-card`, `h-10` buttons at 16/600/1.2, the same three inks and the same
  `bg-fill-soft` selected tab — off the same `NAV_TABS`. Four differences, all
  from its own frame: no app mark, `px-3` on the pill rather than `px-4`, **no
  gap** between the buttons, and the row's vertical padding inverted (`pt-1 pb-2`
  against the header's `pt-2 pb-1`). Anything that changes one and not the other
  is a bug unless a frame says so. Five things:
  - **It hugs and centres at every width — `shrink-0`, never full-bleed.** That
    is what the last full-width track got worst: at 1023px it drew three 325px
    tabs across 1000px. The pill is 335.9 there, centred, the same as on a phone.
  - **The frame's button box holds only from `min-[375px]`.** 2 + 24 + 100 + 110
    + 100 = 336 against the 336 a 360px viewport leaves after the row's `px-3` —
    a rounding error, not slack, and 40px short at 320. Below 375 the buttons
    take their content width at `px-3`, bringing the pill to 282.6. Measured at
    393 / 375 / 360 / 320: nothing scrolls sideways at any of them.
  - **40px drawn, 44px tapped**, via `after:inset-x-0 after:-inset-y-0.5`. The
    2px lands inside the pill's own `py-2` so it can never overhang, and
    `inset-x-0` rather than a full `-inset` is load-bearing: the buttons are
    adjacent with no gap, so a horizontal extension would steal its neighbour's
    taps. The desktop pill deliberately does NOT do this — the floor is a touch
    guideline and that surface is pointer-driven.
  - **It still swallows taps where the header passes them through.** `AppHeader`
    takes `pointer-events-none` because it spans 1000px while drawing ~400. This
    bar's undrawn band is ~28px per side, at the bottom edge where a thumb rests,
    and on the picks page a tap falling through spends a team for the season. A
    dead 28px corner is the cheaper mistake. A deliberate divergence.
  - **The icons are gone**, and `CheckCircleIcon` / `GridIcon` / `UserIcon` with
    them have no call site left. Kept: `icons.tsx` is a set, and nine other
    glyphs in it are already in that position. `TabKey` did NOT survive — the
    icon `Record` was its only consumer, and `key` still types itself through
    `as const`.

- **The app has navigation in two places, deliberately, and they are mutually
  exclusive by width.** (There is a THIRD surface wearing the same pill —
  `LandingHeader` on `/` — but it is not navigation: two buttons that open
  dialogs, no `Primary` landmark, and it can never coexist with either of
  these because middleware redirects a signed-in visitor off `/`. Its own
  entry is below.) Below `lg` there is NO header at all —
  `AppHeader` is `hidden … lg:block` — and `BottomTabBar` carries all three
  destinations (Picks / Standings / Account) in a bar pinned to the foot of the
  screen. The design was Figma `4033:121667` and is now `4033:121668`; `lg` is the breakpoint because it is
  the app's single turn-over width, and this was the user's call rather than an
  inference. Eight things:
  - **`sticky bottom-0`, NOT `fixed`, and that is what kept `main`'s padding
    still.** As the last child of the layout's `min-h-dvh flex-col` wrapper the
    bar's flow position IS the foot of the document, so `bottom: 0` — which only
    ever shifts a sticky box up toward the viewport, never down — pins it at
    every scroll offset, and at full scroll it is simply sitting where it lives.
    Because it also RESERVES its height there, `pb-20 lg:pb-32` did not have to
    move a third time (it was `pb-28` under the app's first, fixed, bottom bar
    and `pb-12` after that), and the page-frame measurement above still reads
    40/80 and 64/128. Measured in Chromium at 393×852: `barBottom === innerHeight`
    at scroll 0, 500, 1500 and max, and on a short page the document is exactly
    one viewport with no scroll at all. The fallback, if an ancestor ever gains
    an `overflow`, is an in-flow spacer wrapping a `fixed` child — which keeps
    the same property; going straight to `fixed` does not.
  - **The bar reserves space, but content still passes BEHIND it mid-scroll.**
    That is the design (a white pill with a hairline border and a 6px shadow,
    the desktop header's card), not a
    defect. What cannot happen is content stranded underneath at the page foot.
  - **`--tab-bar-h: 70px` in `globals.css` is the one place that number lives.**
    The bar sizes its row from it and `Toast` lifts itself clear with
    `bottom-[calc(1.5rem_+_var(--tab-bar-h))] lg:bottom-6`. On `:root` rather
    than the shell because `Toast` portals to `document.body` and inherits
    nothing from that subtree. **Underscores, not spaces, inside the `calc()`**:
    Tailwind turns `_` into a space and CSS `calc` needs whitespace around the
    `+`, so either other spelling compiles to nothing and presents as "the toast
    didn't move". The safe-area inset is deliberately NOT folded into the
    variable — the bar and the toast each add it themselves, and folding it in
    would count it twice.
  - **`pb-[env(safe-area-inset-bottom)]` goes on the bar's outer element**, so
    the 70px row sits entirely above the home indicator (the design height is
    preserved rather than eaten) and the flow space it reserves grows by the
    inset for free. The inset strip is bare rather than chrome — the pill does
    not reach it — which is the one thing the 393×70 frame cannot show.
  - **The shell wrapper took `pt-[env(safe-area-inset-top)] lg:pt-0`, and that
    is a consequence of deleting the mobile header rather than decoration.** The
    root layout is `viewportFit: "cover"` + `black-translucent` and the manifest
    is `display: standalone`, so an installed PWA runs under the status bar and
    `main`'s 40px would otherwise be the only clearance. It resolves to 0 in a
    browser, so the measurement above is unchanged there.
  - **The selected tab is `bg-fill-soft`**, the same token the desktop pill
    uses — the two navs are the same component in all but four numbers. It was
    `fill-deep` (#EAEAEA) while the bar sat on a translucent blurred track and
    needed more separation. `fill-deep` survives as `ui/Button`'s soft-variant
    hover, which had been retyping that hex as an arbitrary value all along.
    Unlike the `shell` greys, those three DO run light to dark: `raised` →
    `soft` → `deep`.
  - **Figma's `overflow-clip` on the pill is deliberately not transcribed.**
    There is nothing to clip — the active tab carries the track's own 16px
    radius — and an overflow there WOULD clip the global focus ring's
    `ring-offset-2` on the end tabs. Same family as the standing rule that
    nothing in a notification dot's subtree may take `overflow-hidden`.
  - **Two `<nav aria-label="Primary">` exist in the DOM and only ever one is
    exposed**, because both hides are `display: none`, which removes the element
    from the accessibility tree. Swapping either for `sr-only`, `visibility` or
    an opacity trick would put two identically named landmarks on screen at
    once. Relatedly, the Account tab's unpaid state is an `aria-label` carrying
    the header's exact string — legal only because the visible "Account" is a
    substring of it, which is the WCAG 2.5.3 test `MoreSection` still fails. The
    labels are stored sentence-case and both navs now render them as-is, so the
    substring match is exact rather than case-folded, and
    there is a test pinning it.

- **A member can pick for any week that has not kicked off, and the week strip
  draws each of those picks.** Before this, `submitPick` DERIVED the week and
  discarded the client's opinion — that was the entire enforcement behind "you
  may only pick the live week" — and every other chip was a read-only preview.
  Now the caller names a week and `resolvePickWeek` (game/season.ts) refuses it.
  Nine things:
  - **`WeekStrip.tsx` was not touched, and that is the headline.** The Figma
    variant for a planned week (*Previously selected? = Yes, Previous outcome
    decided? = False*) is `CHIP_FILL.neutral` + `CORNER_INK.undecided`, which the
    strip has drawn since the redesign — `#F3F3F3` fill, 30px logo, 10px
    `#757575` corner numeral, `#FC5F38` and white when selected.
    `buildChipPicks` already ran `pickFor(ref)` over EVERY option, so the chip lit
    up the moment a future pick reached `pickForWeek`. The whole feature was a
    data path and a guard, not a design.
  - **No migration.** 0014's insert/update `with check` gates on
    `g.kickoff > now() and g.status = 'scheduled'` plus week/season_type/team
    consistency, all of which a future-week row satisfies; 0001's delete policy
    carries the same kickoff test, which is what makes the release below legal.
    Don't add one out of caution — `docs/prd-rls-write-hardening.md` had already
    blessed "pre-fill future weeks" as conferring no advantage.
  - **Privacy needed nothing either.** 0001's `"picks read own or revealed"`
    returns another member's pick only once its game has kicked off, so a rival's
    planned pick is unreadable *in SQL*. `toMember` dropping `week > currentWeek`
    was never the privacy mechanism, and `hiddenPickUserIds` is still
    current-week-only.
  - **`LeagueData.viewerPicks` exists because `Member` structurally cannot hold
    this.** `HistoryPick.result` is not optional and an unplayed week has no
    result; `currentPick` is one week. Worse, `StandingsGrid` folds `history` for
    EVERY member, so widening it would paint the viewer's own plan into their own
    standings row. It is derived from the `pickRows` the loader already fetches —
    **zero new queries**.
  - **It fixed a bug that was live before the feature existed.** `usedByTeam`'s
    regular branch read `me.history`, which holds only picks whose game produced
    a RESULT — and per Open issues no regular game ever has, so that list was
    always empty in production: the grid drew a spent team as available and the
    database answered `23505`. The practice branch had read `picks` for exactly
    this reason since it shipped. Both branches read every pick now.
  - **The week you tap WINS, and the loser gets a toast.** A team may be spent
    once per phase (`picks_team_once_per_phase`), so picking one booked elsewhere
    releases that week — *if its game has not kicked off*. After kickoff the team
    is genuinely spent and the answer is `team_already_used`, which is also what
    RLS would say. `usedByTeam` is now precisely "spent for good", and
    `handleSelect` reads that same map rather than re-testing kickoff, so the
    grid cannot offer a card the overlay then treats differently.
  - **The chip clears optimistically; the TOAST waits for the server.** A
    confirmation should follow the fact, and only the server sees every release:
    a trailing tap recurses into `launchPick` with no `releaseKey`, because
    `settlePick` knows the team it is sending and nothing about what that team
    was booked against. `submitPick` therefore returns `releasedWeek`, which
    raises the sentence AND clears any chip this tab failed to predict. Raising
    it optimistically instead was tried first and had to apologise on failure.
  - **The release is delete-then-upsert, and it is not atomic.** PostgREST has no
    transaction, and `picks_team_once_per_phase` rejects the new row while the
    old one holds the team, so the order is forced. It runs only after every
    guard has passed, and a failure after the delete returns `release_failed` —
    the one code that reports a PARTIAL write, because "something went wrong"
    would leave a member to discover the hole themselves. A single `UPDATE`
    moving the row's week is atomic but only covers an empty target week, and two
    write paths for one action is worse. A definer RPC would be atomic outright;
    0014 already refused one.
  - **`interactive` means WRITABLE, not LIVE.** `MyPicksClient` derives
    `writable = isCurrent || viewingFuture` — stated positively rather than as
    `!viewingPast`, so a future change to the ref sanitising fails CLOSED. Its
    second job in `buildGridCards` (gating the `locked` label so a played week
    isn't 32 "Locked" cards) needed no split: nothing in a future week has kicked
    off, so that branch is unreachable there and was always about past weeks.
  - **All 18 regular weeks are writable during the preseason**, because
    `resolveCurrentWeek` returns 1 in phase `preseason` so nothing is ever
    `viewingPast`. That is the feature arriving early, not a bug. The other
    consequence worth knowing: you can clear your LIVE week's pick from a future
    tab while that game is still scheduled, and the toast is the only warning.

- **`ui/Toast.tsx` is the app's first floating message, and it MUST portal.**
  One at a time, replaced rather than stacked — the app raises exactly one kind
  (a pick released from another week), and a stack is a scheduling problem bought
  for a queue that never holds two things. Four things:
  - **`createPortal` to `document.body`, like `Drawer`.** Its only caller renders
    inside `MyPicksClient`'s `.stagger` root, and `globals.css` gives each direct
    child `reveal-up 0.5s both` at an `:nth-child` delay — inline, the toast would
    sit invisible for up to 275ms while its own 320ms slide played underneath.
  - **`role="status"`, not `role="alert"`.** It confirms something the reader just
    did, so it should follow what the screen reader is already saying rather than
    interrupt it.
  - **`ToastMessage` carries an `id`, and that is not decoration.** Releasing the
    same team from the same week twice running produces an identical sentence,
    and a card keyed on the text alone would not replay its entrance — the second
    release would look like nothing happened.
  - **Two-phase dismissal**, the same `rendered`-outlives-`open` shape as
    `Drawer`, with an `animationend` listener and a `setTimeout` backstop:
    unmounting on the timer alone cuts the exit off at its first frame, and a
    missed event would otherwise park a toast over the page for the session.
    `prefers-reduced-motion` needs no case — `globals.css` clamps every duration
    to `0.001ms`.

- **There is one accent colour now, it lives in `src/lib/accent.ts`, and every
  orange in the app is derived from it.** `ACCENT` is `#FC5F38` (the design
  library's `Text Color/Accent`); `tailwind.config.ts` imports it and mixes the
  rest. Before this there were four unrelated oranges and a green all meaning
  "this is lit / this is yours" — `shell.alive` #FC855C (the headcount cubes),
  `selected` #0C6F28 (week chip + picked card), `brand.strong` #ED7B46 (focus
  rings, sheen, `live`), plus #B85C2B / #C2551F / #8A4A24 hand-typed in four
  component files — so there was no single place to retune the accent and no way
  to tell which orange a surface had picked. Seven things:
  - **`accent` and `accent-faded` are the tokens to reach for.** `faded` is the
    accent with an alpha byte on it (`#FC5F3814`, 0x14 = 20/255 ≈ 8%), written
    as an 8-digit hex rather than as `accent/8` so it is a NAME that tracks the
    accent for free. It is the picked team card's fill; `accent` is its ring,
    the week strip's selected chip and the headcount grid's living cubes.
  - **`brand.*` survived as the accent's light ramp, and is not a second
    palette.** `brand.strong` IS `accent`; `DEFAULT`/`soft`/`wash` are build-time
    mixes toward white. The 39 `brand-*` call sites were deliberately NOT
    renamed: they already resolve to accent-derived values, and Tailwind's JIT
    compiles a class it cannot find to *nothing*, so a bulk rename is a
    silent-blank-page risk with no payoff.
  - **Those tints are opaque mixes, never `accent/NN`.** A wash can land behind
    a sticky cell — every standings row starts with one — and a translucent
    fill there lets the cells scrolling under it show through. `ink.wash`
    (`#EDEEF0`, the standings viewer row) is in the palette under the same rule,
    which is the ramp's rather than any one surface's. `brand.wash` no longer
    paints that column but keeps three call sites (`Badge`'s brand pill, the
    preseason banner, `LoginFlow`'s mark).
  - **The mixing happens in the config at build time, not in CSS.** Every token
    stays a plain hex, which is what keeps Tailwind's `/opacity` modifier
    working on them (27 call sites rely on it) and costs no `color-mix` support
    caveat.
  - **`src/lib/accent.ts` is a LEAF — one export, no imports — because the
    Tailwind config imports it** and that config is loaded by PostCSS at build
    time. Don't add dependencies to it. It is separate from the config precisely
    so `layout.tsx` (PWA `themeColor`) and `global-error.tsx` (inline styles
    Tailwind never reaches) can read the same value.
  - **Two static assets carry the hex BY HAND and cannot import it** —
    `public/manifest.webmanifest` and `public/icons/icon.svg`.
    `src/lib/palette.test.ts` fails on exactly those two if `ACCENT` moves
    without them, which is the whole reason it reads files off disk. Every other
    assertion in it compares tokens to EACH OTHER, so switching the accent stays
    a one-line change that leaves the suite green apart from that reminder.
  - **The week strip's `-lit` numerals are gone as INK, and #7BE170 is back as a
    FILL.** Those two facts sit together and are easy to read as contradicting
    each other. `result.win-lit` / `loss-lit` (#7BE170 / #F8787A) were lifted to
    survive the chip's old dark green fill; on `accent` they measure 1.88:1 and
    1.16:1 — worse than the dark pair, not better — so `CORNER_INK`'s `on`
    column takes `result.win` / `result.loss` in both states and always will.
    What came back is #7BE170 as `result.win-fill`, the tile the numeral sits
    ON, where being light is the entire point. #F8787A did not come back at all:
    the spec's loss fill is #FC615F. `palette.test.ts` still asserts both `-lit`
    keys are undefined, and that is not a rule this bent.
  - **A settled week is a COLOURED CHIP now, not a coloured numeral.**
    `CHIP_FILL` in `WeekStrip.tsx` paints the whole 52px tile green for a week
    you got through and red for one you didn't; `CORNER_INK` is unchanged and
    now says the same thing a second time. The reason is that colour on a 10px
    numeral is a few dozen pixels, which is what the change was asked for. Four
    things follow:
    - **The selected chip is no longer always `accent`.** Selecting a won week
      paints it #7BE170. Selection is carried by the jump to the saturated value
      plus the 2 -> 6px radius step, and only a neutral chip still turns orange.
      That is the spec's call, not a regression to tidy.
    - **`chipName` is NOT retired by this.** Its doc comment justifies speaking
      "won"/"lost" on the grounds that the outcome is carried by colour alone —
      and a tile's worth of colour is still colour, so WCAG 1.4.1 needs that
      line exactly as much as before. Easier to see is not the same as
      conveyed-by-something-other-than-colour.
    - **The `mix-blend-darken` trap is LIVE again, not historical.** It was
      measured against the old green #0C6F28 and a won week is filled green once
      more. `WeekStrip.tsx` says so at the logo.
    - **The two rest fills tint different bases** — win tints the light green
      (#7BE170/60), loss the dark red (#CD1411/40). It reads as a slip in the
      spec's own table; it is what the file draws, and both land on a pale tint
      of the same weight. Transcribed, not derived.

    The whole ladder, measured against the fill each state actually has, so
    nobody re-derives it:

    | corner numeral | rest | hover | selected |
    | --- | --- | --- | --- |
    | win #0C6F28 | **4.63:1** (was 5.70) | **3.27:1** (was 4.48) | **3.87:1** (was 2.06) |
    | loss #A71930 | **3.55:1** (was 6.70) | **2.92:1** (was 5.27) | **2.48:1** (was 2.42) |
    | undecided | 4.15:1 | 3.26:1 | 3.07:1 (white on accent) |

    Read it honestly: the numeral **loses** contrast at rest, where it used to
    sit on near-white, and **gains** it when selected, where it used to sit on
    orange. Every state now lands between 2.5:1 and 4.6:1. At 10px none of them
    cleared AA before or after, so that is lateral on a numeral which was
    already non-conforming — while the thing a player reads scanning the strip
    went from a few dozen coloured pixels to a 2,700px² tile. The 28px week
    numeral on a pickless chip is untouched and still clears AA-Large at 3.07:1.
    A KNOWN accepted state, chosen with the numbers on the table.

- **H3 is 32px now, it lives in `src/lib/type-scale.ts`, and it is a class STRING
  rather than a Tailwind token.** The design library's H3 was 28px at -2%; it is
  32px over 120%, Inter semibold, -4% — one size at every width, with no `lg:`
  step. Three call sites take it: the pick page's Layout options
  (`PickFilters`, which used to be 20px stepping to 28px at `lg`), the account
  page title (`surfaces.tsx`'s `PAGE_TITLE`, now composed from it) and the login
  invite preview's league name (`LoginFlow.tsx`). Four things:
  - **A `fontSize` token named `h3` would have been silently deleted, and that is
    why this is a string.** `cn()` runs tailwind-merge, which decides what a class
    conflicts with by parsing its NAME: `text-xs` is a font size, `text-h3` is not
    a t-shirt size and so gets filed as a text COLOUR and dropped outright the
    moment a caller passes one — which all three call sites do. `ui/Label.tsx`
    documents the trap from the time it cost the app every 12px label; the four
    `display-*` / `label-*` tokens still in `tailwind.config.ts` have zero call
    sites for the same reason, and `PickHero`, `app/page.tsx` and `LoginHero` each
    independently talk themselves out of adding another one. Adding a fifth dead
    token would have been the obvious-looking move.
  - **The tracking is `-0.04em`, not `-1.28px`.** Figma reports letter-spacing as
    percent times 100, so this step's `-4` IS -4%; `em` is that percentage
    directly, where px is a conversion to redo every time the size moves.
    `surfaces.tsx` carries a paragraph about getting that arithmetic wrong — a
    headline four times too tight. The older constants in that file are still px,
    so the app has both spellings; the em one is right for anything shared.
  - **It carries no colour, unlike `PAGE_TITLE` and `HEADING` beside it.**
    `PickFilters` paints the same type in `shell-ink` or `shell-faint` depending
    on which option is live, so a baked-in `text-shell-ink` would make the
    constant unusable exactly where it is most wanted. Callers compose.
  - **`src/lib/`, not `components/account/surfaces.tsx`**, which already holds
    constants of this exact shape. That file is documented as the ACCOUNT page's
    vocabulary, and `InviteCta` spells its `HEADING` out by hand rather than
    import it — "a `group/ -> account/` import would quietly promote it into
    something shared without saying so". A leaf module is that promotion, said
    out loud.

  Not H3, and deliberately left alone: `WeekStrip`'s 28px week numerals, which
  are a numeral sized against its chip rather than a heading.

- **The invite card is the "Grow the League" module, and it carries a photo.**
  `InviteCta.tsx` (was `WhosIn.tsx`, which also held the deleted roster) is now a
  heading with the headcount beside it over a white 12px-radius card: the
  league's sheep photo, one sentence, the entry deadline set at 24px, and a
  black "Copy Link" button. Desktop is one 1000px row with a 133px square; below
  `lg` it stacks with a full-bleed square. Six things are load-bearing:
  - **The photo lives at `public/icons/grow-the-league.webp` and the `/icons/`
    part is not a filing preference.** The service worker's runtime cache accepts
    only `/_next/static/` and `/icons/`, so art anywhere else refetches on every
    load and is missing offline — the rule `public/icons/animals/README.md`
    already states. It is deliberately NOT in that route's `SHELL` precache
    array: `addAll` is atomic, so one wrong path there kills the whole precache,
    which is a poor trade for a below-the-fold photo.
    `src/components/group/invite-asset.test.ts` pins the path, the file's
    existence and the reference from the component, because a missing file 404s
    into the `bg-shell-line` grey square and nothing in the browser says a word.
  - **`shrink-0` on that image is the load-bearing class, and `max-w-none` is
    not.** The text column is `lg:flex-1` (`flex-basis: 0`, so zero shrink
    weight), which means every pixel of overflow would otherwise come out of the
    photo. `max-w-none` is prophylaxis and was MEASURED not to bind — preflight's
    cap resolves against the card's 942px content box — so unlike `PickHero` and
    `AppHeader`, where the same class fixed a real 50-drawn-at-28 bug, here it
    only stops one starting.
  - **`time.ts` now has three weekday-date formatters and they differ by
    millimetres.** `formatLong` = ordinal + clock + zone (kickoffs);
    `formatWeekdayDate` = no ordinal, no clock (the buy-in deadline, where an
    ordinal reads as false precision); `formatWeekdayDateOrdinal` = ordinal, no
    clock (this card). The first and third share one private `ordinalDate` body
    so they can only ever differ by the clock, and there is a test asserting
    exactly that. Adding an ordinal to the middle one breaks a test written to
    catch that edit.
  - **Dropping the time means the CALENDAR DAY can change at hydration.**
    `LocalTime` ships US-Eastern and swaps to the reader's zone after mount, so a
    Thursday-night kickoff reads as Friday in Tokyo — a date change rather than a
    clock change, because the clock is no longer on screen. `formatDate` already
    behaved this way and has a test pinning it.
  - **The button carries no `aria-label`, on purpose.** One would override the
    children, so the Copied/Copy Link swap — the whole confirmation — would never
    be announced; and "Copy invite link" does not contain the visible "Copy Link"
    as a substring, which fails WCAG 2.5.3 Label in Name for voice control.
    `MoreSection.tsx` still has both bugs on the same label.
  - **The headcount beside the heading is the THIRD copy of that number on the
    page.** `LeagueDetails` prints "N in" and the headcount "N joined", both
    off the same `members.length`. That is the design's call. It is also why
    deleting the roster lost nothing: the count was never unique to it.

- **The preseason practice round no longer eliminates anyone.** A losing practice
  pick is counted and shown; only the regular season ends a run. It used to work the
  other way, and the failure was ugly out of proportion to the rule: one losing
  preseason pick in a single-elimination league derived `eliminated`, `submitPick`'s
  `canPick` guard then refused *every* later practice pick, and because the pick
  surfaces never read status at all (`interactive={isCurrent}`, nothing more) the tap
  painted optimistically and snapped back to "No Pick Made" a moment later. The
  practice round shut itself down for exactly the people using it, and the only
  visible explanation was one line of error copy under the hero. Five things:
  - **`countStrikes` exists because `computeStatus` CANNOT answer this question.**
    That fold `break`s the moment it eliminates someone, so it reports 1 for a
    member who lost three times in a `single` league. Correct where elimination ends
    the run and the rest is moot; wrong for a round that never ends anyone. Calling
    `computeStatus` and overriding `status` afterwards is the obvious-looking fix and
    it silently caps the practice loss count at the allowance — a plausible number,
    a wrong one, and one that then orders the practice table wrongly too. There is a
    test pinning both answers side by side.
  - **`PracticeMember` carries no `status` and no `eliminatedWeek`**, rather than
    pinning them to `"alive"`/`null`. A field that can only hold one value gets read
    as a real one eventually. The two consumers supply the constants instead —
    `StandingsClient`'s merge and `submitPick` — and deleting the fields is what made
    the compiler enumerate those two consumers in the first place.
  - **`submitPick` assigns `memberStatus = "alive"` for a `pre` pick; it does not
    just drop the line.** `memberStatus` is initialised from `membership.status`,
    the REAL row, so deleting the practice assignment would silently couple practice
    to regular-season elimination — the exact leak the comment above it promises
    cannot happen. Same shape as the `entryOpen: true` beside it: a guard input
    answered by the round's rules rather than by this member's record.
  - **The practice table orders on a number that has no label of its own.**
    `rankMembers` still ranks practice by losses once its buckets tie, but
    nothing eliminates, so no practice row wears an "Out" chip — and `strikes`
    is rendered nowhere in the app at all (`StrikePips` in `Badge.tsx` has no
    call site). The washed loss cells running across each row are what the order
    reads off. (This bullet used to open "`StandingsGrid` is UNTOUCHED"; the
    table redesign has since touched it thoroughly — see its own entry below.
    What survives is the practice table's ranking, which still falls through to
    losses.) That is deliberate rather than an oversight: a loss tally beside the
    name was built and then removed, because it is in no mock-up and duplicates what
    the cells already say. The one case the cells genuinely miss is a missed pick in
    the LAST preseason week — `countStrikes` counts it, but `history` only covers
    `week < currentWeek`, so that cell renders empty rather than washed. Rare, and
    accepted; don't reintroduce a chip for it without a design.
  - **The `firstPickWeek` clamp stays, on a new argument.** Its original one was that
    a mid-preseason joiner derived `eliminated` on arrival, which cannot happen now.
    It survives because a practice record is a claim about what you did, and the Hall
    of Fame game in early August would otherwise hand a brand-new account three
    losses it was never present for. `AdminSettingsDrawer` has said "nobody is
    eliminated by a preseason loss" all along; that copy was wrong when it shipped
    and is right now.

- **`main` no longer carries a flat `pt-5 pb-12`.** It predated the mockups; the page
  frame is now `px-4 pb-20 pt-10 lg:pb-32 lg:pt-16` and every route inherits it.
  `NoLeagueState` lost the `py-6` that had it sitting 24px below every other screen.
  The rules a new page has to follow are their own section — **Page layout: what a new
  page inherits, and what it must not add** — rather than repeated here, because two
  copies of a number is how this file goes stale.

- **`MyPicksClient`'s root has no `space-y-*`, and that is load-bearing.** The mockup
  butts the pick module straight against the week selector — `PickHero`'s own
  `py-10 lg:py-12` is the whole gap. A root `space-y-4` stacked 16px on top and made
  that seam 56/64px against the designed 40/48. Removing it is all-or-nothing:
  `space-y-*` compiles to `> * + *`, which outranks a child's own `mt-*` on
  specificity, so no single child can opt out. Every other block therefore carries an
  explicit `mt-4` — the same trade `StandingsClient` already made, for the same
  reason. The preseason banner carries `my-4` rather than `mt-4`, because it sits
  *between* the strip and the module and a top-only margin would collapse the second
  seam while fixing the first.

- **There are two ways to make a pick, and the matchup list is the default.**
  `TeamGrid` draws all 32 teams as square cards, one tap to pick; `WeekSchedule`
  is the radio-group over the week's matchups. `PickFilters` switches between
  them. The default was the grid until the matchup list took it over; the literal
  lives in exactly one place (`MyPicksClient`'s `useStoredChoice` fallback), and
  because that hook seeds its state with the fallback and reads storage in an
  effect, the fallback IS the server paint. Anyone who has already chosen keeps
  their stored answer. Six things are load-bearing:
  - **Both surfaces are handed the same derived values.** `MyPicksClient` already
    computed the week's `games`, the `usedByTeam` map with its two week-scoped
    exclusions, `byes`, `pickTeam` and `interactive`, and both layouts take those
    verbatim. A new rule about what is pickable goes in that one place; putting it
    in a layout means the other layout disagrees with it, silently.
  - **The geometry is exact, not approximate**, and both ends come off the
    mockups. Desktop is six 160px cards with 8px gutters inside the 1000px
    column, which is where `maxWidth.shell` caps it. Mobile is three 125.66px
    cards at 393px, full-bleed via `-mx-4` with 4px of padding and 4px gutters.
    Move the shell's cap or its gutter and both stop matching.
    The column count steps at `480px`/`md`/`lg` — holding three across up to `lg`
    would draw 328px cards on a tablet. `lg` is still where the *shape* turns
    over: it is where the grid stops bleeding.
  - **The selected card's edge is `ring-2 ring-inset`, not a border.** A 2px
    border sits inside the *content* box as well as the card, which took 4px off
    the width the logo is sized from — so the logo visibly shrank the moment you
    picked it, 90.66px to 86.66px. A ring is a box-shadow and costs no layout.
    Measured, not reasoned about.
  - **A logo is in colour exactly when the card is actionable, and on a touch
    device that is true at rest.** A card you can pick comes up in colour on
    hover; on a device with no hover it is in colour from the start, because
    otherwise the treatment is a reward a phone can never claim and the whole grid
    is 32 grey logos. The picked card is always in colour. Everything else — bye,
    already spent, locked, and every card on a week **already played** — is
    greyscale on **every** device, so colour keeps meaning "you can act on this".
    That set grew when picking ahead shipped (a week ahead of the live one is
    writable, so its cards are selectable, so they are in colour) and keying on
    `selectable` is what made it grow for free. Three things:
    - **The trigger is `[@media(hover:hover)]`, never `lg`.** The reason is a
      device fact, not a width one: an iPad past 1024px would sit at grey with no
      hover to redeem it. It is also how the card's other two hover rules are
      already gated. The accepted cost is that narrowing a desktop browser does
      *not* show the touch treatment — DevTools device emulation, which flips
      `hover` to `none`, does. Verify by reading computed `filter` (`none` vs a
      string containing `grayscale(1)`), not by eye: a typo in an arbitrary
      variant compiles to nothing and presents as "the change didn't take".
    - **It keys on `selectable`, not on `outOfPlay`.** `buildGridCards` gives a
      week **already played** `state: "available"` with `selectable: false`, so
      those cards are neither selected nor out of play and a test on `outOfPlay`
      would light all 32 of them up on a phone. (That worked example used to say
      "a preview week", which covered future weeks too; a future week is
      `selectable: true` now and is *supposed* to light up.)
    - **One class, chosen by a ternary — not a bare `grayscale` plus a
      `[@media(hover:none)]:grayscale-0`.** Two classes writing `--tw-grayscale`
      on one element are resolved by generated CSS source order, because a media
      query adds no specificity. The ternary emits no filter class at all for a
      selectable card on touch, so exactly one rule can ever apply. Note that the
      comment in `TeamGrid.tsx` describes that rejected alternative in prose
      rather than spelling the class: `content` is `./src/**/*.{ts,tsx,mdx}`, so
      **Tailwind scans comments**, and naming a class you deliberately do not use
      ships the rule anyway — measured at 266 bytes of dead CSS for this one.
      Naming a class that IS used costs nothing, which is why every other comment
      in the app can quote freely. This file is not scanned and so can.

    Figma reaches the greyscale with `mix-blend-luminosity`; over a neutral card
    that is the same picture as `grayscale`, without the isolation and
    stacking-context rules a blend mode drags in.
  - **`TeamLogo` has a `fill` prop** for the desktop logo, which is sized off the
    column rather than in pixels — `size` is an inline style no breakpoint class
    can reach, which is why `PickHero` renders three copies. At 32 cards that
    would have been 64+ `<img>` elements. `max-w-none` is still load-bearing under
    `fill`: preflight's cap is relative to the intrinsic 500px artwork, not to the
    box.
  - **The layout choice lives in `localStorage`** (`lms:picks:layout`), so it is
    per-device and is *not* part of `LeagueData`. `useStoredChoice` renders the
    default first and reads storage in an effect — seeding state from
    `localStorage` in a `useState` initializer is a hydration mismatch, since the
    server has no such thing. The cost is one paint for anyone who changed the
    setting. `lms:picks:sort` was the other key and is gone; stale values sit in
    people's browsers where nothing reads them.

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

- **`orderPickerTeams` is no longer dead code, and the Sort filter going away
  is what nearly made it so again.** It was written and unit-tested for a picker
  that was deleted, and the grid now uses it. It grew one option,
  `groupUnavailable`, which defaults to `true` purely so its original tests keep
  meaning what they said; the grid passes `false`, because bye and already-spent
  cards sort *in place* — the record ranking is a straight ranking of all 32, and
  a card must not move merely because you spent it.

  `orderGridTeams` now passes `sort: "record"` outright rather than a filter's
  choice. The alternative the filter offered, "ABCs", was `sort: "default"` — a
  passthrough, because `TEAMS` is already alphabetical by city and then nickname
  — so had the fixed order gone that way instead, `orderPickerTeams`, `winPct`,
  `isActionable` and `availabilityOf` would ALL have become unreachable in one
  move. Record was also the stored default, so nobody's grid changed.

- **Both pick surfaces' cards reveal on scroll, and GSAP is in the bundle for
  it — but the two no longer reveal the SAME way.** `use-card-reveal.ts` owns
  *when*: every card gets its own ScrollTrigger starting at `top bottom-=100`,
  one-way, a card arriving the first time its row crosses the line and then
  staying. *What* arriving looks like is the caller's, passed in whole as a
  `Reveal` from `card-reveal.ts`:
  - **`REVEAL_CLIP` (`TeamGrid`)** — the original 1.2s `clip-path:
    inset(100% 0 0 0)` -> `inset(0)` wipe on `cubic-bezier(0.4, 0, 0.2, 1)`
    (registered through CustomEase, whose SVG path form `M0,0 C0.4,0 0.2,1 1,1`
    is that curve exactly — `power2.inOut` is a near neighbour, not the same).
  - **`REVEAL_FADE` (`WeekSchedule`)** — the fade+blur the My Picks hero
    resolves its own pieces with: opacity 0 -> 1, `blur(12px)` -> `blur(0px)`,
    `scale(1.04)` -> `scale(1)` on `cubic-bezier(0.16, 1, 0.3, 1)`, at the
    hero's own 650ms. The matchup list sits directly under that module and was
    asked to arrive the way it does. `FADE_DURATION` is `HERO_DURATION_MS / 1000`
    rather than a retyped 0.65, and a test reads `tailwind.config.ts`'s
    `blur-in` keyframe directly and asserts the constants still match it — the
    hand copy cannot drift from the original in silence.

  GSAP costs **+49KB gzipped on `/app` alone** (11 -> 60KB route, 127 -> 176KB
  First Load; the shared chunk is untouched), and the same effect is expressible
  in CSS + one IntersectionObserver — the dependency was chosen deliberately, not
  by default. The arithmetic lives in the pure `card-reveal.ts` beside it, because
  there is still no jsdom here. What is load-bearing:
  - **The start state is in CSS (`.reveal-clip` / `.reveal-fade` in
    `globals.css`), not set from JS on mount.** `/app` is server-rendered, so a
    state applied in an effect flashes a fully drawn grid on every cold load in
    the window before hydration. The stated cost: if the client JS ever fails to
    load, the pick grid renders blank rather than visible-but-inert. The class
    doubles as the hook's query target, so a card carries one new token rather
    than two.
  - **`.reveal-fade` also carries `pointer-events: none`, and `.reveal-clip` has
    no need of it.** A clipped-away card is not hit-testable for free — clipped
    regions receive no pointer events — but an `opacity: 0` card is fully live,
    radio inputs and all. In a league where a pick spends a team for the season,
    a tap landing on a card nobody can see is not cosmetic, and the JS-never-loads
    case above turns "blank and inert" into "blank and live". `REVEAL_FADE.shown`
    hands `auto` back; GSAP applies a value with no numbers in it on the FIRST
    tick rather than the last, so the card is clickable as it starts arriving.
  - **The fade's resolved filter is `blur(0px)`, never `blur(0)` and never
    `none`** — even though the keyframe it mirrors is written `blur(0)`. GSAP has
    no filter parser and tweens the string generically, measuring the unit off the
    end value: `blur(0)` has a `)` in the way, so no unit is appended, the
    midpoint renders `filter: blur(6)`, the browser drops it as invalid, and the
    card sits at `blur(12px)` until the last frame snaps it clear. `none` has no
    numbers at all, so GSAP swaps it in on the first tick and there is no blur
    whatsoever. Both look right in review and neither errors. The test asserts the
    literal string, because asserting the number 12 cannot catch either.
  - **A surface passes the whole `Reveal` and reads `className` off that same
    object** — `REVEAL_FADE.className` on the card, `reveal: REVEAL_FADE` to the
    hook. A `variant: "clip" | "blur"` string plus a lookup table typechecks
    perfectly while naming the wrong class, and the consequence is not a wrong
    animation but an invisible grid (next bullet). One import, referenced twice,
    cannot disagree with itself.
  - **`readColumns` reads `offsetTop`, not `getBoundingClientRect().top`.** A rect
    is the *transformed* box, so an armed card at `scale(1.04)` reports a top ~2%
    of its height above a revealed one — about 3px, outside `countColumnsByRow`'s
    1px tolerance. A rebuild landing mid-cascade, with part of the first row
    revealed, would truncate the run and answer 1 column for a grid drawing three.
    `offsetTop` is layout-derived, so no transform reaches it. `clip-path` could
    never produce this, which is why the hook read rects for as long as it did.
  - **The stagger modulus is READ, never hardcoded.** The brief said
    `(index % 5)`; neither grid is five columns. `TeamGrid` steps 3/4/5/6 across
    `min-[480px]`, `md` and `lg`, and `WeekSchedule` is
    `repeat(auto-fill, minmax(260px,1fr))`, whose count is content-driven and so
    cannot be derived from breakpoints at all. A fixed 5 lines up with real rows
    only in the 768-1023px band; everywhere else the cascade drifts diagonally
    across rows instead of resetting at each one.
  - **A `<fieldset>` does not report its own grid tracks, and that is why
    `countColumnsByRow` exists.** `WeekSchedule`'s grid element IS its fieldset,
    and Chrome hands back the *specified* `repeat(auto-fill, minmax(260px, 1fr))`
    at every width, fully laid out, with the cards visibly in three columns
    behind it — a fieldset's grid formatting context lives on its anonymous
    content box. Measured at 393px and 1280px. So counting the cards that share
    the first one's top edge is not a defensive fallback that never runs; it is
    what the matchup layout uses every time. `columnCountFrom` returning 0 rather
    than miscounting that comma as two tracks is what routes it there.
  - **Cards are found by class under the grid, never by `.children`.** That same
    fieldset's first DOM child is its `<legend>`, so `.children` would shift
    every index by one, put the cascade permanently out of phase with the rows,
    and mask a screen-reader-only element. It also sidesteps `TeamGrid`'s
    `if (!card) return null`, where a React index can disagree with the rendered
    position — and it is the rendered position that decides which row a card is
    in.

    The cost of that query is one silent failure, and it is the worst one in
    either surface: move the class off the grid's DIRECT child, or hand a
    surface one reveal's class and another's styles, and `:scope > .{className}`
    matches nothing, the hook returns before writing a single style, and
    `globals.css` leaves every card at its invisible start state. Nothing throws;
    typecheck and the suite stay green; the page is simply blank where the grid
    was. Passing the whole `Reveal` closes the second route in; a
    development-only `console.warn` when a grid has children but no cards is what
    stops the first from being silent. Both of those exist because this has
    always been one careless move away.
  - **`.stagger`'s 12px is observable here, and one refresh fixes it.** The hook
    builds in a layout effect, i.e. while `reveal-up`'s `translateY(12px)` is
    still applied, so every trigger start is measured 12px low — and ScrollTrigger
    caches starts rather than recomputing them on scroll. Measured at 393x852:
    starts moved -492 to -504 after a refresh, and **three cards sitting above
    the trigger line stayed masked indefinitely** without one. Hence the
    `animationend` listener on `closest(".stagger > *")`, target-guarded because
    animationend bubbles.
  - **`once: true` is NOT what stops the replay — `toggleActions` is.** This is
    the opposite of what the option name suggests, and it is one line of
    ScrollTrigger: `once && (clipped === 1 ? self.kill(false, 1) : callbacks[toggleState] = 0)`.
    It nulls the *callback* slot, and self-kills only at `clipped === 1`, which
    is the `end` boundary — not `onEnter`, and not the tween finishing. The block
    that runs toggle actions never consults `once` at all, so `once: true` beside
    `"play none none reverse"` still un-wipes on the way back up. What the hook
    relies on is `"play none none none"`: nothing on the other three actions, and
    re-entering calls `play()` on a timeline already at progress 1, which is a
    no-op. `once` is still set, for the unrelated benefit that its
    `kill(false, 1)` retires the trigger as the card scrolls past while leaving
    the tween exactly where it is — where a bare `.kill()` would revert the
    styles and kill the animation.
  - **A week change is the ONE thing that animates a card twice**, and the rule
    lives in `planCardReveal`. On screen when the week turns over, a card leaves
    and returns (0.35s/0.6s on the clip, 0.3s/0.65s on the fade); below the line
    it returns to its start state and takes the ordinary scroll reveal; on any
    other rebuild — a breakpoint crossing, a re-render on tap — a revealed card
    holds and animates nothing. The exit is dead code on the fade in practice:
    `WeekSchedule` keys on `game.id`, so a week change mounts all-new nodes,
    `wasRevealed` is false for every one and `wipeOut` never comes back true. It
    is defined anyway so the reveal is complete if it is ever pointed at a
    surface that keeps its nodes across a week, as `TeamGrid` does. The
    asymmetry is load-bearing: **the week branch keys on POSITION, every other
    branch keys on REVEALED-NESS.** They were the same test while the reveal
    reversed; they stopped being the same the moment it became one-way, because
    a card revealed on the way down and then scrolled back below the line is
    still revealed and a positional test would re-mask it.
  - **The wipe-away needs `immediateRender: false`, and without it the bug comes
    straight back.** A `fromTo` renders its FROM state at creation by default,
    even sitting last in a timeline — so the wipe-in stamps the card to hidden
    before the wipe-away runs, the wipe-away then animates an already-hidden
    card, and a week change *snaps*. Measured: `inset(100% 0% 0%)` at 0ms, no
    movement until 400ms. Which is exactly the complaint the replay was built to
    answer, reintroduced one line further down.
  - **The order key is narrow on purpose.** `MyPicksClient` re-renders both
    surfaces on every tap, and `revertOnUpdate` strips the inline clip-path — so
    a key that moved with the pick would rebuild 32 timelines each time you
    picked. `TeamGrid` passes `order.join(",")`, which is safe precisely because
    `orderGridTeams` passes `groupUnavailable: false` and so never reorders on
    `selectedTeam`. It is separate from `weekKey` because the two mean different
    things to the reveal: one rebuilds the cascade in silence, the other replays
    it. Since the Sort filter went, the order can only move when records do,
    which only happens across weeks — so `orderKey` is now a subset of `weekKey`
    rather than an independent trigger. Kept regardless: it costs one string
    compare and it is still the honest key for "the order changed".
  - **A week change preserves `TeamGrid`'s cards and replaces `WeekSchedule`'s.**
    The grid keys on `teamId` and `buildGridCards` loops `TEAMS` every week, so
    all 32 labels survive; the matchup list keys on `game.id`, which is the ESPN
    event id and globally unique per game, so React unmounts every card. Nothing
    to wipe away there — `planCardReveal` returns `wipeOut: false` and those
    cards simply wipe in. Not a special case, just the honest consequence.
  - **`prefers-reduced-motion` needs a manual check here, unlike everywhere
    else.** The global rule in `globals.css` clamps CSS animation and transition
    *durations*; a GSAP tween is neither, and nor is a static `clip-path` or
    `opacity` start state. The hook reads `matchMedia` itself, exactly as
    `WeekStrip`'s programmatic scroll does — and each start-state class carries
    its own override (`.reveal-clip` a `clip-path: none`, `.reveal-fade` a reset
    of all four of its properties, `pointer-events` included, so the card is
    usable in exactly the state it is visible in) so a reduced-motion visitor
    never sees a hidden card even before the JS runs.

  `tailwind.config.ts`'s `reveal-mask` is still there, still unused, and wipes
  the OTHER way (`inset(0 0 100% 0)`, downward, plus an opacity fade). Don't
  reach for it.

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
  `ui/Drawer.tsx`. Four tabs — Members (roster, two switches per row), Rules
  (game rules **and** the buy-in amount), Name (the league's name **and** the
  invite link), Data Feed. It opens as **ADMIN / Control Center**, matching the
  row that opens it. Fourteen things are load-bearing:
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
  - **The tab bar is pinned in the drawer's header, and NOT with `sticky`.** This
    entry twice said sticky and was twice wrong by the time anyone read it. The
    header is a `shrink-0` flex sibling of a `h-[90dvh]` panel, so it is
    structurally fixed and there is nothing for a `sticky` to pin against — the
    class came off when the panel took a fixed height, along with the translucent
    background that only made sense while content scrolled under it. The reason
    it needs pinning at all still stands: at 480px the bar was never more than a
    short scroll from the top of the viewport, so pinning bought nothing; at
    90dvh with a long roster it would scroll out of sight and the other tabs
    become unreachable. Don't reintroduce `sticky` to "fix" a pin that is
    already structural.
  - **The name and the invite share the Name tab, and that is what pays for the
    full-width roster.** The name used to sit above the bar in `Drawer`'s `aside`
    slot, on the argument that it names the thing every tab is about; the invite
    link, the code and four hint paragraphs sat in a ~300px rail beside the
    roster. The rail cost Members a third of 1000px — on the one tab that needs
    the width, for two things that are not membership admin — so both moved into
    a tab of their own and Members runs the full rail. `aside` had no other
    caller and is **gone from `Drawer`** rather than left as an empty slot; the
    header row it needed collapsed to a plain block with it. `GroupNameSection`'s
    `id="group-name"` is still hardcoded, so it must render exactly once — which
    a tab branch gives for free, since only the active tab is mounted.
  - **The removal copy travelled with the invite; the switch copy didn't.**
    `remove_member` closes at `entry_closes_at` exactly as `join_by_invite` does,
    so removal is the undo for a join and reads correctly beside the link that
    caused it. The Paid and Preseason paragraphs stayed under the roster they
    describe, in `lg:grid-cols-3` — at the full 1000px a stacked hint runs to a
    ~130-character measure, and three columns buy back the ~45 the rail used to
    give them. Widening that back to one column is the regression to watch for.
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
  the same thing. It no longer leaves Standings with nothing to draw, though:
  that page falls through to the blank regular-season board (its own entry
  below). Four consequences:
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
    headcount and the foot of Standings — no heading, no explanation. The two
    empty states are "your admin hasn't turned this on" and "no preseason
    schedule is loaded", and they can't be told apart from the null alone. The
    hole itself is gone now — the board renders either way — so the flag's whole
    remaining job is choosing which of those two sentences sits above it. That
    makes it *less* load-bearing than it was, not more: getting it wrong now
    costs one misleading line rather than a blank page.

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
- **The account page is ONE 656px column of stacked blocks, and every number in
  it is transcribed from the mock-ups.** `/app/account` is title →
  [Admin Control Center] → Personal Details → League Dues → Additional Settings →
  Log Out on desktop, and reorders to … → Log Out → Additional Settings on a
  phone. It used to be two 322px columns — title → [Personal Details | For the
  Common Good] → More → Log Out — and the restack deleted that grid outright.
  `SHOW_LEAGUE_AND_PREFERENCES` and its two hidden sections are **gone** — the
  redesign supersedes them, and `git log` is where they live now. Eight things
  are load-bearing:
  - **`lg` is where it turns over**, as everywhere else in the app, and the
    column is `max-w-[656px]` inside the content column's 1000. **Blocks are
    32px apart on a phone and 40px on a desktop**,
    uniformly. Nothing splits into columns any more, so exactly four things turn
    over at `lg` and all four are *inside* a block: Personal Details lays its
    four fields two across (a `lg:grid lg:grid-cols-2`, tracks measured at
    300px), League Dues becomes a row with a full-height rule down it, the Admin
    Control Center centres its button, and Log Out moves below Additional
    Settings.
  - **DOM order is not visual order.** Log Out carries `order-3 lg:order-4` and
    Additional Settings `order-4 lg:order-3`, rather than the button being
    rendered twice. `.stagger` animates on `:nth-child`, which `order` leaves
    alone. Those numbers are a sort key, not an index — every other block sits at
    the default `order: 0`, which flexbox places ahead of any positive value, so
    the pair kept sorting correctly when the restack grew the root from four
    children to five (six for an admin, whose card shifts every later block one
    `:nth-child` slot along; the helper defines eight).
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
    distinguishes the two states from across the page. Unaffected by the restack
    — only the card's *interior* flips to a row at `lg`.
  - **"For the Common Good" is "League Dues" now, and the file, its pure module
    and that module's test were renamed with it** (`LeagueDues.tsx`,
    `league-dues.ts`, `league-dues.test.ts`) — `WhosIn` → `InviteCta` and
    `AdminSettingsModal` → `AdminSettingsDrawer` are the precedent for renaming
    on redesign rather than leaving a file lying about its contents. It lost the
    "Say Something Nice" card it used to carry, which is now a row with a
    "Feedback" button in Additional Settings. Two things inside it:
    - **The buy-in figure is `H3` from `src/lib/type-scale.ts`, composed, not
      retyped.** It went 24px → 32px at −4%, which is that constant exactly, and
      that constant carries no colour precisely so callers can paint it.
    - **The desktop rule between the two halves reaches full height off the flex
      row's default `align-items: stretch`.** So `lg:h-auto` is load-bearing — it
      is the base `h-px` that would otherwise defeat the stretch — and **nothing
      in that card's class list may become `items-start`**, which would collapse
      the rule to nothing with no error anywhere. Measured at 1x122.4.
  - **Every surface on the page is 8px now — cards and rows alike.** This entry
    used to say the opposite, and said it emphatically: 4px cards against 8px
    rows, "in the design at both widths — not a slip waiting to be unified". That
    was true of the old mock-ups. The restack's Figma then gave League Dues 8px
    while leaving Personal Details at 4, i.e. disagreed with itself, and carrying
    two card radii to reproduce a slip was not worth the constant. `CARD` in
    `surfaces.tsx` is `rounded-control` and so is `MoreRow`. **Unified
    deliberately, with the number chosen rather than inherited — don't re-split
    it on the strength of one frame.**
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
    who belongs to none gets "Join an Existing League" in League Dues' slot
    instead, full width, on `!activeLeague` alone. `/app` and `/app/standings` offer the same
    `JoinByCode` through `NoLeagueState`; three entry points is intentional.

- **The way into the admin drawer is a card at the TOP of the account page, and
  the gear on Standings is gone.** `LeagueDetails` no longer takes `isAdmin` or
  `onOpenSettings`, `StandingsClient` no longer mounts `AdminSettingsDrawer`, and
  the section formerly titled "More" is now **Additional Settings**. The control
  center started life as that section's first row; the restack promoted it to a
  bare card directly under the page title, above Personal Details, with no
  section heading of its own — so Additional Settings now runs Invite Link → Say
  Something Nice → Danger Zone, and nothing left in it is gated on who you are.
  It lives in `AdminControlCenterCard.tsx` rather than in `MoreSection.tsx`,
  because a module named after the bottom-of-page section is the wrong home for a
  top-of-page card. Five things are load-bearing:
  - **The roster is loaded for admins only, and null means "no control center".**
    The drawer needs `Member[]`, and `loadAccount()` deliberately carries
    `aliveCount`/`memberCount` instead — so `app/account/page.tsx` calls
    `loadLeague(activeGroupId)` (seven queries against `loadAccount`'s four)
    *only* when `active.role === "admin"`, and passes the result down as
    `adminMembers`. A non-admin, an unresolved league and a failed load all
    collapse to the same null, which fails CLOSED. That is the opposite of
    `accountClosed()` next door, on purpose: hiding one admin control costs an
    admin a trip to the SQL editor, where the same error failing closed there
    would lock the whole league out of the app.
  - **`AccountClient` derives `isAdmin` from that roster, not from
    `activeLeague.role`.** Both are true statements about the same membership,
    but only one of them is also the drawer's data — gating the card on the role
    and the panel on the roster is how you get a card that opens an empty drawer.
  - **The drawer is a sibling of the two modals, outside `.stagger`**, and mounts
    on `admin ? … : null` rather than on `settingsOpen && …` — the same two rules
    `StandingsClient` followed, for the same reasons (a `.stagger` child sits at
    opacity 0 for 220ms while its own 320ms slide plays invisibly; unmounting on
    close would throw away the active tab).
  - **The card is `p-4` with a content-driven height where `MoreRow` is `h-16`.**
    Same `bg-fill-soft`, same `rounded-control`, deliberately not the same row:
    the second line of copy is what makes the mock-up's card 80px at 656 and
    102px at 361, and a pinned height would clip the wrap at the phone width.
    Measured at both: 656x79.2 and 361x100.8.
  - **Those two heights are also why it is `items-start lg:items-center`.** The
    copy wraps to two lines at 361 (a 68.8px stack) and the design tops the 40px
    button out with it at y=16; at 656 it is one line (47.2px) and the button
    centres, which is Figma's y=20 because 16 + (47.2 − 40)/2 = 19.6. One
    alignment for both widths is wrong at one of them, and this used to claim the
    design "tops them out together" in both frames — only ever true on the phone.
    Its "Enter" is **black** (`SPEC_BUTTON_DARK`): the desktop frame drew
    Button/Primary where the mobile frame drew the outline control, the two
    mock-ups disagreed, and black was the call.

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
