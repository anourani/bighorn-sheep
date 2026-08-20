# Last Man Standing

A private **NFL survival league** ("Last Man Standing") as an installable PWA. Pick one team a week; lose once (or twice, your league's call) and you're out. The last survivor takes the season. No spreadsheets, no group-text disputes, no app store — just a link you install to your home screen.

> **No stakes, ever.** The app never references, displays, or stores money. It's only about picks, eliminations, and standings.

---

## Status

This is the **v1 foundation**: a fully-built, installable app with all four screens, the complete design system, the pure game engine (unit-tested), the NFL data provider abstraction, and the database schema + RLS. The four screens now read **live data from Supabase**, RLS-scoped to the signed-in player — their membership, roster, and picks — with the pick/create-group/join-by-code write paths wired behind the same `canPick` guard and RLS. A realistic **seed dataset** (`src/lib/mock/data.ts`) still backs the tests and the `mock` NFL provider, but the UI no longer depends on it.

| Area | State |
| --- | --- |
| Four screens, design system, PWA shell | ✅ Built & building |
| Game/elimination engine (`src/lib/game`) | ✅ Built & unit-tested |
| NFL provider abstraction + ESPN adapter | ✅ Built (real ESPN calls) |
| Postgres schema + RLS pick-privacy | ✅ Written (`supabase/migrations`) |
| Scheduled scorer (Netlify function) | ✅ Written, env-gated |
| Supabase Auth + live queries in the UI | ✅ Wired — screens read the signed-in player's data |
| Turning the season on | ✅ Step-by-step operator guide ([docs/go-live.md](docs/go-live.md)) |
| Elimination testing harness | ✅ Force a specific result on demand ([docs/dry-run.md](docs/dry-run.md)) |

---

## Screens (the whole app is four)

A hard design constraint: **minimal screens, no deep navigation.** Everything is one of these four.

1. **Login / Join** (`/login`) — passwordless magic-link auth (login/signup toggle), invite-code auto-fill from the URL (`/login?invite=CODE`), and a prominent check-your-spam reminder after sending. The landing header's **Log In** opens the same flow (`src/components/auth/LoginFlow.tsx`) as a modal over `/` rather than navigating; `/login` remains the destination for invite links and the auth callback's `?error=` bounces.
2. **My Picks** (`/`, the home screen) — a horizontally scrolling **week strip** across the top (preseason chips first, then weeks 01–18), the pick itself, and below it the team picker in one of **two layouts**, chosen with the **Layout** filter and remembered per browser. **Grid** (the default) is all 32 teams as square cards, one tap to pick, sortable by team record or alphabetically; teams on a bye or already spent stay on screen, greyed and labelled. **Matchups** is the original view — the week's fixtures as a radio group. Either way it's one pick per week, and teams already used or whose game has kicked off are shown but disabled. The pick renders as three gradient strips in the team's colour with its logo over them, the team name at display size, the matchup and kickoff, and a per-game lock countdown alongside — an empty "No Pick Made" variant holds the same space when you haven't picked. Selecting any other week in the strip previews it read-only, keeping used teams flagged so you can plan which to save.
3. **Standings** (`/standings`) — a season grid: one row per player, one column per week, each cell the team they picked. Alive/eliminated status and strikes ride the sticky name column; losses and pushes are washed so a player's strikes read straight down their row. Current-week picks stay behind the **per-game privacy lock** (a padlock until each team's game kicks off). Admin controls (settings, invite, members) live in a modal behind a gear — not a separate page.
4. **Account** (`/account`) — profile, your leagues, create-a-group / join-by-code, timezone, install hint, logout.

## Key rules, implemented in the engine

`src/lib/game/elimination.ts` is pure and tested. It encodes:

- **A team can be used only once per season** — enforced as a hard `canPick` guard _and_ a DB unique constraint, not just a greyed-out button.
- **Per-game locks:** a team becomes unpickable the instant _its own_ game kicks off (Thursday teams lock Thursday), driven by each game's kickoff, not one weekly deadline.
- **Missed pick = loss**, identical to a losing pick, once the week's final kickoff passes.
- **Elimination types:** single (1 loss) or two-time (2 losses, with strike tracking).
- **Tie rule:** push (survive) or loss — modeled as one clean two-option choice (see the note in the PRD; "tie = strike" collapses into "tie = loss" in a two-time league).
- **Immediate updates:** status flips the moment a picked team's game goes final, not at week's end.
- **Season end:** last survivor, or Week 18 — whichever first; wipeout/multi-survivor outcomes are flagged for admin resolution rather than silently resolved.

