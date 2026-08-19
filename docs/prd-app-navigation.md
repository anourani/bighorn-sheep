# PRD — App Navigation: Sticky Header & League Status Bar

**Status:** proposed · **Product:** Last Man Standing (private NFL survivor pool)

## Problem

The app's chrome is one component doing two jobs. `AppHeader` renders 124px of
stacked bars and pins all of it to the top of the viewport — but only the top
68px is chrome. The bottom 56px is a survivor tally and a per-member strip: a
*reading* of the league at this moment, which is page content, and which never
changes as you scroll. On a phone that is a quarter of the screen permanently
spent on a number nobody needs to see twice.

Worse, being in the layout makes it **stale**. Next preserves layouts across
sibling-route navigation, so tabbing from My Picks to Standings does not
re-render `AppHeader` — its "Week N" and its pre-season countdown hold their
values until a full page load.

The identity is wrong too. The header's headline is the **league's** name, so the
product has none of its own — a player in two leagues watches the app rename
itself when they switch. Meanwhile the league, the thing that actually varies, is
unlabelled and inert: there is still no way to change it from the chrome. League
switching landed on the account page in `c4a50a6`, which stated the gap plainly —
*"the header dropdown is deliberately left for a follow-up; until it lands,
switching happens only on the account page."* The previous PRD
(`docs/prd-landing-and-invite-flow.md:120-122`) and `README.md:179` both name the
switcher as the next step.

This PRD splits the chrome in two, gives the app its own identity, and lands that
deferred switcher.

## Goals

- **Separate chrome from content.** A sticky header that is only navigation; a
  status bar that belongs to the page and scrolls away with it.
- **Give the app an identity** — a mark and a name that don't change with the
  league.
- **Make the league a labelled, switchable control** in the chrome, finishing the
  work `c4a50a6` deferred.
- **Hold the supplied spec exactly** on type, colour, and spacing.

> **Superseded in part.** The Figma `page-header` module (node `3496:23185`)
> folded the bottom tab bar and the league switcher into a single 62px header
> row. `TabBar.tsx` and `LeagueSwitcher.tsx` are deleted; `AppHeader` is 62px,
> reads no league data, and renders the tabs itself via `HeaderNav`. Everything
> below stands as the record of why the header and the status bar were split —
> `LeagueStatusBar` is untouched — but read the *Non-goals* and *Anatomy*
> sections as history.

## Non-goals (deferred)

- The bottom `TabBar` (`src/components/shell/TabBar.tsx`) — unchanged.
  *(Superseded: it has since been absorbed into the header and deleted.)*
- Real branding. The sheep mark and "Sheep with Glasses" are **placeholders**.
- Per-league avatars: `groups` has no `avatar_url` and this PRD doesn't add one.
- Any global palette change. The blue-tinted `ink`/`line` tokens keep their values.
- League actions (rules, invite, settings) in the menu — they stay on Standings.
- The account page's pre-existing 16-query load. See *Data*.

---

## Anatomy — two components, not one

| | Sticky? | Rendered by | Lives in | Height |
|---|---|---|---|---|
| **`AppHeader`** | yes, `top-0` | `src/app/app/layout.tsx` | `components/shell/` | 68px |
| **`LeagueStatusBar`** | **no** | each `page.tsx`, first child | `components/app/` | 56px |

The directories carry the decision. `shell/` is persistent chrome
(`AppHeader`, `TabBar`, `BrandMark`); `app/` is cross-screen page content, which
is already what `NoLeagueState` is. Moving the bar out of `shell/` is the point of
the change, expressed in the file tree.

Stacked at the top of a fresh page they read as the single 124px block in the
design. The difference only shows on scroll.

## Experience 1 — `AppHeader` (sticky)

`display: flex; justify-content: space-between; align-items: flex-start;`
`padding: 16px 16px 12px` — 16 + 40 + 12 = 68px, falling out of the 40px mark
rather than being hardcoded.

- **Left — app identity** (`row`, `gap: 12px`, `align-items: center`): a **40×40
  image, `border-radius: 4px`**, then the app name at `18px / 600 / line-height
  120% / #1E1E1E`. Stays a `<Link href="/app">`.
