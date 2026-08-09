# Turning on the 2026 season

Three things have to happen before anyone can pick a team: the database needs one
update, the site needs two secrets, and the schedule needs loading. None of it
requires writing code — it's copying, pasting, and clicking. **Do them in this order.**

About 15 minutes. You'll need your Supabase and Netlify logins. All three steps are
reversible.

> A friendlier version of this page, formatted for following on a phone, is published
> as an artifact — ask for the link if you don't have it.

## Why the order matters

The app code is already deployed and expects a database column that doesn't exist yet.
So the database goes **first**. Load the schedule before updating it and the app will
look broken — empty standings, picks that won't save — even though nothing is
actually wrong.

This app's database is updated **by hand, on purpose**. Merging code does not change
the database. That's why Step 1 exists and why it can't be skipped.

---

## Step 1 · Update the database

Two pieces of SQL in Supabase. The first only looks; the second makes the change.

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) and select your project.
2. Left sidebar → **SQL Editor** → **+ New query**.
3. Paste this and click **Run**. It only reads — it changes nothing.

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.picks'::regclass and contype = 'u';
```

**You should see** two rows, with these names in the `conname` column:

- `picks_group_id_user_id_week_key`
- `picks_group_id_user_id_team_id_key`

If those are the two, carry on. **If the names differ, or there are more than two,
stop** — the migration drops these by name and would need adjusting first.

4. Get the contents of `supabase/migrations/0006_preseason_picks.sql`.

   **Not** from the PR's *Files changed* tab — that shows a diff, with a `+` at the
   start of every line, which Postgres will reject. Open the **file itself** instead:

   ```
   github.com/<owner>/<repo>/blob/<branch>/supabase/migrations/0006_preseason_picks.sql
   ```

   On that page, the grey toolbar directly above the code has three small icons on
   its right-hand side. The middle one — two overlapping squares, tooltip
   **"Copy raw file"** — copies all 129 lines cleanly. (The `Raw` link also works:
   it opens the plain text, then select all and copy.)

5. Back in Supabase: **+ New query**, paste the **whole file** (129 lines, most of
   them explanatory comments — the actual changes are about 20), **Run**.

**You should see** `Success. No rows returned.` That *is* success for this kind of
change — there's nothing to display. Running it twice is harmless; it's written to be
safe to repeat.

**If you get an error instead:**

| Message | Meaning |
| --- | --- |
| `relation "public.picks" does not exist` | Wrong Supabase project — check the name, top left. |
| Anything mentioning `display_name` | That's migration `0004`, a different one. Don't run it. Send the message. |
| Anything else | Copy the full error text and send it. |

---

## Step 2 · Add two secrets, then redeploy

The site needs one secret to write to the database and one to stop strangers
triggering the schedule loader. Neither is set today, which is why nothing automatic
runs — no scores, no eliminations.

### 2a · Copy the database key

Supabase → **Project Settings** (gear, bottom of the left sidebar) → **API** →
**Project API keys** → the `service_role` row → **Reveal** → copy.

> **Treat this like a bank password.** The `service_role` key ignores every security
> rule in the app — anyone holding it can read, change, or delete everything, for every
> account. Never paste it into a chat, an email, a screenshot, or a public page. It goes
> in exactly one place: the Netlify box in 2c. If you think it's leaked, return to this
> screen and rotate it; that invalidates the old one immediately.

### 2b · Invent the second secret

`CRON_SECRET` is a long random string you make up. It's the password in the link you'll
open in Step 3. An easy way to generate one — run this in the same SQL Editor and copy
the result:

```sql
select gen_random_uuid();
```

Save it in your password manager; you'll need it every time you reload the schedule.

### 2c · Put both into Netlify

[app.netlify.com](https://app.netlify.com) → your site → **Site configuration** →
**Environment variables** → **Add a variable** → **Add a single variable**.

The form has more options than you need. Set them like this:

| Field | Choose | Why |
| --- | --- | --- |
| **Key** | exactly as in the table below | One character off and the site won't find it — and the error you'll see in Step 3 says the value is *unset*, which is hard to debug backwards from. |
| **Contains secret values** | ✅ checked | Masks the value in Netlify's UI, logs, and CLI. You won't be able to read it back afterwards; re-copy from Supabase if you need it again. |
| **Scopes** | leave as-is — just check that **Functions** is ticked | On the free plan this is locked to *Specific scopes* with Builds, Functions and Runtime ticked and Post processing excluded. That's fine. **Functions** is the only scope that matters: `load-schedule`, `poll-scores`, and all of the app's server-side code run as Netlify Functions. Post processing is HTML snippet injection, which this app doesn't use — so *All scopes* being upgrade-gated costs you nothing. |
| **Values** | **Same value for all deploy contexts** | The default is *"Different value for each deploy context"*, which shows five separate boxes. You don't want that — it's the same database in every context. Switching gives you one box. |

Then **Create variable**, and repeat for the second.

| Key | Value |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key from 2a |
| `CRON_SECRET` | the random string from 2b |

There's a third one worth adding while you're on this screen, and it takes the
settings above **differently**:

| Key | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | your production origin, e.g. `https://bighorn-sheep.netlify.app` — no trailing slash, no path |

