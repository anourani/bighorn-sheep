# PRD — Two Entries per Player

**Status:** implemented (v1) · **migration `0017` NOT yet applied to production**
**Product:** Last Man Standing (private NFL survivor pool)
**Design:** Figma `xYtvepT86gNj9GTjmO2NNq` — switcher `4234:67832` (desktop) /
`4234:68190` (mobile), picks page `4082:138489` / `4031:119194`, scrolled state
`4234:68232`, module variant `4234:68148`, entry badge `4234:68850`

## Context

One person is one player, and the database says so in four places: `group_members`
carries `unique (group_id, user_id)` (`0001_init.sql:72`), both pick invariants are
keyed on `(group_id, user_id, …)` (`0006_preseason_picks.sql:77`, `:87`), and
`join_by_invite` returns early for anyone who is already a member
(`0002_join_by_invite.sql:79-84`). A player who wants a second, independent run at
the season has nowhere to put it.

The interesting problem is not storage. It is **context at the moment of the tap**.
A pick spends a team for the rest of the phase, so a player who taps the Ravens
believing they are picking for entry 2 when entry 1 is selected has not made a
recoverable mistake — they have spent a team on a run they were not thinking about.
Everything below follows from that: the switcher shows what each entry *holds*
rather than merely which is selected, it follows the module up the screen when the
page scrolls, and the standings board marks a second entry so a doubled name is
never a mystery.

The second risk is quieter: **a forgotten entry 2.** A player who adds one in August
and stops looking at it takes a strike they never saw coming. The switcher's "No
Pick" card is the answer, on both surfaces.

## Goals

- One person may hold **up to two entries** in a league, each with its own picks,
  strikes, elimination and dues.
- **Unmistakable context** at the point of picking, in flow and while scrolled.
- The two entries are **wholly independent** — including being allowed to pick the
  same team in the same week.
- **One row per entry** everywhere a member is listed: standings, admin roster,
  dues.
- **No regression for the ~100% of players with one entry**, on either side of the
  migration.
- Follow the repo's idioms: a sequential **hand-applied** migration, definer RPCs
  for every membership write, stable error codes, no pgcrypto in function bodies.

## Non-goals (deferred)

- **Removing an entry from the app.** `remove_member` takes an entry number now, so
  an admin can do it in the drawer; there is no self-serve path and no "close one
  entry" verb. Closing an account still closes both.
- More than two entries. The cap is a `check` constraint and a guard in `add_entry`,
  changeable without a type change — but the UI, the copy and the badge all assume
  two.
- Naming entries ("Work", "Family"). The badge is a bare digit.
- A per-league cap on entries, or an admin control to grant/deny them.
- Charging for the second buy-in. Dues are still settled off-app; the confirmation
  says what is owed and to whom.

## Rules

| | Entry 1 | Entry 2 |
|---|---|---|
| Created by | `join_by_invite` | `add_entry` only |
| Role | whatever the join set | always `player` |
| Practice (`show_preseason`) | admin-set | starts `false`, admin-set |
| Picks | its own | its own |
| Same team, same week | — | **allowed** |
| Same team twice in one phase | refused | refused (independently) |
| Strikes / elimination | its own | its own |
| Dues | its own | its own |
| Standings badge | none | "2" |
| Closing the account | closes both | closes both |

**A note on the word "entry."** It was already taken: `groups.entry_closes_at` is the
JOIN window, and `MyPicksClient.tsx:61` renders `entry_closed` as "Entry for this
league has closed." Both meanings now live in the product. The overload is
deliberate rather than overlooked — the design names the tabs "ENTRY 1" and "ENTRY
2", and inventing a synonym for the player-facing noun to protect an internal one is
the wrong trade. The two never appear on the same screen: the join window is named
only in error copy and on the dues card's deadline line.

---

## 1 — Data model · migration `0017_two_entries.sql`

**The decision: a `group_members` row IS an entry.** `entry_no smallint not null
default 1 check (entry_no in (1, 2))` joins `(group_id, user_id)` as the identity,
and the three uniques are re-keyed to include it.

**Rejected — re-keying `picks` to `member_id`.** It is the tidier schema and it
would have rewritten every policy, every RPC and every loader to reach the same
place. `picks` references `groups` and `profiles` and has deliberately never
referenced `group_members` — which is why `0013_remove_member.sql:30-35` deletes
picks explicitly rather than leaning on a cascade.