- **Right — the league** (`column`, `gap: 4px`, `align-items: flex-start`,
  shrink-to-fit at the right edge): the eyebrow **`LEAGUE`** at `12px / 600 /
  line-height 100% / uppercase / #757575`, then a row (`gap: 4px`) of the league
  name at `16px / 600 / 120% / #1E1E1E` and a **16×16 chevron**.
- The season range ("2026-2027") that bar 1 shows today is **dropped**.

**`MinimalHeader` is deleted.** Under this design the left block no longer touches
league data — it is a mark and a constant — so the "minimal" and "full" headers
have identical left halves. The header becomes: left block always, right block
only when there is an active league. That collapses ~127 lines to ~55 and removes
a duplicated brand block.

**The app name conflicts with the rest of the app.** "Last Man Standing" appears
in `src/app/layout.tsx:14-17`, `public/manifest.webmanifest`, `src/app/page.tsx:10,27`,
`src/app/login/page.tsx`, and `src/app/global-error.tsx:48`. Putting "Sheep
with Glasses" in the header alone means the browser tab and the PWA install
prompt say one thing and the header says another. Introduce a single exported
`APP_NAME` constant so there is one place to change it, and treat the rename as a
follow-up across those files — do not hardcode a second literal.

**The chevron already exists.** `ChevronDownIcon` (`src/components/icons.tsx:53`)
is `M6 9l6 6 6-6` on a 24-grid — 25% left/right insets, 37.5% top/bottom,
matching the spec's `Icon` block exactly. `Base` spreads `{...props}` *after* its
own `strokeWidth={1.75}`, so at 16×16 one grid unit renders 0.667px and the
spec's 1.6px needs `strokeWidth={2.4}`. No new icon. `WeekPicker.tsx:106-107`
already documents this arithmetic — note in passing that 2.4 giving a true 2px at
20×20 *and* a true 1.6px at 16×16 is a coincidence, not a universal constant.

### The league switcher

Opening it lists **the viewer's leagues and nothing else** — rules, invite and
settings already have homes on Standings.

Choosing one calls the existing **`selectLeague(groupId)`**
(`src/app/app/actions.ts:480-514`), which re-checks membership, writes the
httpOnly `lms_active_league` cookie, and `revalidatePath`s all three routes. Then
`router.refresh()`, matching `LeagueCard` (`AccountClient.tsx:205-256`). No new
action, no new cookie, no new resolution rule — `resolveActiveGroupId`
(`src/lib/league/active.ts:27`) still decides and still falls back to
earliest-joined on a stale cookie. Wrap the call in
`isStaleDeploymentError`/`reloadOnce` per CLAUDE.md, as every other call site does.

**Mechanism: a transparent native `<select>` laid over the trigger markup** — the
pattern `WeekPicker.tsx:7-25` argued for and commit `44ba98d` verified in a
browser.

> **`WeekPicker.tsx` no longer exists.** The week selector is a horizontally
> scrolling strip of chips now (`WeekStrip.tsx`), so this file is the argument's
> home; read it here rather than chasing the citation. Two points carried it: a
> `<select>` can only ever display its *selected option's own text*, so anything
> the open list needs to add (there, a "· current" marker) cannot appear on the
> trigger; and it sizes itself to its *widest* option, so `appearance-none`
> leaves dead space wherever the trigger is narrower than the longest entry. The
> deleted file's docblock is still in git if you want it verbatim. Its
> `ProfileCard.tsx` sibling — the favorite-animal picker — is now the app's only
> live example.

The decisive reason applies with more force here than it did there: a
`<select>` sizes itself to its *widest* option, so with `appearance-none` a single
long league name would set the control's width permanently and shove the name and
chevron away from the right edge the spec pins them to.

The platform also **does** mark the selected option — a checkmark on macOS/iOS, a
radio dot on Android, announced as "selected" — so the current-league affordance
comes free and with better semantics than a hand-rolled `aria-checked`.

Against a hand-rolled popover: there is no Radix and no popover primitive here
(deps are `clsx` + `tailwind-merge`), so it would mean owning `aria-expanded`,
roving focus, Escape, outside-click, and viewport clamping at 390px. There is
also a specific trap — the header's `backdrop-blur-md` makes it a containing
block for `position: fixed` descendants, so a "fixed" panel would position
against the header, not the viewport.

