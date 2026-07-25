# Last Man Standing

A private **NFL survival league** ("Last Man Standing") as an installable PWA. Pick one team a week; lose once (or twice, your league's call) and you're out. The last survivor takes the season. No spreadsheets, no group-text disputes, no app store — just a link you install to your home screen.

> **No stakes, ever.** The app never references, displays, or stores money. It's only about picks, eliminations, and standings.

---

## Status

This is the **v1 foundation**: a fully-built, installable, statically-rendered app with all four screens, the complete design system, the pure game engine (unit-tested), the NFL data provider abstraction, and the database schema + RLS. The screens currently render from a realistic **seed dataset** (`src/lib/mock/data.ts`) frozen at a mid-season Sunday so every state is visible at once — live games, a fresh elimination, hidden picks, strikes. Wiring the screens to Supabase queries and Supabase Auth is the next step; the seams for it are all in place.

| Area | State |
| --- | --- |
| Four screens, design system, PWA shell | ✅ Built & building |
| Game/elimination engine (`src/lib/game`) | ✅ Built & unit-tested (25 tests) |
| NFL provider abstraction + ESPN adapter | ✅ Built (real ESPN calls) |
| Postgres schema + RLS pick-privacy | ✅ Written (`supabase/migrations`) |
| Scheduled scorer (Netlify function) | ✅ Written, env-gated |
| Supabase Auth + live queries in the UI | ⏳ Next: screens read seed data today |

---

## Screens (the whole app is four)

A hard design constraint: **minimal screens, no deep navigation.** Everything is one of these four.

1. **Login / Join** (`/login`) — passwordless magic-link auth (login/signup toggle), invite-code auto-fill from the URL (`/login?invite=CODE`), and a prominent check-your-spam reminder after sending.
2. **My Picks** (`/`, the home screen) — your status (alive/eliminated + why), your current pick with a per-game lock countdown, the full 32-team grid split into **available / used (week-tagged) / on-bye**, and an expandable schedule look-ahead.
3. **Group** (`/group`) — the standings table with alive/eliminated status and strikes, current-week picks behind the **per-game privacy lock**, expandable pick history, and admin controls (settings, invite, members) in a modal behind a gear — not a separate page.
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

The app runs and renders fully **without any environment variables** (it uses the seed dataset).

```bash
npm run build      # production build (statically prerenders all routes)
npm test           # run the engine unit tests (vitest)
npm run typecheck  # tsc --noEmit
```

### Connecting Supabase (when ready)

1. Create a Supabase project. Put the URL + anon key in `.env.local` (see `.env.example`).
2. Apply the schema: `supabase db push` (or paste `supabase/migrations/0001_init.sql` into the SQL editor).
3. Swap the screens' `src/lib/mock/data` imports for Supabase queries via `src/lib/supabase/{client,server}.ts`. Magic-link auth is built into Supabase; the profile row is auto-created by the `handle_new_user` trigger.

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

- **Now:** wire screens to Supabase queries + magic-link auth; server actions for the pick write path (behind `canPick` + RLS).
- **P1:** multi-group switcher, admin override tools with audit log, deadline countdown, pick-reminder emails (Resend).
- **P2:** group chat, multi-sport, public discovery.

---

_Built to be functional before Week 1 kickoff. One codebase, one database, one host._