**Rejected — an `entries` table.** Survival state (`status`, `strikes`,
`eliminated_week`) and money state (`buy_in_paid`) are per entry and already live on
`group_members`. A second table would split one row's worth of facts in two.

**The `group_members` unique is unnamed, and that is the migration's one real
hazard.** `0001:72` declares a bare inline `unique (group_id, user_id)`, so Postgres
auto-named it and the string `group_members_group_id_user_id_key` appears **nowhere
in this repo**. Dropping by a guessed name fails in the worst possible way on a
database where anyone renamed it: the migration reports success, the new unique is
added alongside the old one, and the old one goes on refusing every second entry. So
§2 of the file finds the constraint by its **column set** and drops whatever it is
actually called. That loop is also what makes the step replayable.

The rest of the file:

- **Picks RLS gains the hole this opens.** `0014_pick_consistency.sql:57-106` keys
  the writer on `user_id = auth.uid()` alone. Add `entry_no` to the table and that
  is suddenly not enough — a direct PostgREST call with the anon key (which ships in
  the browser bundle; RLS is the real boundary) could write `entry_no = 2` while
  holding only entry 1. Both `with check`s gain an `exists` against `group_members`
  saying *you hold the entry you are writing for*.
- **`hidden_pick_member_ids`** — an entry-aware sibling of `hidden_picks_for_week`
  (`0006:106-126`), returning `group_members.id`. A sibling rather than a
  redefinition, on 0006's own precedent when it added that function beside 0003's.
  A padlock has to land on the entry that picked; a user id cannot say that.
- **`add_entry(p_group_id)`** — the only way a second entry is created. Fails closed
  and raises rather than returning a sentinel: `not_authenticated`,
  `group_not_found`, `not_a_member`, `entry_closed`, `entry_limit`.
- **`join_by_invite` is deliberately untouched.** Turning its already-a-member guard
  into the second-entry path would enrol someone twice every time they re-clicked an
  invite link.
- **`set_member_buy_in` / `set_member_preseason` / `remove_member`** gain
  `p_entry_no int default 1`, added last so every existing named-argument call still
  works and still means entry 1. Each old signature is **dropped** first — a
  three-argument call against both a 3-arg function and a 4-arg-with-default one is
  ambiguous, and Postgres answers that with "function is not unique".
- **`public_league_snapshot`** joins picks on `(user_id, entry_no)`. Left alone it
  would match each of a player's picks to BOTH of their membership rows, showing two
  identical rows on the landing board for entries that had diverged.
- **`reminder_due`** fixes two bugs that pull in opposite directions: a two-entry
  player was two rows and would be **emailed twice**, and the pick branch's
  not-exists ignored the entry, so one entry having picked **silenced the reminder
  for both**. It is now entry-aware but still returns one row per person.
- **`reminder_sends` and its partial unique index are deliberately unchanged.** One
  email per person means the dedupe key `(group, user, season, season_type, week)` is
  exactly right. Adding `entry_no` to it would license the second email this change
  exists to prevent.
- **`close_own_account()` is untouched and closes both entries** — it is keyed on the
  profile id (`0010:60-63`). Said out loud in the migration header and in the UI.

**Replayable.** Every column is `add column if not exists`, every constraint is
guarded on `pg_constraint`, every function is `create or replace`, and the backfill
is the column DEFAULT rather than an `UPDATE` — 0011's `show_preseason` backfill is
the cautionary tale for what a bare update out in the file does on a second run.

`supabase/setup.sql` gets 0017 appended verbatim. (That bundle was already drifted
before this change — it is missing `0013_remove_member` and self-declares broken at
`setup.sql:28-40`. Not fixed here; it wants its own change.)

**The README's deploy probe gains a `pg_constraint` branch.** It checked columns,
routines, tables and one bucket, and no constraints at all — precisely what this
migration rewrites. The dangerous half-applied state is columns present and uniques
not: the app writes `entry_no` happily while the old uniques go on refusing every
second entry, and nothing says so.

---

## 2 — The identity change

**`Member.id` is now the membership id, not the user id.** `toMember` set
`id: row.user_id` (`load.ts:183`) and threw `group_members.id` away — which is why
nothing downstream could tell two entries apart. `Member` gains `userId` and
`entryNo`.