**Overlay geometry needs care, because the header is only 68px.** The right column
measures 12 + 4 + 19.2 = 35.2px. Lay the select over the whole column with
**`-inset-y-1`**: 35.2 + 16 = 43.2px, meeting the `tap-target` intent while
staying inside the header's own padding. Do **not** use `-inset-y-2`, the value
the week picker used — it would spill past the header's bottom border and put an invisible interactive
surface over the top of the status bar, silently swallowing clicks there.

**State must not be local `useState`.** The header is in the layout and the layout
survives navigation, so switching leagues from the account page and then tabbing
to My Picks would leave a `useState` select showing the old league beside a
server-rendered name showing the new one. Use **`useOptimistic(activeId)`** — it
reverts on failure and re-syncs whenever the prop changes. Controlled-by-prop with
`disabled={pending}` is the fallback.

### States

- **No league.** The right-hand block is omitted entirely; the left block is
  unchanged. The body already renders `NoLeagueState`, which says so in the right
  place — don't add a "LEAGUE / none" placeholder.
- **Exactly one league** (`leagues.length === 1`). Render the name as plain text,
  **no chevron and no control**. A disclosure that discloses one already-selected
  item is a dead end, and on iOS a one-option select still opens a full-screen
  wheel to change nothing. Accepted trade: the affordance isn't discoverable until
  you join a second league, at which point the header re-renders with it.
- **Switch fails.** There is no room for an error line in 68px. Revert the
  optimistic value, `router.refresh()`, and render a `role="alert"` one-liner
  *absolutely positioned below* the header so it can never change its height.

## Experience 2 — `LeagueStatusBar` (page component)

`display: flex; align-items: center; gap: 24px; padding: 8px 16px` — 8 + 40 + 8.

- **Text block** (`column`, `gap: 4px`): **"Week 6"** at `14px / 500 / 120% /
  #1E1E1E`, then a row (`gap: 6px`) of **"29 survivors."** at `14px / 500` and
  **"15 deaths."** at `14px / 500 / #6A6A6A`.
- **Strip** (`row`, `gap: 2px`, `flex-grow: 1`): one cell per member, `height:
  40px`, `border-radius: 2px`, `flex-grow: 1` — `#D9D9D9` for eliminated first,
  then `#FC855C` for alive.

**This is a relocation, not a restyle.** `AppHeader.tsx:78-103` already renders
every one of those values correctly. The single visual change in the entire lower
bar is the survivors text: `#B35838` today (`:82`), black in the spec.

**Shape: an async self-fetching wrapper plus an exported presentational view.**
The wrapper takes no props and calls the request-memoized `loadLeague()`, so each
page is a one-liner and the account page — which has no `LeagueData` to pass down
— works identically. `LeagueStatusBarView` takes plain props beside it, which is
what makes the whole thing renderable in a fixture harness with no database. Two
lines of structure that buy the entire verification story.

**Pre-season is retained** unchanged: "Pre-season" / "Starts in {countdown}." /
"{n} joined.", all cells orange. The countdown is computed server-side from
`nowIso` and does not tick — deliberate, per `load.ts:335-337`. Moving the bar
into the page makes it *fresher* than today, because it now re-renders on every
tab switch instead of once per full page load. (Fix the dead ternary at
`AppHeader.tsx:62` while transcribing — both branches are `"joined"`.)

**Placement.** First child of each `page.tsx`, as a **sibling of** the page's
client root — which is `<div className="stagger space-y-N">` in all three
(`MyPicksClient.tsx:203`, `StandingsClient.tsx:80`, `AccountClient.tsx:286`). As a
*child* it would shift every existing `.stagger` delay by 55ms and give the bar an
entrance animation it shouldn't have.

**Full-bleed.** `main` is `flex-1 px-4 pb-20 pt-10 lg:pb-32 lg:pt-16`
(`src/app/app/layout.tsx`), so a first child would be inset 16px, pushed down
40px (64 from `lg`), and its border would stop short of the shell edges. The bar
therefore self-applies **`-mx-4 -mt-5 mb-5`**. (The vertical half of that never
shipped: `StatusReport` ended up a child of `StandingsClient` with `-mx-4
lg:mx-0` and no negative top margin. Nothing in `src/` cancels `main`'s vertical
padding.)
`main`'s content box is 968px inside a 1000px border box, so `-mx-4` puts the
bar's edges exactly on the shell's — the same width as `AppHeader`, its sibling in
that flex column. `main` is untouched.

