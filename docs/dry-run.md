# Testing eliminations on demand

> **Just want to rehearse with friends? Use the preseason practice round instead.**
> Once the real schedule is loaded (`docs/go-live.md`), the week strip leads with
> **preseason** chips that run the loop — pick → lock → reveal → result — against
> real NFL games, with everything resetting at Week 1. That is the better rehearsal,
> and it needs no scripts.
>
> What it deliberately will not do is eliminate anyone: a losing practice pick is
> counted on the practice table and goes no further. So this harness is now the only
> way to see an elimination at all, on top of the one thing real football cannot give
> you: **a specific outcome, right now.** It is how you force an elimination, force a
> whole-group wipeout, or watch a result land the moment you ask for it — instead of
> waiting for an actual game to go against someone.

It is also the only thing outside production that calls `recomputeSeason`
(`src/lib/game/score.ts`), the code that writes `picks.result` and every member's
`strikes` / `status` / `eliminated_week`. Those columns have no test coverage and,
until `SUPABASE_SERVICE_ROLE_KEY` is set in Netlify, nothing else exercises them at
all — so this is currently the only way to prove eliminations work end to end.

Everything runs against your own Supabase project on the real clock; there is no fake
demo data and no frozen time.

**Flags accept either `--name value` or `--name=value`.** (They used to accept only
the `=` form while every example here used spaces, so every flag was silently
ignored — `--phase kickoff` ran `final` and `--winners` was a coin flip. Fixed.)

## 0. One-time setup

1. **Create a Supabase project** (supabase.com). From **Project Settings → API**
   copy the Project URL, the `anon` key, and the `service_role` key.
2. **`cp .env.example .env.local`** and fill in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=…
   NEXT_PUBLIC_SUPABASE_ANON_KEY=…
   SUPABASE_SERVICE_ROLE_KEY=…            # server/scripts only — never NEXT_PUBLIC_
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```
3. **Apply the schema** — in the Supabase SQL Editor, run each migration in order:
   `supabase/migrations/0001_init.sql`, `0002_join_by_invite.sql`,
   `0003_group_create_and_pick_flags.sql`, `0004_profile_names_avatars.sql`, `0005_invite_code_without_pgcrypto.sql`.
   (Or `supabase db push` with the CLI.) Run each **once**: `0004` backfills from
   `display_name` and then drops it, so a second run has nothing to read.
4. **Auth redirect** — under **Authentication → URL Configuration**, add
   `http://localhost:3000/**` to the redirect allowlist so the magic-link email
   returns to your local app.
5. `npm install && npm run dev` → http://localhost:3000

> Magic-link emails go through Supabase's built-in SMTP, which is rate-limited
> for new projects. For a bigger group, set up a real SMTP provider under
> **Authentication → Emails**, or watch **Authentication → Logs** to grab links.

## 1. Create your league

The app has **no create-a-league UI** — the inaugural season runs a single
league, so every player arrives through an invite and the only way in is a code.
The league itself is created once, by hand.

Sign in with your own email first (the magic link creates your account and its
`profiles` row). Then, in the Supabase **SQL editor**, create the league as
yourself:

```sql
-- Your user id: select id from auth.users where email = 'you@example.com';
set local role authenticated;
set local request.jwt.claims = '{"sub":"<your-user-uuid>","role":"authenticated"}';

select * from public.create_group(
  'Your League Name',
  'single',            -- or 'two_time'
  'push',              -- or 'loss'
  2026,                -- season
  '2026-09-10T00:20:00Z'::timestamptz   -- entry closes at the first Week 1 kickoff
);
```

`create_group` reads `auth.uid()`, so it raises `not_authenticated` without those
two `set local` lines — the SQL editor is otherwise an unauthenticated session.

**`p_entry_closes_at` is optional, and what happens when you omit it changed in
0012.** It now derives the deadline from the schedule already in the database —
the earliest `season_type = 'regular'`, `week = 1` kickoff — which is exactly
what the column means. If no such game is loaded it raises
`entry_deadline_unknown` and creates nothing, rather than inventing a date.

So either load the schedule first and omit the argument, or pass it as above.
What you can no longer do is omit it and get a league quietly configured to close
entry a week from now: that was the old fallback, and it locked the inaugural
league out of joining, practice and the rules editor six weeks before Week 1.

The returned row includes your **invite code**. You land in the league as admin;
**Standings → the gear → invite** (or the roster panel) shows the code again.

## 2. Seed a test weekend, aligned to your league

