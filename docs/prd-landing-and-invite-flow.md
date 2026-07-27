# PRD — Landing Page, Invite Flow & Pre-Season Experience

**Status:** implemented (v1) · **Product:** Last Man Standing (private NFL survivor pool)

## Problem

The app had no front door. Loading `/` dropped any visitor straight into a
mid-season dashboard rendered as a mock admin — a stranger saw a populated
league, not a way in. The invite flow was a shell (the login page read the code
but the submit was faked and nothing joined you to a league), and there was no
"before the season starts" state at all: the current week was hardcoded, so a
person who signed up early would have seen someone else's Week 6 data.

This PRD covers the surrounding experience that turns a stranger into an enrolled
player: **stranger → invited → enrolled → sitting in a pre-season league.** The
guiding principle is *stupid simple*.

## Goals

- A public landing page (canonical root) that explains the product and captures an invite code.
- A frictionless join: **invite code + display name + email**, passwordless via magic link.
- Real authentication and route gating (players get the app; strangers get the landing page).
- A real join-by-invite backend that validates the code and the entry window.
- A pre-season experience that turns waiting into engagement.

## Non-goals (deferred)

- Multi-league switching (one league per user for now).
- Live regular-season standings wired to results (the scorer already writes them; reading is a later add).
- Create-a-league wiring, admin manual-result overrides, realtime, season-end screens, pick-reminder emails.

---

## Personas & entry points

| Persona | Arrives via | Should get |
|---|---|---|
| **Anonymous stranger** | `/` with no code | What the product is in ~5s; a place to enter a code; a "log in" link |
| **Invited player** | An invite link `…/login?invite=CODE`, or types the code on the landing page | Confirmation of *which* league, then a dead-simple name + email join |
| **Early bird** | Joins before Week 1 kickoff | A "you're in" pre-season home: pick Week 1 early, countdown, who's joined |

---

## Experience 1 — Landing page (`/`)

A short brand hero + a 3-step "how it works" + a prominent invite-code entry box.
It's invite-only, so the stranger's primary path is small and clear.

- **Hero:** brand mark, "NFL Survival League" eyebrow, "Last Man Standing", one-line pitch.
- **Invite box (primary CTA):** an uppercase code input. The code is validated
  against `invite_preview` *before* hand-off, so a bad code fails here — not after
  the player has typed their email. On success it routes to `/login?invite=CODE`.
- **How it works:** (01) Get an invite, pick a team · (02) Win to survive, lose and
  you're out · (03) Last one standing takes the season.
- **Secondary CTA:** "Already have an account? Log in."
- Signed-in visitors are redirected to `/app`.

## Experience 2 — Enrollment flow (`/login`)

**Path:** Landing → enter code → `/login?invite=CODE` (name + email) → "check your
inbox" → email link → `/auth/callback` → joined → `/app` (pre-season).

- The join form shows **"You're joining {League} · N players · entry open"** from
  `invite_preview`, and collects a **display name** + **email**.
- Submitting sends a Supabase magic link. The display name flows into the player's
  profile (via the `handle_new_user` trigger); the invite code rides along in the
  callback URL so it survives the email round-trip (robust for returning users too).
- Tapping the link exchanges the code for a session and joins the league via
  `join_by_invite`, then lands the player in the app.

**States & errors**

| State | Trigger | UX |
|---|---|---|
| Invalid code | `invite_preview` empty | Inline "that code doesn't match a league"; block send |
| Entry closed | past Week 1 kickoff | "Entry closed at the first Week 1 kickoff"; allow login, disable join |
| Already a member | `join_by_invite` idempotent | No error; lands in `/app` |
| Expired / used link | code exchange fails | Back to `/login` with "that link expired — request a new one" |

## Experience 3 — Pre-season ("before Week 1")

When a player joins before the first Week 1 kickoff, the season is in **pre-season**
(derived from the clock vs. the league's entry deadline). The experience centers on
making the Week 1 pick early — not an empty waiting room.

- **Header:** "Season starts in {countdown} · {N} joined" (in place of the survivor tally).
- **My Picks:** a pre-season banner ("the season kicks off {kickoff}; make your Week 1
  pick now — it locks when your team plays, change it until then"), a "No pick yet"
  hero, and the full, pickable Week 1 slate. A fresh entrant has no history, so no
  teams are greyed out.
- **Standings:** no results yet, so a countdown-to-kickoff panel, a **"Who's in"
  roster** (everyone alive at the gun), the league's rules, and an invite CTA to grow
  the pool — instead of the results grid.
- Once the first kickoff passes, everything reverts to the regular-season UI.

---

## Identity & auth model

- **Passwordless magic link** (Supabase Auth). No passwords; the account is created on
  first sign-in. Display name is captured at signup and stored on the profile.
- **Join = your own membership row.** An invite *is* a league's shared `invite_code`.
  Because Row-Level Security only lets you read a league you already belong to, two
  `SECURITY DEFINER` RPCs bridge the gap: `invite_preview` (anon — validate a code and
  show the league name) and `join_by_invite` (authenticated, idempotent — insert
  membership within the entry window).
- **Gating:** middleware refreshes the session and gates `/app/*`; signed-out visitors
  are sent to the landing page, signed-in visitors are sent into the app.

## Routing

| Route | Purpose |
|---|---|
| `/` | Public landing page |
| `/login` | Magic-link join / log in (reads `?invite=CODE`) |
| `/auth/callback` | Session exchange + join-by-invite |
| `/app`, `/app/standings`, `/app/account` | The gated product shell |

## Open questions / future work

- **Multi-league:** the schema supports many leagues per user; the UI currently assumes
  one. A league switcher is the natural next step.
- **Live standings & the real data layer:** the app screens still read seed data. Binding
  them to live Supabase queries (so each player sees their own membership, roster, and
  picks) is the remaining "real data" work, best verified against a live database.
- **Pick-reminder emails**, **season-end screens**, and **admin tooling** are scoped out of v1.