The rule: **`id` identifies the entry and is unique across the league; `userId`
identifies the person and is not.** Anything keying, sorting or addressing a row
wants `id`; anything asking "is this me?" wants `userId`.

`src/lib/game/score.ts:136` already wrote by `group_members.id` and needed no change
at all. Three client sites did, and each would have failed differently:

- `StandingsGrid`'s `isYou` — nobody's row would highlight.
- `viewCurrentPick`'s `isOwn` — **every player's own pick hidden from them** until
  kickoff.
- The admin drawer's three RPC calls, which passed `m.id` as `userId` —
  `member_not_found` on every roster action.

**`viewCurrentPick` also needed an explicit empty-viewer-id guard.** `rankMembers`
passes `""` so nobody's pick counts as revealed early, and `public.ts` maps every
row's `userId` to `""` because the public payload deliberately carries no user ids.
Those two empty strings now MATCH, where an empty string could previously never
equal a uuid — so without the guard the anonymous landing board would reveal every
hidden pick in the league. This is the sharpest edge in the whole change.

---

## 3 — Inert before the migration

CLAUDE.md's hard-won rule is that migrations lag code and PostgREST raises 42703 on
an unknown column, which can escalate "one panel is broken" into "nobody can play".
So the client half is written to be **invisible and harmless** until 0017 is applied:

- Every read is `select("*")` plus `row.entry_no ?? 1`. `loadAccount`'s membership
  query was narrowed to seven named columns and is now a star select for exactly
  this reason.
- **`submitPick` never filters on `entry_no`.** A `.eq()` against a missing column
  fails the same way a `select()` naming it would, and on that path it would turn
  every pick in the app into an error. Entries are filtered in JS.
- The insert payload carries `entry_no` **only when the membership row has the
  column** — `"entry_no" in membership`, feature-detected from a row already in
  hand. If `group_members` has it, so does `picks`; 0017 adds both together.
- **The pick upsert is gone.** `onConflict: "group_id,user_id,season_type,week"`
  named `picks_one_per_week` by its columns, and 0017 re-keys that constraint —
  so the old string names a constraint that no longer exists and the new one names a
  column that does not exist yet. There is no spelling correct on both sides. It is
  now an update-by-primary-key when a pick for this entry and week is already in
  `myPicks`, and an insert otherwise; the existing 23505 handler still covers the
  two-tab race.
- The release delete moved from `(group, user, season_type, week)` to `.eq("id",
  booked.id)` — that tuple stopped identifying one row, and would have deleted the
  other entry's pick for the same week.
- `p_entry_no` is sent to the three admin RPCs **only for entry 2**, so a
  three-argument call still matches the pre-migration function. Entry 2 cannot exist
  before 0017 has run.

**The one accepted degradation is the standings padlock.** `hidden_pick_member_ids`
does not exist until 0017 lands, so the RPC 404s, the array stays empty, and rows
draw a hollow "No pick" circle instead of a padlock. Cosmetic, not a lockout — and
the alternative (keying on user ids until the migration lands) would be silently
WRONG afterwards rather than merely incomplete before.

---

## 4 — The switcher (`EntryTabs`)