> **If the real schedule is already loaded, skip this section.** Once
> `load-schedule` has run there is nothing left to rehearse against fake data —
> use the **preseason practice round** instead (the HOF/P1–P3 chips at the start of
> the week strip), which is exactly this loop against real games.
>
> The seeder writes into the same `games` table as the real schedule, and the app
> resolves a team's game for a week by taking the *first* match, so a fake game
> sitting next to a real one is a coin flip over which a member sees. The script
> now refuses to seed a week that already holds real games; `--force` overrides,
> and `supabase/cleanup-test-games.sql` removes rows a previous run left behind.

Pick a `week` the league hasn't published yet, and point the seeder at your league
by code so its entry deadline lines up with the first kickoff:

```bash
npm run seed:test-week -- --season 2026 --week 18 --kickoff-in 15 --group YOUR-CODE
```

This inserts 8 games kicking off a few minutes apart. Because the first kickoff
is ~15 min out, the app sits in its **pre-season / entry-open** state: the roster
view shows who's joined, and that week is pickable.

## 3. Friends sign up and join

Share either the invite **code** or the link `…/login?invite=YOUR-CODE`. Each
friend enters their email, taps the magic link, and lands in the league as a real
member. Watch them appear on **Standings** (roster) and in the header tally.

## 4. Everyone makes a pick

On **My Picks**, tap the week you seeded in the week strip, then each player
selects a team. There are two ways to do that, and the **Layout** filter switches
between them: **Grid** (the default) is all 32 teams as cards — tap one — and
**Matchups** is the week's fixtures with a radio button per team. Either saves
immediately, and the pick is editable until that team's game kicks off. On
**Standings**, each rival's current pick shows as a **padlock** — locked in, team
hidden — until kickoff.

Worth exercising both while you have real data in front of you: the grid is the
only surface that shows teams on a bye and teams already spent, so it is where a
wrong used-team list is visible at a glance.

## 5. Advance the weekend

Fast-forward through the states with `sim`. Target the whole week or specific
games (great for a staggered reveal). Pass `--group` so the entry deadline stays
in sync as kickoffs move into the past.

Use the same `--season`/`--week` you seeded in step 2 (the examples below use
week 18, matching that step).

```bash
# Kick off one game first — its picks lock and reveal; others stay padlocked.
npm run sim -- --season 2026 --week 18 --phase kickoff --games test-2026-18-1 --group YOUR-CODE

# Kick off the rest.
npm run sim -- --season 2026 --week 18 --phase kickoff --group YOUR-CODE

# End the week: name the winners; everyone else (and any missed pick) takes the loss.
npm run sim -- --season 2026 --week 18 --phase final --winners kc,dal,buf --group YOUR-CODE
```

After `--phase final`, `sim` runs the real elimination engine
(`src/lib/game/score.ts`) — the same one the production scorer uses — so
strikes, eliminations, and the survivor/deaths tally all update. Refresh the app
and confirm results, washes, and any eliminations look right.

**Always pass `--group`.** It scopes both the entry-deadline sync and the recompute.
Without it, `recomputeSeason` covers every league in the season and one rehearsal
rewrites strikes and eliminations for all of them.

## 6. Force a specific ending

This is the part real football can't be asked to do on cue. Each of these is the
`--phase final` command above with different `--winners`:

- **One elimination.** Name the winners so exactly one member's team loses. In a
  `single` league that eliminates them immediately; in `two_time` it's one strike.
- **A missed-pick loss.** Have someone deliberately not pick, then finalize the week.
  Once the week's *last* kickoff has passed, no pick counts as a loss — same as
  picking a loser.
- **A whole-group wipeout.** Name winners such that every surviving member's team
  loses in the same week. Standings will show everyone out.
- **A single survivor.** Repeat across a couple of seeded weeks until one member is
  left alive.

Two caveats worth knowing. Teams are one-use-per-season, so a multi-week rehearsal
needs each member picking a different team each week. And the app has **no season-end
screen** — `seasonState` in `src/lib/game/elimination.ts` computes winner / wipeout /
multi-survivor, but nothing in the UI reads it, so what you'll actually see is
standings with one or zero members alive rather than a declared result.

## 7. Run another week (optional)

Seed the next week, have everyone pick again (note: teams used already are locked
out), and advance it. Repeat until you're confident the loop holds.

## Resetting

The games live in the `games` table with ids like `test-2026-18-3` — always prefixed
`test-`. `supabase/cleanup-test-games.sql` removes them safely (picks first, then
games; the foreign key forbids the other order). To wipe picks/members for a fresh
run, delete from `picks` / `group_members` for your group (service role or SQL
editor). Re-running `seed:test-week` just upserts the same ids.