- **Contains secret values:** leave it *unchecked*. Anything named `NEXT_PUBLIC_*`
  is compiled into the browser bundle by definition, so marking it secret only
  hides it from you.
- **Values:** here you *do* want **Different value for each deploy context** —
  give each context its own origin. It builds the invite links, and being a
  `NEXT_PUBLIC_*` value it is frozen into the bundle at build time, so a single
  shared value means a deploy preview hands out production invite links.

Nothing in the repo sets this variable, and the code falls back to
`https://bighorn.example` — a domain that doesn't exist. If invite links are
currently showing that host, this is why. Note that adding it does nothing until
the site rebuilds (2d).

### 2c-bis · Point Supabase at the site

Still in Supabase: **Authentication → URL Configuration**.

- **Site URL** — your production origin, bare, with **no path**. Supabase falls
  back to this whenever a sign-in asks to return somewhere that isn't allowlisted,
  so a path here strands magic links on a page that can't complete them.
- **Redirect URLs** — add all three:

  ```
  http://localhost:3000/**
  https://bighorn-sheep.netlify.app/**
  https://**--bighorn-sheep.netlify.app/**
  ```

  The third covers deploy previews and branch deploys. It is a separate entry
  because the allowlist globs `.` and `/` as separators — the second line's
  wildcard spans paths, not subdomains, so it will not match
  `deploy-preview-12--bighorn-sheep.netlify.app`. Skip it and signing in from a
  preview silently signs you into production instead.

These are Supabase settings, so they apply immediately — no redeploy needed.

> If the deploy in 2d fails with a **secrets scanning** error, tell me. Netlify checks
> whether a secret value leaked into the published output. Neither of these is ever
> sent to the browser, so it shouldn't trigger — but the check exists.

### 2d · Redeploy — easy to forget

**Deploys** → **Trigger deploy** dropdown → **Clear cache and deploy site**. Wait for
the status to read **Published** (one to three minutes).

The site only picks up new settings when it's rebuilt. Adding the variables without
redeploying changes nothing — the running site keeps using the old empty values, and
Step 3 will report the secret as unset.

---

## Step 3 · Load the schedule

One link, opened in a browser. It fetches all ~320 games from ESPN and saves them. You
do this once; after that the site refreshes itself every five minutes.

1. Find your site's address on the Netlify site overview — either
   `something.netlify.app` or your own domain.
2. Build the link below, swapping in your address and the `CRON_SECRET` from 2b.
   **Do the preview first** — `&dry=1` means "show me what you'd load, save nothing."

```
https://YOUR-SITE/.netlify/functions/load-schedule?key=YOUR-CRON-SECRET&dry=1
```

You'll get a plain page of text listing how many games it found, week by week. When it
looks right, open the same link **without** `&dry=1` to save them.

Roughly what a good result looks like:

