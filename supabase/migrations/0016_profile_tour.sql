-- ─────────────────────────────────────────────────────────────────────────────
-- 0016_profile_tour: remember whether a player has seen the first-run tour.
--
-- MUST BE APPLIED BY HAND. Nothing in netlify.toml or CI touches Supabase, so
-- merging this deploys the code and leaves the database behind. The symptom
-- here is unusually quiet by design: `viewerTourCompleted()` fails OPEN, so an
-- unapplied migration leaves the tour inert rather than firing an undismissable
-- carousel at every player on every load. Quiet, but it does mean "the tour
-- never appears" is the first thing to check this against.
--
-- A nullable timestamp rather than a boolean: "when" is free to store and
-- answers questions a flag cannot ("did anyone actually finish this?").
--
-- No RLS change and no grant. 0001's "profiles update own" policy already lets
-- a user UPDATE their own row, and RLS cannot restrict WHICH COLUMNS an update
-- writes. That property is what makes a `profiles.deleted_at` column unsafe for
-- account closure (see 0010) — and what makes this column safe, because the
-- worst a user can do to their own flag is clear it and watch the tour again.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- The column, and the grandfathering backfill FENCED INSIDE ITS CREATION.
--
-- The fence is 0011's `show_preseason` pattern, and it is load-bearing for the
-- same reason. Everyone already in the league has been using the app for weeks
-- and should not be handed a "here's how this works" carousel on their next
-- load, so they are marked done; everyone who joins from here on has a null and
-- sees it once.
--
-- A bare `update ... where tour_completed_at is null` out in the file would be
-- correct exactly once. On any replay it would sweep up every player who has
-- joined since — people whose null means "hasn't seen it yet", not "predates the
-- feature" — and silently retire the tour for them. That is 0004's one-shot
-- hazard reached by a different route, and the guard is what makes this file
-- replayable rather than merely idempotent-looking.
--
-- DELETE THE `update` (not the block) to show the tour to the current league
-- too. It is the one line that decides.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'profiles'
       and column_name  = 'tour_completed_at'
  ) then
    alter table public.profiles add column tour_completed_at timestamptz;

    update public.profiles set tour_completed_at = now();
  end if;
end $$;