## Pick privacy — enforced in the database

The rule "you can't see another player's current pick until that team's game kicks off" is enforced by **Row-Level Security in Postgres** (`supabase/migrations/0001_init.sql`), not trusted to the frontend. The `picks` SELECT policy reveals another member's pick only once its game's `kickoff <= now()`. Past weeks reveal automatically (their games kicked off long ago). The UI mirrors this in `viewCurrentPick` (`src/lib/league/view.ts`), but the database is the source of truth.

---

## Tech stack

- **Next.js 15 (App Router) + React 19 + TypeScript** — one codebase for UI and server logic.
- **Tailwind CSS 3.4** — design tokens transcribed into `tailwind.config.ts`.
- **Supabase** — Postgres + passwordless auth + RLS.
- **Netlify** — hosting + scheduled function for the scorer.
- **PWA** — web manifest + a dependency-free offline-shell service worker, served from `src/app/sw.js/route.ts` so it carries a per-build version and never serves a superseded release.

## Design direction — "Ecosystem Visualization"

The visual language is a strict adaptation of the provided design tokens: a warm **orange accent** (`#E48B59` / `#ED7B46`) lighting **slate data-panels** (`#53617A`) that float on a **white page**, **Inter** throughout — regular for display/body, semibold for labels and metric readouts — card radius 16 / control 8 / pill. The result is an operational-dashboard aesthetic — metric tiles, nested surfaces, restrained motion — which maps naturally onto live scores and standings. Tokens live in `tailwind.config.ts`; primitives in `src/components/ui`.

---

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in when you connect Supabase (optional for the demo)
npm run dev                  # http://localhost:3000
```

The landing and login pages render **without any environment variables**, but the `/app` screens now read live data, so they need a Supabase project configured (see below). The game engine and provider tests run env-free.

```bash
npm run build      # production build (statically prerenders all routes)
npm test           # run the engine unit tests (vitest)
npm run typecheck  # tsc --noEmit
```

### Connecting Supabase

1. Create a Supabase project. Put the URL + anon key (and the service-role key, for the scorer/harness) in `.env.local` (see `.env.example`).
2. Apply the schema: run `supabase/migrations/0001_init.sql`, `0002_join_by_invite.sql`, `0003_group_create_and_pick_flags.sql`, `0004_profile_names_avatars.sql`, and `0005_invite_code_without_pgcrypto.sql` (`supabase db push`, or paste into the SQL editor). Run each once — `0004` backfills from `display_name` before dropping it.
3. Add `http://localhost:3000/**` to **Authentication → URL Configuration** so magic links return to the app, then `npm run dev`. Magic-link auth is built into Supabase; the profile row is auto-created by the `handle_new_user` trigger.

#### Deploying

Migrations are **not** applied by the build — nothing in `netlify.toml` or CI touches Supabase — so run any new migration against the production project yourself as part of shipping. Forgetting this is quiet and confusing: the app deploys green and then fails at runtime with a 404 on whichever RPC is missing.

This read-only query reports what production actually has. Run it before and after any migration:

```sql
select 'column: ' || c as object,
       case when exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='profiles' and column_name=c)
       then 'PRESENT' else 'MISSING' end as status
from unnest(array['first_name','last_name','avatar_url','display_name']) c
union all
select 'function: ' || f,
       case when exists (select 1 from information_schema.routines
         where routine_schema='public' and routine_name=f)
       then 'PRESENT' else 'MISSING' end
from unnest(array['account_exists','create_group','join_by_invite',
                  'invite_preview','hidden_pick_user_ids','handle_new_user',
                  'public_league_snapshot','set_member_buy_in','set_group_buy_in',
                  'close_own_account','set_group_name','set_group_rules',
                  'set_member_preseason','record_feed_sync','feed_status_for_admin']) f
union all
select 'table: ' || t,
       case when exists (select 1 from information_schema.tables
         where table_schema='public' and table_name=t)
       then 'PRESENT' else 'MISSING' end
from unnest(array['public_league','profile_private','account_closures','feed_status']) t
union all
select 'column: groups.' || c,
       case when exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='groups' and column_name=c)
       then 'PRESENT' else 'MISSING' end
from unnest(array['buy_in_cents','site_fee_cents']) c
union all
select 'column: group_members.show_preseason',
       case when exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='group_members'
           and column_name='show_preseason')
       then 'PRESENT' else 'MISSING' end
union all
select 'bucket: avatars',
       case when exists (select 1 from storage.buckets where id='avatars')
       then 'PRESENT' else 'MISSING' end
order by 1;
```