Two `flex-1 min-w-[100px] h-[60px] rounded-control border-2` cards at a 4px gap:
a 12px uppercase `Label` eyebrow over a fixed 28px line carrying either a 28px
`TeamLogo` and the team's nickname, or "No Pick". Unselected `bg-fill-soft` /
`border-shell-line` / `text-shell-mute`; selected `bg-accent-faded` /
`border-accent` / `text-shell-ink`. (The frame's #F2F2F2 is one unit off
`fill-soft` #F3F3F3; the token wins.)

- **The card says what each entry HOLDS**, not just which is selected. That is the
  whole reason it is a 60px card and not a segmented toggle: a player who can see
  "Entry 1 — Ravens / Entry 2 — No Pick" cannot tap the wrong one without noticing.
- **No attention dot.** The design hides it, and "No Pick" is a stronger signal than
  a dot beside those words.
- **A real tablist** with a roving tabindex, sharing `nextTabIndex` from
  `ui/tabs.ts` (which wraps, per WAI-ARIA) rather than the week strip's `nextIndex`
  (which clamps). It does **not** reuse `ui/Tabs.tsx`: right ARIA, wrong look, and
  bending it to draw a 60px card with a logo in it would change its three other
  callers.
- **A new `H5` in `type-scale.ts`** (20px/1.2/-0.04em) for the second line. H4's
  docblock already made the argument for adding a step on the strength of one call
  site.
- **Renders nothing below two entries**, which is everybody until somebody takes a
  second — so the `.stagger` cascade and the eight `:nth-child` delay rules are
  untouched for them.
- The active entry is per-device (`PICKS_ENTRY_KEY`), because switching tabs writes
  nothing: the entry rides on each `submitPick` call. The **entries are the fact and
  the stored value is a preference** — someone whose second entry was removed lands
  on the entry they actually hold.

Everything the pick screen derives is scoped to the active entry: `serverPicks`,
`usedByTeam`, `phasePicks`, the practice record (now keyed by membership id), and
the submit chains — which are keyed `${entryNo}|${weekKey}`, because two entries may
hold picks for the same week and one chain per week would let entry 2's tap settle
entry 1's in-flight request. Switching tabs mid-flight still settles the chain the
request belongs to, but stops painting into a view nobody is looking at.

---

## 5 — The scrolled state (`PickStickyBar`)

Figma `4234:68232`: still 89px, the eyebrow pluralised to "Your WK6 Picks", and the
condensed pick row **replaced** by the same two cards. Not a compact variant — the
design draws one control, and a second geometry is how the two would drift.

- **It renders when an entry has no pick**, where the single-entry bar returns null.
  An empty card is not a missing state here; it is the state the switcher exists
  for.
- **The permanent `aria-hidden` becomes conditional.** The single-entry bar is a
  restatement of the hero with nothing focusable, so it stays hidden. The
  multi-entry bar contains two real `role="tab"` buttons, and `aria-hidden` over a
  focusable element is a WCAG failure — a keyboard user reaches a control no screen
  reader can name. The file's own comment demanded the analysis be reopened if the
  bar ever became tappable; it has been.
- `pick-sticky-bar.test.ts` pinned the old pair and was **rewritten rather than
  deleted**. The old assertion would now pass while proving nothing: the focusable
  controls moved into `EntryTabs`, where a regex over that file cannot see them.
  Its neighbour — forbidding a duplicate `<h1>` "the moment the aria-hidden ever
  came off" — stops being hypothetical.
- Still portals, still swallows taps, still `lg:hidden`. One-entry players see no
  change whatsoever.

---

## 6 — Taking a second entry

**No mockup exists**, and the placement is therefore a decision rather than a
transcription: a row where the switcher will appear on the picks page, and the same
row in the account page's Additional Settings. Both are where a player already goes
to think about their entries. Hidden once the entry window closes or at two, matching
the invite row beside it — an affordance the server is going to refuse is worse than
none.

The confirmation is not ceremony. A second entry is **a second buy-in**, real money
owed to whoever runs the league, and — unlike almost everything else in the app — it
**cannot be undone from the UI**. The dialog says both, and names the amount.

---

## 7 — Standings, counts and the rest

**The badge** (`4234:68850`): 20x20, `bg-fill-soft`, 1px `shell-line`, 2px radius
(stock Tailwind `rounded-sm` — the config defines only card/medium/control/pill),
`px-1.5 py-1`, 12px semibold `ink-mute`, reading "2". It sits after the name **on a
player's second entry only**: almost every row in the league is somebody's only
entry, so badging all of them would put a "1" on every line to distinguish the
handful that need it. A bare name still means what it always meant.

The digit is `aria-hidden` beside an `sr-only` "Entry 2" rather than an `aria-label`,
which would leave the visible "2" and the spoken "Entry 2" failing WCAG 2.5.3's
substring rule for voice control.

**Rows rank independently.** No adjacency rule ties a player's two entries together —
they are two competitors, and one may be top of the board while the other is dead.
Both take the viewer highlight, because both are yours. Ties break on entry before
falling back to the id, so two entries never swap places between loads.

**Counts are entries**, because they always counted `group_members` rows: the
headcount grid's aria label, `LeagueDetails`' row (now "Entries"), the admin roster
heading, and `InviteCta`. That last one needs `countNoun`'s explicit plural —
the default is `${singular}s`, and "entrys" is the one word this app's helper gets
wrong. `view.test.ts` has pinned `countNoun(2, "entry", "entries")` since before
anything called it that way.

**Account — League Dues** is its own redesign (Figma `3934:62955`, ten variants:
three states x two viewports x one or two entries). ONE card with a **row per
entry** — Entry Name / League Buy In / Status, three columns from `lg` and stacked
below it — over a shared deadline line, and a footer that is the module's whole
per-state behaviour.

**`partial` is the state two entries made possible**, and it is why the footer keys
off a fold rather than a boolean: one entry settled and one not still owes, so
`unpaid` and `partial` both get How to Pay and only `paid` gets the thank-you.

Two deliberate deviations from the frame, both recorded in
`league-dues-module.test.ts`:

- **The stamp keeps its clock.** The frame reads "Updated 10/21"; the clock exists
  because an admin toggled paid off and on in one afternoon and watched a date that
  never moved — `formatMonthDay` was deleted for it. Transcribing the frame would
  reintroduce that bug exactly. The stamp is `whitespace-nowrap` inside a
  `flex-wrap` row, so it drops to its own line intact rather than breaking between
  the date and the time.
- **The value is the TOTAL owed**, under the frame's "League Buy In" label. The two
  agree whenever the site fee is zero — the row the frame draws — and where a fee
  exists the breakdown sits underneath. This module's job is to say what you owe,
  and under-reporting is the harmful direction.

**The "Add 2nd Entry" button lives here**, below the card on the one-entry variants.
It had two invented placements (the picks page, a row in Additional Settings) while
this design was outstanding; both are gone.

The header's red dot lights when **any** entry is unpaid (`.some`, not `.find`).
Delete Account says it closes both.

**Admin drawer.** One roster row per entry, name plus badge, with "(Entry 2)"
suffixed onto the switch and Remove labels so three controls carrying the same name
are distinguishable. The optimistic overlays and pending keys already keyed on
`m.id` and so became per-entry for free.

---

## Rollout

**0017 is applied to production BY HAND.** Nothing in `netlify.toml` or CI touches
Supabase; merging the PR deploys the code and leaves the database behind. This is the
single most likely way this change ships broken.

1. Run the README probe (`#### Deploying`) and record the before state.
2. Paste `supabase/migrations/0017_two_entries.sql` into the SQL editor.
3. Run the probe again: the two `entry_no` columns and all three
   `constraint: … PRESENT` rows must flip.
4. Verify: `add_entry` refuses a third entry and refuses after `entry_closes_at`; a
   direct authenticated `insert into picks` with `entry_no = 2` from a single-entry
   account is rejected by RLS; both entries of one player may hold the same team in
   one week; one entry may not hold two picks in one week.
5. Nothing is user-visible until somebody calls `add_entry` — the switcher, the
   badge and the dues rows all key on holding two entries.

**Before the migration** the app behaves exactly as it does today, with one
exception: the standings padlock is absent (§3).

**Watch for** `team_already_used` reported where a team was only spent by the other
entry (would mean a scoping bug in `submitPick`), and a missing badge on a known
second entry (would mean `entry_no` is not reaching `toMember`).

## Acceptance criteria

- [x] `0017` adds `entry_no` to `group_members` and `picks`, re-keys all three
      uniques to include it, and replays as a no-op.
- [x] The old unnamed `(group_id, user_id)` unique is found by column set and
      dropped, whatever it is called.
- [x] A direct authenticated pick insert with `entry_no = 2` from an account holding
      only entry 1 is refused by RLS.
- [x] Both entries of one player may hold the same team in the same week; neither may
      hold two picks in one week, or one team twice in a phase.
- [x] `add_entry` refuses a non-member, a closed entry window, and a third entry.
- [x] `reminder_due` returns one row per person, and still reports a player whose
      second entry has not picked.
- [x] `public_league_snapshot` emits `entry_no` and does not cross-assign picks
      between a player's entries.
- [x] `Member.id` is the membership id; `isYou`, `isOwn` and the three admin RPCs
      use `userId`; an empty viewer id reveals nobody's pick.
- [x] The switcher renders nothing for a one-entry player, is a real tablist with a
      roving tabindex, and scopes picks, used teams, practice and submit chains to
      the active entry.
- [x] The sticky bar keeps 89px, pluralises its eyebrow, drops the pick row, and is
      exposed rather than `aria-hidden` when it carries tabs.
- [x] The badge appears on entry 2 only, with `sr-only` text.
- [x] Counts read "entries"; `InviteCta` uses the explicit plural.
- [x] League Dues is one card with a row per entry, states `paid` / `unpaid` /
      `partial`, and carries the Add 2nd Entry button on the one-entry variants.
      Measured in Chromium at 1280 and 393: 12px section gap, 4px header gap,
      20/-0.8px title, 16px `#757575` subtitle, card `#F3F3F3` at 8px radius with
      20/16 padding and a 16px gap, three equal 178.7px columns at a 20px gap on
      desktop and full-width stacked at a 16px gap on mobile, 6px label-to-value,
      1px `#D9D9D9` dividers, `#0C6F28` paid badge at 4px radius, 18px/-0.18px
      values, and no horizontal scroll at either width.
- [x] An admin can mark one entry paid and leave the other unpaid — verified
      against PostgreSQL 16 through `set_member_buy_in(..., p_entry_no)`, including
      that a three-argument call still means entry 1.
- [x] `npm test` (849) and `npm run build` pass; `npm run typecheck` is at its
      pre-existing baseline of 8 errors in `card-reveal.test.ts`, unrelated to this
      change.
- [ ] **0017 applied to production by hand**, and the probe re-run.

## Open questions

- **Removing an entry.** An admin can, through the drawer; a player cannot, and
  closing the account takes both. Is a self-serve "give up entry 2" wanted, and what
  happens to its picks and its dues if it goes?
- **Naming entries.** The badge is a digit. Two entries called "2" across the board
  is legible; "Work" and "Family" would be friendlier and needs a column.
- **A cap per league.** Should an admin be able to switch second entries off, or cap
  the league's total? Today `add_entry` is open to any member while entry is open.
- **The reminder email names no entry.** One email per person is deliberate, but it
  says "you have a pick outstanding" without saying which entry. Adding that needs
  `reminder_due` to return the entry numbers, and a template that reads well for the
  common one-entry case.
- **Three or more.** The cap is one `check` constraint and one guard, but the badge,
  the copy and the two-card switcher all assume two.

---

## Appendix — corrections to the original draft

The draft for this feature was written from memory. Everything below was checked
against the tree before being written up, and the right-hand column is what is true.

| The draft said | Actually |
|---|---|
| `PICK_ERROR` is in `actions.ts` | `MyPicksClient.tsx:45-62`; `entry_closed` at `:50` |
| `StandingsGrid` lives in `components/standings/` | `components/group/` |
| `BottomTabBar` / `AppHeader` in `components/app/` | `components/shell/` |
| `LeagueData` is in `league/types.ts` | `league/load.ts:62-123` |
| There is a `strikes` table | `strikes` is a column on `group_members` |
| The unique is `group_members_group_id_user_id_key` | unnamed inline constraint; that string is nowhere in the repo |
| `pickForWeek` at `picks.ts:99` | `picks.ts:103` (99 is inside the doc comment) |
| picks RLS at `0001:186-236`, `0014:57-107` | `0001:186-238`, `0014:57-106` |
| `join_by_invite`'s guard at `0002:80-85` | `0002:79-84` |
| `gm.id as member_id` at `0009:~100` | `0009:80`; the picks joins are at `:105` and `:118` |
| `TOUR_STEPS` at `:96-138` | `:92-140` |
| `InviteCta` prints a literal "N members" | `countNoun(memberCount, "member")`, now `:95` |
| `rounded-sm` is a project token | stock Tailwind (2px) |
| `setup.sql` is in lockstep | already drifted, and self-declared broken at `:28-40` |
| The `.stagger` root has 6 children | 6 JSX children, **4 DOM children** — `Toast` and `PickStickyBar` portal out |

The draft's UI section also disagreed with the Figma frames it cited: the mobile
picks frame (`4031:119194`) shows a top nav the shipped app does not have, and the
multi-entry scrolled frame (`4234:68232`) has no condensed pick row at all. Both were
resolved in favour of the frames, except the stale top nav, which is ignored.