The alternative — stripping `main`'s padding and pushing it into the pages —
looks cleaner but is 6+ files, not 3: `main` also renders `src/app/app/error.tsx`,
and `NoLeagueState` (`src/components/app/NoLeagueState.tsx:20`) has **no
horizontal padding of its own** and would touch the screen edges at 390px. It
would also establish a standing invariant that the next route added will silently
violate. The negative margins are an implicit dependency on `main`'s exact
padding, so the docblock names `layout.tsx:15` as the contract.

---

## Data

**The league list costs nothing.** `load.ts:180-184` already selects *every*
membership for the viewer (ordered `joined_at` ascending) to resolve the active
group; `:194-198` then narrows to one with `.eq("id", activeGroupId).single()`.
Widen that same query to `.in("id", groupIds)` and pick the active row out in
memory. `loadAccount:400-406` already uses this shape, with a comment noting RLS
cannot widen the result. `.in()` returns rows in arbitrary order, so re-project
through the membership order — otherwise the menu disagrees with
`resolveActiveGroupId`'s earliest-joined fallback.

`LeagueData` gains one field; `LeagueLoad` is unchanged, since the list only
matters when there's an active league:

```ts
/** Every league the viewer belongs to, earliest-joined first — the switcher's list. */
leagues: LeagueOption[];   // { id, name }
```

Note the near-collision worth a docblock line: `AccountData.leagues` is
`LeagueSummary[]` (role, status, strikes, buy-in, phase, counts);
`LeagueData.leagues` is `LeagueOption[]` (id and name).

**Adding the bar to `/app/account` costs zero queries.** `AppHeader` is rendered
by the layout (`layout.tsx:14`), the layout wraps `/app/account`, and `AppHeader`
calls `loadLeague()` (`AppHeader.tsx:20`) — so `loadLeague()` *already* runs on
every account request alongside `loadAccount()`. `loadLeague` is `cache()`d at
`load.ts:153`, so the bar's call is free.

That account page is already heavy — about 16 PostgREST calls, four of them exact
duplicates, including two full-season `games` fetches it renders nothing from.
That is **pre-existing and unchanged by this work**, and out of scope. The fix
would be a lighter shared `loadLeagueChrome()`; noted below.

## Design tokens

The spec's greys are pure neutrals; the app's are blue-tinted, and the two are
visibly different where they meet at a 1px border. Add the spec's values as their
own family — `ink` `#111827`, `ink-mute` `#6B7280` and `line` `#D8DADF` keep
their values and every screen not built to the spec is untouched.

This started life as "use it only in the shell", and that is no longer true: the
pick module on My Picks is built to the spec's greys and uses `shell-ink`,
`shell-mute`, `shell-line` and `shell-dark` throughout. The rule the family
actually encodes is *the spec's pure neutrals, wherever a screen is drawn to the
spec* — not *the app shell only*.

```ts
shell: {
  ink:   "#1E1E1E",  // app name, league name, "Week 6", chevron
  mute:  "#757575",  // the LEAGUE eyebrow, all Labels
  soft:  "#6A6A6A",  // "15 deaths."
  line:  "#D9D9D9",  // hairlines, eliminated cells, the mark placeholder
  dark:  "#A5ACAF",  // the spec's "border-dark" — the pick module's inert strips
  alive: "#FC855C",  // living cells — not `brand`, and not the green `alive` hue
},
```

Name it `shell` (matching `components/shell/` and the existing `maxWidth.shell`),
**not `neutral`** — `extend.colors.neutral` silently replaces Tailwind's built-in
`neutral-50..950` scale. Verified safe: no `neutral-*`/`zinc-*`/`stone-*` classes
exist in `src/`.