Fully migrated means everything PRESENT **except** `display_name`, which 0004 drops.

`set_member_buy_in` being PRESENT does not tell you whether 0010's *redefinition*
of it ran — the name is 0007's. The two `groups` columns beside it do, since they
land in the same file. If they are MISSING, the account page shows a $0 buy-in and
"UNPAID" with no date, and Delete Account fails with `close_failed`.

`create_group` has the same problem and no such tell, because 0012 redefines it
and adds no column to check. It is also the one migration whose absence you will
not notice until you create a league — at which point it silently sets the entry
deadline a week out instead of to the first Week 1 kickoff, which shuts joining,
the preseason practice round and the rules editor. Ask the function itself
whether 0012 ran:

```sql
select pg_get_functiondef(oid) like '%entry_deadline_unknown%' as has_0012
from pg_proc
where proname = 'create_group'
  and pronamespace = 'public'::regnamespace;
```

`true` means 0012 is applied. `false` means the old `now() + interval '7 days'`
default is still live.

`public_league` being PRESENT only means 0009 ran. It does **not** mean the
landing page is showing anything — publishing is a separate, deliberate step:

```sql
select count(*) from public.public_league;   -- 0 = nothing published yet
```

With zero rows the landing page renders its header, title and description and
omits the status report and standings entirely. To publish, and to retract:

```sql
insert into public.public_league (group_id)
select id from public.groups where invite_code = 'YOURCODE';

delete from public.public_league;   -- retract; no redeploy needed
```

In **Authentication → URL Configuration** on the production project:

- **Site URL** must be the bare origin (`https://sheepwithglasses.com`), with **no path**. Supabase falls back to the Site URL whenever `emailRedirectTo` isn't on the allowlist, carrying the `?code=` along — so a Site URL with a path silently strands magic links on a page that can't exchange them. (`src/middleware.ts` now forwards any stray `?code=` to `/auth/callback` as a safety net, but the setting should still be right.)
- **Note what the preview entry also matches.** `https://**--bighorn-sheep.netlify.app/**` covers deploy previews, and equally covers `https://<deploy-id>--bighorn-sheep.netlify.app` — the permanent per-deploy address on Netlify's deploy page. Since `emailRedirectTo` comes from `window.location.origin`, anyone who opens `/login` on a permalink gets a magic link back to that permalink, Supabase accepts it, and they sign in against a frozen old build with no error anywhere. `src/middleware.ts` redirects `/login` off a permalink for that reason; previews and branch deploys are exempt, being their own origins by design.
- **When a link fails, read its `redirect_to` first.** If it still carries the `/auth/callback` path, Supabase honoured what the app asked for and the odd host came from the browser. If it is a bare origin with the path dropped, that is the Site-URL fallback and the allowlist is what to fix.
- **Redirect URLs** must include `https://sheepwithglasses.com/**` alongside `http://localhost:3000/**`.
- **Deploy previews need their own entry, and it stays on `netlify.app`.** The custom domain is production only — previews, branch deploys and deploy permalinks are all still `*.netlify.app`, because that is Netlify's own domain. `https://sheepwithglasses.com/**` does *not* cover `https://deploy-preview-12--bighorn-sheep.netlify.app` — the allowlist is globbed with `.` and `/` as separators, so that wildcard spans paths, not subdomains. Add `https://**--bighorn-sheep.netlify.app/**` to cover every deploy preview and branch deploy in one entry. It is not leftover cruft to tidy away once the custom domain is live — removing it breaks sign-in on every future preview. Without it, signing in from a preview quietly completes the sign-in **on production**: the preview asks for the right return address (`emailRedirectTo` comes from `window.location.origin`), Supabase discards it, falls back to the Site URL, and the middleware safety net finishes the exchange there. Nothing errors, so it reads as a redirect bug rather than a missing setting. Supabase-side, so it takes effect without a redeploy.

