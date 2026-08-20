-- Last Man Standing — stop create_group inventing an entry deadline.
--
-- `groups.entry_closes_at` is documented as "first kickoff of Week 1"
-- (0001_init.sql:54) and every consumer treats it as exactly that: seasonPhase()
-- derives the whole app's notion of "has the season started" from it,
-- join_by_invite (0002:74) refuses every new member once it passes, and
-- set_group_rules (0011) freezes the rules on the same test.
--
-- But create_group has always defaulted it to `now() + interval '7 days'`, which
-- is not that fact and has no relationship to it. A league created in August
-- therefore closed its own entry a week later, in the middle of the NFL
-- preseason, and nothing in the app could reopen it.
--
-- This is not hypothetical. The inaugural league was created 2026-08-08 without
-- p_entry_closes_at, closed itself on 2026-08-15, and the failure surfaced four
-- days later as an admin asking why the preseason switches were greyed out under
-- the words "Preseason is over" — six weeks before Week 1. The visible symptom
-- was the least of it: joining, the practice round and the rules editor had all
-- shut at the same moment, for the same reason.
--
-- The correct value is knowable from the database whenever the schedule has been
-- loaded, so read it instead of guessing:
--
--   coalesce(p_entry_closes_at, min(kickoff) of season_type='regular', week=1)
--
-- and RAISE when neither is available, rather than falling back to a date that
-- is wrong. That asymmetry is the whole point. A wrong deadline is silent, and
-- from inside the app it is permanent; an error is loud and lands in front of
-- the person in the SQL editor, who can pass the date and move on. Same argument
-- src/lib/cron-auth.ts makes for failing closed.
--
-- Apply with:  supabase db push   (or paste into the SQL editor). Replayable —
-- `create or replace` plus its grants, nothing conditional on current state.
--
-- NOT a backfill. Existing leagues are deliberately untouched: a bare UPDATE out
-- in this file would re-run on every replay and stomp a deadline someone had set
-- on purpose — 0011's fenced show_preseason backfill is the same lesson. Leagues
-- created before this migration are repaired by alignEntryDeadlines
-- (src/lib/nfl/schedule.ts), which the schedule loader runs on every pass.
--
-- alignEntryDeadlines is NOT made redundant by this. It repairs leagues that
-- already exist and re-aligns every league if the NFL moves the opener. This
-- migration only fixes leagues at the moment they are born. Both are wanted.
--
-- No pgcrypto. This function is `security definer set search_path = public`, and
-- an unqualified extension call inside such a body raises 42883 at runtime on
-- Supabase (see CLAUDE.md). Every call here is a pg_catalog builtin:
-- coalesce, extract, now, trim, length, upper, substr, replace, min,
-- gen_random_uuid (core since PG13, not pgcrypto's).

-- ─────────────────────────────────────────────────────────────────────────────
-- create_group — create a league + the creator's admin membership, atomically.
--
-- The SIGNATURE IS UNCHANGED from 0005: same five parameters, same types,
-- p_entry_closes_at still last and still defaulted. That is deliberate rather
-- than lazy. Making the parameter genuinely required is what you actually want
-- here, and Postgres will not have it — a parameter without a default may not
-- follow one that has a default, and p_season sits in front of it. Requiring it
-- would mean reordering, which means `drop function` first, which breaks the
-- positional call documented in docs/dry-run.md. Holding the signature also
-- means src/lib/supabase/types.ts needs no edit.
--
-- Only two things differ from 0005: where v_entry comes from, and the guard that
-- refuses when it cannot be determined.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_group(
  p_name             text,
  p_elimination_type text        default 'single',
  p_tie_rule         text        default 'push',
  p_season           int         default null,
  p_entry_closes_at  timestamptz default null
)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid        := auth.uid();
  g        public.groups;
  code     text;
  v_season int         := coalesce(p_season, extract(year from now())::int);
  -- The first kickoff of Week 1, which is what this column MEANS — not a week
  -- from now, which is what it used to hold.
  --
  -- `season_type = 'regular' and week = 1` is load-bearing, not decoration. A
  -- full season load's earliest game is the Hall of Fame game in early August,
  -- so the earliest kickoff of the whole schedule would set a deadline already
  -- in the past and close entry the instant the league was created. This is the
  -- same trap alignEntryDeadlines documents and the one sim-advance.ts actually
  -- fell into; the two must agree, so they read the same three columns.
  --
  -- Null when the schedule has not been loaded for this season. The body refuses
  -- in that case; it does not substitute a date.
  --
  -- v_season is declared above, and PL/pgSQL evaluates DECLARE initialisers in
  -- order, so a later one may read an earlier one. Nothing in this function
  -- needed that before; it does now, so don't reorder the block.
  v_entry  timestamptz := coalesce(
                            p_entry_closes_at,
                            (select min(kickoff)
                               from public.games
                              where season      = v_season
                                and season_type = 'regular'
                                and week        = 1));
  attempts int         := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if length(coalesce(trim(p_name), '')) = 0 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if p_elimination_type not in ('single', 'two_time') then
    raise exception 'bad_elimination_type' using errcode = 'P0001';
  end if;
  if p_tie_rule not in ('push', 'loss') then
    raise exception 'bad_tie_rule' using errcode = 'P0001';
  end if;

  -- Refuse rather than invent. Deliberately AFTER the checks above, so
  -- not_authenticated and the rule validations still win — this is the least
  -- interesting reason a call can fail and should not mask the others.
  --
  -- Reaching this means: no explicit deadline was passed AND no regular-season
  -- Week 1 game is loaded for this season. Load the schedule first, or pass
  -- p_entry_closes_at. Note that a mid-season creation is NOT an error: the
  -- derived kickoff is simply in the past, entry is closed from the start, and
  -- that is a true statement about a season already underway.
  if v_entry is null then
    raise exception 'entry_deadline_unknown' using errcode = 'P0001';
  end if;

  -- A short, human-friendly invite code. Retry on the (rare) collision.
  -- gen_random_uuid() is pg_catalog (core since PG13) and cryptographically
  -- random — deliberately NOT pgcrypto's gen_random_bytes, which this function's
  -- search_path cannot reach on Supabase. See 0005.
  loop
    attempts := attempts + 1;
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.groups where invite_code = code);
    if attempts > 10 then
      raise exception 'invite_code_generation_failed';
    end if;
  end loop;

  insert into public.groups
    (name, season, elimination_type, tie_rule, invite_code, entry_closes_at, created_by)
  values
    (trim(p_name), v_season, p_elimination_type, p_tie_rule, code, v_entry, uid)
  returning * into g;

  insert into public.group_members (group_id, user_id, role, status)
  values (g.id, uid, 'admin', 'alive');

  return g;
end;
$$;

-- Replay these WITH the body. A function pasted without its grants fails with
-- 42501, which rpcErrorCode (src/app/app/actions.ts) reports as
-- migration_missing — indistinguishable from the function not existing at all.
revoke all on function public.create_group(text, text, text, int, timestamptz) from public;
grant execute on function public.create_group(text, text, text, int, timestamptz) to authenticated;
