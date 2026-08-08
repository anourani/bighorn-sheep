# Pre-season dry run — test the whole loop before Week 1

This walks a real group of friends through the entire survival loop —
sign up → join → pick → lock → reveal → result → elimination — using a
**seeded test weekend** you control, so you can shake the app out before any
real NFL game exists. Everything runs against your own Supabase project on the
real clock; there is no fake demo data and no frozen time.

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

Sign in with your own email (the magic link creates your account), then on
**Account** → **Create a group**. You land in it as admin. Open **Standings →
the gear → invite** (or the roster panel) to copy your **invite code**.

## 2. Seed a test weekend, aligned to your league

Pick a `season`/`week` that won't collide with real data (e.g. this year, week 1)
and point the seeder at your league by code so its entry deadline lines up with
the first kickoff:

```bash
npm run seed:test-week -- --season 2026 --week 1 --kickoff-in 15 --group YOUR-CODE
```

This inserts 8 games kicking off a few minutes apart. Because the first kickoff
is ~15 min out, the app sits in its **pre-season / entry-open** state: the roster
view shows who's joined, and Week 1 is pickable.

## 3. Friends sign up and join

Share either the invite **code** or the link `…/login?invite=YOUR-CODE`. Each
friend enters their email, taps the magic link, and lands in the league as a real
member. Watch them appear on **Standings** (roster) and in the header tally.

## 4. Everyone makes a Week 1 pick

On **My Picks**, each player selects a team from the schedule. The pick saves
immediately and is editable until that team's game kicks off. On **Standings**,
each rival's current pick shows as a **padlock** — locked in, team hidden — until
kickoff.

## 5. Advance the weekend

Fast-forward through the states with `sim`. Target the whole week or specific
games (great for a staggered reveal). Pass `--group` so the entry deadline stays
in sync as kickoffs move into the past.

```bash
# Kick off one game first — its picks lock and reveal; others stay padlocked.
npm run sim -- --season 2026 --week 1 --phase kickoff --games test-2026-1-1 --group YOUR-CODE

# Kick off the rest.
npm run sim -- --season 2026 --week 1 --phase kickoff --group YOUR-CODE

# End the week: name the winners; everyone else (and any missed pick) takes the loss.
npm run sim -- --season 2026 --week 1 --phase final --winners kc,dal,buf --group YOUR-CODE
```

After `--phase final`, `sim` runs the real elimination engine
(`src/lib/game/score.ts`) — the same one the production scorer uses — so
strikes, eliminations, and the survivor/deaths tally all update. Refresh the app
and confirm results, washes, and any eliminations look right.

## 6. Run another week (optional)

Seed `--week 2`, have everyone pick again (note: teams used in week 1 are locked
out), and advance it. Repeat until you're confident the loop holds.

## Resetting

The games live in the `games` table with ids like `test-2026-1-3`; delete those
rows in the SQL editor to clear a test slate. To wipe picks/members for a fresh
run, delete from `picks` / `group_members` for your group (service role or SQL
editor). Re-running `seed:test-week` just upserts the same ids.