**Drift this retires:** `AppHeader.tsx:73,97,100` (`#FC855C`, `#D9D9D9`),
`AppHeader.tsx:60,82` (`#B35838`, which disappears entirely), `WeekPicker.tsx:54`
(`text-[#757575]`) and `:108` (`text-[#1E1E1E]`) — and most valuably
**`src/components/ui/Label.tsx:27`**, the shared component behind every grey label
in the app, which hardcodes the same `#757575`.

**One reuse worth taking.** The header eyebrow is `Label`'s exact treatment one
size down, but it must be a real `<label htmlFor>` (so the accessible name is the
on-screen string and cannot drift) and `Label` renders a `<span>` — which is why
`WeekPicker.tsx:49-50` copies the classes by hand and says "keep the two in sync".
Rather than create a third copy, give `Label` an optional `htmlFor` that switches
it to `<label>`, and retire WeekPicker's hand-copy in the same breath.

**One inconsistency in the spec:** the week is `#1E1E1E` but "29 survivors." is
`#000000` — two near-identical blacks 8px apart, almost certainly unintentional.
Transcribe as given (`text-black` already appears at `WeekPicker.tsx:105`) and
flag it; this repo's habit is to note spec oddities rather than silently
normalise them.

## The app mark

Slot it at **`public/icons/app-mark.jpg`**, rendered
`className="h-10 w-10 shrink-0 rounded-[4px] bg-shell-line object-cover"` with
`width={40} height={40}` to reserve space. The `bg-shell-line` is deliberate and
mirrors the spec's own `background: url(.jpg), #D9D9D9` — a grey square shows
until the real asset lands. Commit an 80×80 source and render it at 40 CSS px; no
`onError` state machine (the asset is local), no `loading="lazy"` (above the fold),
and `alt=""` since the visible app name inside the same `<Link>` already names it.

**`/icons/`, not `/brand/`, and this matters.** The service worker only caches
paths under `/_next/static/` or `/icons/` (`src/app/sw.js/route.ts:122-123`), so a
mark at `/brand/` would be the one image guaranteed to be on screen in a PWA and
guaranteed to be missing offline. Adding it to the `SHELL` precache array
(`:55-60`) makes it available on first install.

Use a plain `<img>`, not `next/image`. The documented reason in `Avatar.tsx:56`
(avoiding `remotePatterns`) genuinely doesn't apply to a local file, so the honest
reasons are: it would put the app's most visible above-the-fold element behind
Next's image-optimisation endpoint on every authenticated screen, and the savings
on a 40px mark are single-digit kilobytes. Give the eslint-disable an accurate
reason rather than copying the remote-host one.

## States & errors

| State | Trigger | UX |
|---|---|---|
| No league | `loadLeague()` returns `no_group` | Left block only; no status bar; body renders `NoLeagueState` |
| One league | `leagues.length === 1` | League name as plain text; no chevron, no control |
| Switch fails | `not_a_member` / `unexpected_error` | Revert optimistic value, `router.refresh()`, absolutely-positioned `role="alert"` line. Copy keyed on `res.error`, never raw DB text |
| Stale cookie | Cookie names a league you left | `resolveActiveGroupId` falls back to earliest-joined; menu shows the fallback selected |
| Pre-season | `phase === "preseason"` | Countdown variant; header unchanged |
| Season ended | `phase === "ended"` | Final week and tally; no special casing |
| Very large league | ~59+ members at 390px | Cells go sub-pixel. **Known limit** — see below |
| Mark missing | Asset absent or 404s | The grey square shows. No broken-image icon, no layout shift |

