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
| Pre-season dry-run harness | ✅ Seed a test weekend + fast-forward it ([docs/dry-run.md](docs/dry-run.md)) |

---

## Screens (the whole app is four)

A hard design constraint: **minimal screens, no deep navigation.** Everything is one of these four.

1. **Login / Join** (`/login`) — passwordless magic-link auth (login/signup toggle), invite-code auto-fill from the URL (`/login?invite=CODE`), and a prominent check-your-spam reminder after sending.
2. **My Picks** (`/`, the home screen) — your status (alive/eliminated + why), your current pick with a per-game lock countdown, and the week's **matchups as a radio group** (one pick per week; teams already used or whose game has kicked off are shown but disabled). A **Change Week** dropdown browses upcoming weeks read-only, keeping used teams flagged so you can plan which to save.
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
- **PWA** — web manifest + a dependency-free offline-shell service worker (`public/sw.js`).

## Design direction — "Ecosystem Visualization"

The visual language is a strict adaptation of the provided design tokens: a warm **orange accent** (`#E48B59` / `#ED7B46`) lighting **slate data-panels** (`#53617A`) that float on a **white page**, **Inter** for display/body and **JetBrains Mono** for labels and metric readouts, card radius 16 / control 8 / pill. The result is an operational-dashboard aesthetic — metric tiles, nested surfaces, restrained motion — which maps naturally onto live scores and standings. Tokens live in `tailwind.config.ts`; primitives in `src/components/ui`.

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
2. Apply the schema: run `supabase/migrations/0001_init.sql`, `0002_join_by_invite.sql`, and `0003_group_create_and_pick_flags.sql` (`supabase db push`, or paste into the SQL editor).
3. Add `http://localhost:3000/**` to **Authentication → URL Configuration** so magic links return to the app, then `npm run dev`. Magic-link auth is built into Supabase; the profile row is auto-created by the `handle_new_user` trigger.

The screens read live data server-side through `src/lib/league/load.ts` (RLS-scoped to the signed-in user) and pass it into the client UI; writes go through the server actions in `src/app/app/actions.ts`. Without env vars the middleware leaves the app un-gated — but the `/app` screens need a session, so set Supabase up to use them.

### Try the whole loop before the season — the dry-run harness

You don't have to wait for a real NFL game to test picks and eliminations end-to-end. Seed a controllable **test weekend** and fast-forward it with a real group of friends. See **[docs/dry-run.md](docs/dry-run.md)**; in short:

```bash
npm run seed:test-week -- --week 1 --kickoff-in 15 --group YOUR-CODE   # a pickable slate
npm run sim -- --week 1 --phase kickoff --group YOUR-CODE              # lock + reveal picks
npm run sim -- --week 1 --phase final --winners kc,dal --group YOUR-CODE  # results + eliminations
```

`sim` recomputes standings through the same engine the production scorer uses (`src/lib/game/score.ts`).

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