The From address on magic-link emails comes entirely from **Authentication → Emails → SMTP Settings** on the Supabase project. `signInWithOtp()` has no sender parameter, so if the sender looks wrong, that field is the only place to fix it. It is `noreply@sheepwithglasses.com`, relayed through Resend.

Two separate things must both be true for a send to succeed, and **both fail as an opaque HTTP 500 on `/auth/v1/otp`** that the app renders as "Our sign-in service is having trouble": the sender's domain must be verified with the provider, **and** the API key must be authorised for that domain (Resend scopes keys per domain). Read **Resend → Logs** to tell them apart — it is the only place the actual reason appears.

The screens read live data server-side through `src/lib/league/load.ts` (RLS-scoped to the signed-in user) and pass it into the client UI; writes go through the server actions in `src/app/app/actions.ts`. Without env vars the middleware leaves the app un-gated — but the `/app` screens need a session, so set Supabase up to use them.

### Rehearsing the loop

For an ordinary rehearsal, use the **preseason practice round** — the Preseason entries in the week dropdown run pick → lock → reveal → result → elimination against real NFL games, and everything resets at Week 1. No scripts needed.

The harness in **[docs/dry-run.md](docs/dry-run.md)** is for what real football can't do on cue: **forcing a specific result, right now.** It's how you drive an elimination or a whole-group wipeout deliberately, and it's the only caller of `recomputeSeason` outside production — so it's currently the only way to prove the elimination write path works.

```bash
npm run seed:test-week -- --week 18 --kickoff-in 15 --group YOUR-CODE   # a pickable slate
npm run sim -- --week 18 --phase kickoff --group YOUR-CODE              # lock + reveal picks
npm run sim -- --week 18 --phase final --winners kc,dal --group YOUR-CODE  # results + eliminations
```

Seed a week the league hasn't published — the seeder refuses to fabricate games on top of a real slate, and `sim` only advances rows it seeded. Always pass `--group`, which scopes the recompute to one league.

### The NFL data provider is swappable

Everything goes through one interface — `getWeekGames()` in `src/lib/providers`. ESPN's free scoreboard is the v1 adapter (`espn.ts`); a paid feed (API-Sports, BallDontLie) is just another class implementing `NflProvider`. Flip `NFL_PROVIDER=mock` to serve bundled fixtures. Because ESPN is undocumented and can break, the **admin manual-result override** is the built-in mitigation.

### The scheduled scorer

`netlify/functions/poll-scores.ts` runs on a cron: it polls the provider, upserts games (which locks picks at kickoff), and recomputes eliminations using the same engine the app and tests use. It no-ops until `SUPABASE_SERVICE_ROLE_KEY` is set.

---

## Project structure

```
src/
  app/
    (app)/            # authenticated shell: header + bottom tab bar
      page.tsx        # My Picks (home)
      group/          # Group / standings
      account/        # Account
    login/            # Login / Join (standalone)
    offline/          # PWA offline fallback
  components/
    ui/               # design-system primitives (Panel, Metric, Badge, Button, Modal…)
    picks/ group/ account/ shell/   # screen-specific pieces
  lib/
    nfl/              # teams (all 32) + domain types
    providers/        # NflProvider interface + ESPN & mock adapters
    game/             # elimination engine (+ tests)
    league/           # league types + view-model helpers
    supabase/         # client/server factories + DB types
    mock/             # seed data for standalone rendering
supabase/migrations/  # schema + RLS
netlify/functions/    # scheduled scorer
public/               # manifest, icons, service worker
```

## Roadmap

- **Now:** admin settings writes (edit rules/name while unlocked), multi-group switcher (the loader already accepts a target group id).
- **P1:** admin override tools with audit log, deadline countdown, pick-reminder emails (Resend).
- **P2:** group chat, multi-sport, public discovery.

---

_Built to be functional before Week 1 kickoff. One codebase, one database, one host._
