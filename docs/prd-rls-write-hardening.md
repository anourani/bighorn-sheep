# PRD — Hardening Direct Writes: Membership & Picks

**Status:** proposed · **Product:** Last Man Standing (private NFL survivor pool)

## Context

The browser talks straight to PostgREST with the public anon key, so **Row-Level
Security is the only real boundary** — the server actions in `src/app/app/actions.ts`
are a convenience and a source of good error copy, not a gate. Anyone signed in can
skip them and `POST /rest/v1/...` directly with the anon key that ships in the JS
bundle. `0001_init.sql` states this explicitly for picks ("pick integrity … must
not be trustable to a client"), and the app already honours it almost everywhere:
every sensitive write goes through a `SECURITY DEFINER` RPC (`set_member_buy_in`,
`set_group_name`, `set_group_rules`, `set_group_buy_in`, `close_own_account`,
`join_by_invite`, `create_group`).

Two write paths were left under-constrained at the RLS layer, and both are reachable
by a direct API call:

- **S1 (launch blocker).** The `group_members` INSERT policy admits any self-owned
  row with any `role`, no invite, no entry-window check. A fresh account plus the
  league UUID (which ships in every member's page payload) is enough to self-insert
  as **admin** — bypassing the invite entirely and gaining every member's phone
  number, the buy-in/paid toggles, league rename, and the rules editor.
- **S2 (pre-Week-1, lower severity).** The `picks` INSERT/UPDATE policies check only
  that the referenced game hasn't kicked off. Nothing ties `picks.week` /
  `season_type` / `team_id` to that game, so a direct call can write an internally
  inconsistent pick row — e.g. `week = 1` pointing at a Week 10 game, or a team that
  isn't playing in the referenced game. The realistic harm is narrow (a mismatched
  week/game row could let someone dodge a Week-1 result by pointing it at a game
  that never resolves in time); the "pre-fill future weeks" and "pick after
  elimination" variants confer no advantage, because the scorer re-derives status.

Both are the same shape: **the app enforces the rule; the database underneath does
not; the anon key makes the database the real boundary.**

This is one PRD covering both, because they are the same class of bug and read
better together. The **delivery is two independent migrations** so the launch
blocker (`0013`, S1) can ship without waiting on the pick-integrity change
(`0014`, S2). They can be applied in either order.

## Goals

- Make the database reject the writes the app would refuse, so integrity does not
  depend on a client choosing to go through the server action.
- **No functional regression.** Every legitimate write already flows through a
  definer RPC (membership) or the app's own upsert (picks) — verified below.
- Follow the repo's established idioms: a new sequential, **hand-applied**,
  idempotent migration; `revoke`/`grant` where functions are involved; no pgcrypto
  in function bodies; never rewrite an applied migration.

## Non-goals (deferred)

- Rate limiting of server actions and anon RPCs (separate concern; see the scale
  review).
- The other security items from the launch review: broad `profiles` read exposure
  (S3), name length caps (S4), HSTS/CSP headers (S5).
- An admin-promotion / role-change feature. There is no legitimate role-change path
  today (the only admin is the group creator, set by `create_group`), so none is
  removed here. If one is wanted later it is a new definer RPC, not a relaxed policy.
- The `is_group_member` InitPlan optimization on the picks **read** path (a
  performance item, tracked in the scale review — not this security change).

---

## Fix 1 — `group_members` (S1) · migration `0013`

**Root cause.** `supabase/migrations/0001_init.sql:174-175`:

```sql
create policy "members insert self" on public.group_members
  for insert to authenticated with check (user_id = auth.uid());
```

The only constraint is "the row is about me." `role`, the invite code, and the
entry window are all unchecked.

**Why dropping it is safe (verified).** No client code inserts into `group_members`
— the only writes are the scorer's service-role `.update` (`src/lib/game/score.ts`)
and RPC calls. The two legitimate insert paths, `join_by_invite`
(`0002_join_by_invite.sql`) and `create_group` (`0003`/`0005`), are both
`SECURITY DEFINER` and therefore **bypass RLS** — they do not depend on this policy.
With RLS enabled and no INSERT policy, direct client inserts are denied by default,
which is exactly the desired end state. Dropping (rather than tightening to
`role = 'player'`) also closes the invite-less self-join, not just the admin
escalation.

**The migration** (`supabase/migrations/0013_lock_membership_writes.sql`):

```sql
-- Membership is created only by the SECURITY DEFINER functions join_by_invite
-- (0002) and create_group (0003/0005), both of which bypass RLS. The client-facing
-- INSERT policy added in 0001 constrained only user_id = auth.uid(), so a direct
-- PostgREST call with the anon key could self-insert an ADMIN row in any league
-- (the group id ships in every member's payload), bypassing the invite and the
-- entry window. No client code inserts into group_members, so removing the policy
-- denies the attack and costs no functionality. Idempotent.
drop policy if exists "members insert self" on public.group_members;
```

**Verification (SQL editor / a signed-in anon-key session):**

- A direct `insert into group_members (...)` from an authenticated session is now
  rejected (RLS: no policy → deny).
- `join_by_invite('<code>')` still enrolls a player (definer path, unaffected).
- `create_group(...)` still creates a league + admin membership (definer path).
- The app's join flow (`JoinByCode`, the invite-link callback) still works end to
  end.

---

## Fix 2 — `picks` (S2) · migration `0014`

**Root cause.** `supabase/migrations/0001_init.sql:201-228`. The INSERT `with check`
and the UPDATE `with check` verify only that the referenced game is future +
scheduled; they never tie the pick's own columns to that game.

**Approach — tighten the policies (proportionate to the LOW severity).** Add the
game-consistency invariants to the `with check` of the INSERT and UPDATE policies:
the pick's `week`, `season_type`, and `team_id` must match the referenced game, and
the game must belong to the group's season. This closes the only variant with real
integrity impact (mismatched week/game rows) and the "pick a team that isn't in the
game" case, at near-zero cost, while leaving the hot Sunday-noon write path an
ordinary upsert.

```sql
-- INSERT: a pick may only be written if it is internally consistent with the game
-- it references. The kickoff guard was already here; week/season_type/team/season
-- consistency was not, so a direct API call could write week=1 pointing at a Week 10
-- game, or a team not playing in the referenced game. Idempotent (drop+recreate).
drop policy if exists "picks insert own before kickoff" on public.picks;
create policy "picks insert own before kickoff" on public.picks
  for insert to authenticated with check (
    user_id = auth.uid()
    and public.is_group_member(group_id)
    and exists (
      select 1
      from public.games g
      join public.groups gr on gr.id = picks.group_id
      where g.id = picks.game_id
        and g.kickoff > now()
        and g.status = 'scheduled'
        and g.week = picks.week
        and g.season_type = picks.season_type
        and g.season = gr.season
        and picks.team_id in (g.home, g.away)
    )
  );

-- UPDATE: the `using` clause still gates WHICH existing rows you may change (your
-- own, current game not yet kicked off); the `with check` now also enforces that the
-- NEW values are consistent with the newly-referenced game.
drop policy if exists "picks update own before kickoff" on public.picks;
create policy "picks update own before kickoff" on public.picks
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.games g
      where g.id = picks.game_id and g.kickoff > now() and g.status = 'scheduled'
    )
  )
  with check (
    user_id = auth.uid()
    and public.is_group_member(group_id)
    and exists (
      select 1
      from public.games g
      join public.groups gr on gr.id = picks.group_id
      where g.id = picks.game_id
        and g.kickoff > now()
        and g.status = 'scheduled'
        and g.week = picks.week
        and g.season_type = picks.season_type
        and g.season = gr.season
        and picks.team_id in (g.home, g.away)
    )
  );
```

**Deliberately de-scoped from the policy (documented in the migration):**

- **"Member is alive"** and the **entry window**: already enforced by `submitPick`
  (`canPick`) and, decisively, re-derived by the scorer each run — an eliminated
  member who writes a pick directly gains nothing, because `recomputeSeason`
  recomputes status from results regardless. Expressing these in RLS adds a
  `group_members` subquery to the write path for no integrity gain.
- **The DELETE policy is left as-is.** The app never deletes picks (verified: no
  client `.delete` on `picks`; the app overwrites via upsert), and the existing
  DELETE policy is already scoped to own-row + before-kickoff.

**Alternative considered — a `submit_pick` definer RPC (not chosen).** Moving the
write into a `SECURITY DEFINER` RPC and dropping the direct picks policies would
match the "definer RPC for every sensitive write" idiom most purely. Rejected for
this change because: (a) it adds a round-trip and duplicates the well-tested
`canPick`/`elimination.ts` logic into SQL, on the one write path that spikes hardest
at kickoff (see the scale review's Sunday-noon estimate); and (b) the consistency
predicates above already close the only variant with real impact, at a fraction of
the cost. Revisit if pick writes move server-side for other reasons.

**Verification:**

- Direct `insert into picks` with `week` not matching the game, or a `team_id` not
  in `(home, away)`, or a `game_id` from another season, is now rejected.
- A normal pick through the app (`submitPick`) still succeeds; changing a pick before
  kickoff still succeeds; `team_already_used` / kickoff-lock behaviour unchanged.
- `npm run typecheck && npm test` (434 tests) still pass — no app code changes are
  required for Fix 2, since `submitPick` already writes consistent rows.

---

## Rollout

**Both migrations are applied to production BY HAND** — this repo's defining
operational rule (`CLAUDE.md`, `docs/go-live.md`). Merging the PR deploys nothing to
the database. Each migration is a `drop policy … / create policy …` pair, so both are
idempotent and replayable, and neither has a backfill.

- **Sequencing:** apply `0013` **before launch** (it closes the admin-escalation
  blocker). Apply `0014` **before Week 1** (pick integrity matters once real games
  score). They are independent and can be applied in either order.
- **Hand-over:** whoever ships the migrations pastes both SQL bodies and the
  verification queries into the Supabase SQL editor, and confirms production is
  unchanged until they are run — per the repo convention for any
  `supabase/migrations/` change.

## Acceptance criteria

- [ ] `0013` removes the `group_members` self-insert policy; a direct authenticated
      insert into `group_members` is denied; `join_by_invite` and `create_group`
      still work; the app join flow is unaffected.
- [ ] `0014` rejects a direct pick insert/update whose `week`, `season_type`,
      `team_id`, or season is inconsistent with the referenced game; a normal app
      pick and a pre-kickoff change still succeed.
- [ ] `npm run typecheck` and `npm test` pass.
- [ ] Both migrations are handed over with the SQL and a plain "apply by hand" note.