```
NFL 2026 schedule load
==========================================================

Preseason
  week  1     1 game
  week  2    16 games
  week  3    16 games
  week  4    16 games
            49 total

Regular season
  week  1    16 games
  …
           272 total

First kickoff: 2026-08-07T00:00:00.000Z
Last kickoff:  2027-01-04T01:15:00.000Z

Loaded 321 games in 6480ms.

Entry deadlines aligned to the first Week 1 kickoff:
  "Group Name"  2026-08-15T17:33:00.000Z  →  2026-09-10T00:20:00.000Z
1 league updated.
New members can now join right up until the season actually starts.
```

**The numbers to sanity-check:** 272 regular-season games (that's the real total, every
year); preseason around 49 across 4 weeks, with week 1 holding just the single Hall of
Fame game; first kickoff in early August, last in early January.

**About that last block.** `create_group` sets a league's entry deadline to "seven days
from now", because when a league is created there's no schedule to read a real date from.
That's a problem: once the deadline passes, `join_by_invite` refuses every new member
permanently, and there's no way to reopen it from the app. So the loader now repairs it —
it points every league's deadline at the real first Week 1 kickoff.

It only ever does this while Week 1 is still in the future. Once the season has genuinely
started, deadlines are left alone; moving one forward then would reopen entry on a league
in progress. If it reports *"left alone — Week 1 has already kicked off"* or *"no
regular-season Week 1 games loaded yet"*, that's it declining on purpose, not failing.

**If it says `STOPPED EARLY`** — not a failure. It ran out of time and stopped cleanly.
Everything it listed **is saved**; open the same link again and it resumes. Repeating is
always safe. You can also split the job with `&phase=pre` and `&phase=regular`.

---

## Step 4 · Check it worked

Open the app, sign in, go to **My Picks**:

- [ ] The header countdown points at **September**, not next week. If it says something
      like "Starts in 6d", the entry deadline is still the stale seven-day default — see
      the note at the end of Step 3. This is the check worth doing first: a wrong deadline
      locks new members out of the league entirely.
- [ ] The **Change week** dropdown has two labelled groups — *Preseason* (Hall of Fame,
      Preseason 1–3) and *Regular Season* (Week 1–18).
- [ ] Any week shows real matchups with sensible kickoff times in your timezone.
- [ ] A Preseason week accepts a pick without error.
- [ ] Switching to Week 1, **that same team is still available** — preseason practice
      doesn't use up a team.
- [ ] Teams not playing a given week are shown as not pickable, rather than missing.

From here the site looks after itself: every five minutes it refreshes scores and game
status, picks up NFL schedule changes, and updates strikes and eliminations.

---

## If something looks wrong

| What you see | What it means |
| --- | --- |
| Standings empty, or picks won't save | Step 1 didn't complete. Re-run the migration — safe to repeat. |
| `Missing or incorrect secret.` | The `key=` in your link doesn't match `CRON_SECRET`. Watch for a trailing space. |
| `CRON_SECRET is not set…` | Variable missing in Netlify, or added without redeploying (2d). |
| `Cannot load the schedule: SUPABASE_SERVICE_ROLE_KEY…` | Same for the other key. |
| "Schedule not yet released" on every week | Step 3 hasn't succeeded yet; the `games` table is empty. |
| `No games returned` | ESPN returned nothing. Usually temporary. If it persists, their feed may have changed shape. |
| Scores never update after a game ends | The five-minute job isn't running. Check `SUPABASE_SERVICE_ROLE_KEY` is set and the site has redeployed since. |
| Header counts down to next week, not September | The entry deadline is the stale `create_group` default. Re-open the loader link — it repairs this. |
| An invite link says entry is closed, before the season | Same cause. The deadline lapsed, so `join_by_invite` is refusing. Re-open the loader link and the invite works again. |

When reporting a problem, include the exact text you're seeing (copy-paste beats a
description), which step you were on, and what you expected. **Never include the
`service_role` key or `CRON_SECRET` themselves.**

---

## Reversibility

The database change is additive — it adds a column and drops two constraints it
immediately replaces; it deletes no data. The Netlify variables can be edited or
removed. The schedule loader can be re-run freely: it overwrites its own rows by game
id rather than accumulating duplicates.