**The strip's break-even**, given `px-4`, `gap-6`, a ~160px text block and 2px
gaps: cells fall below 1 CSS pixel at roughly **59 members at 390px** and **262 at
1000px**; past ~87 on a phone the gaps consume the whole track. This is
pre-existing, so it is documented rather than fixed here — turning a UI
transcription into a behaviour change is how diffs stop being reviewable. The fix,
recorded so it isn't re-derived: a pure `survivorStrip(alive, eliminated,
{ maxCells })` in `view.ts` returning per-member cells below a ~48 threshold and a
two-segment proportional bar above it, which preserves the ratio — the only
information left at 1px — and is trivially testable.

## Verification

**There is no CI.** Nothing runs on a PR; the green checks are Netlify's redirect
and header linters and do not test the app. Run everything locally.

**Unit-testable** (vitest, existing files — the repo has zero component tests, no
jsdom, no testing-library, all 13 test files are pure functions):

- **`toLeagueOptions(memberIds, groups)`** in `active.ts` — preserves join order
  regardless of `.in()` result order, drops ids with no group row, `[]` on empty.
  This is the only genuinely new logic in the change.
- **`statusLine()`** in `view.ts` — extract the bar's copy so the two JSX variants
  collapse into one `{ lead, primary, secondary }`. Covers phase and
  singular/plural, and kills the dead ternary at `AppHeader.tsx:62`.
- `survivorCounts` and `resolveActiveGroupId` are already covered and don't change.

**Must be seen in Chromium** (preinstalled at `/opt/pw-browsers`). `createClient()`
throws without env, so follow `c4a50a6`'s precedent: a throwaway harness route
rendering `LeagueStatusBarView` and `LeagueSwitcher` against fixtures, deleted
before committing. At **1000px and 390px**:

- Header 68px, bar 56px, both borders `rgb(217,217,217)`; right block hugs the
  edge (`header.right - block.right === 16`).
- Type: app name `18px/600/21.6px`; eyebrow `12px/600/12px` uppercase
  `rgb(117,117,117)`; league name `16px/600/19.2px`; "29 survivors."
  **`rgb(0,0,0)`**; "15 deaths." `rgb(106,106,106)`.
- Chevron: assert the *rendered* stroke is 1.6px, not the attribute.
- **Overlay integrity** (the `44ba98d` protocol): `elementFromPoint` returns the
  `SELECT` at the name, the chevron, and the eyebrow — and returns the **status
  bar, not the select**, 1px below the header's border. Select height ≥ 43px. Tab
  reaches it; the ring paints on the trigger, not invisibly on the select.
- **Full-bleed:** `bar.width === main.width` and `bar.left === shell.left`;
  `bar.top === header.bottom`; 20px gap to the first page element on all three.
- **The behaviour this PRD is about:** scroll 200px → `header.top === 0` **and**
  `bar.top < 0`, on all three routes.
- Strip: cell count === member count; first `deaths` cells grey, rest orange.
- States: one league (no `<select>` in the DOM), no league, pre-season.
- `.stagger` intact — first child of each client root still `animation-delay: 0ms`.
- **390px with a long-league-name fixture:** `scrollWidth === 390`. The budget is
  tight (~384px), so spec the policy: left block `min-w-0` with the app name
  `truncate`; right block `shrink-0` but the league name `truncate` at ~45%.

**Manual, on hardware** (agents can't reach the deployed site — CLAUDE.md's egress
note): iOS Safari opens the wheel on tap and `backdrop-blur` doesn't eat it;
switching from the account page's Select League leaves the header switcher in
agreement.

Then `npm run typecheck`, `npm test`, `npm run build`.

## Open questions / future work

- **The app name.** "Sheep with Glasses" vs. "Last Man Standing" in eight other
  places — placeholder or rename? Resolve before building.
- **`#000000` vs `#1E1E1E`** for the survivors count.
- **Header background.** `bg-white/85 backdrop-blur-md` (`AppHeader.tsx:35`) is
  the established frosted chrome, but the orange strip will now ghost through it
  while scrolling under. Figma can't express a backdrop filter, so the spec's flat
  white is not evidence. Keep the frost; flag it for visual review, `bg-white` is
  the one-class fallback.
- **The season range and "NFL Survival League"** both disappear with bar 1 and
  `MinimalHeader`. `group.season` would then have no on-screen home outside
  Standings — confirm that's intended.
- **A `groups.avatar_url`** would let the mark be per-league, which may be what a
  multi-league player wants. Needs a migration, and migrations here are applied to
  production **by hand**.
- **The strip past ~59 members** — see above.
- **`LeagueDetails`** (`src/components/group/LeagueDetails.tsx:85`) also shows a
  survivor count. With the bar directly above it, Standings now states it twice.
- **The account page's 16 queries** — a shared `loadLeagueChrome()` is the fix.
  Separately, `group_members.select("group_id, joined_at, groups(*)")` would
  collapse `load.ts:180` and `:194` into one embedded query, at the cost of hairier
  generated typings.
