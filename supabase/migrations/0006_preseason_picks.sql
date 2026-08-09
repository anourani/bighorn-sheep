-- Last Man Standing — make picks season-type aware, so the NFL preseason can be
-- a live practice round that resets completely at Week 1.
--
-- `games` already carries everything needed:
--
--   season_type text not null default 'regular'
--     check (season_type in ('pre', 'regular', 'post'))         -- 0001, line 84
--   create index games_week_idx on games (season, season_type, week)
--
-- `picks` does not, and its two unique constraints actively block preseason:
--
--   unique (group_id, user_id, week)      -- preseason wk 1 collides with regular wk 1
--   unique (group_id, user_id, team_id)   -- a team practised in preseason is burned
--                                            for the whole regular season
--
-- Both become season-type-scoped below. The second one IS the "everything resets
-- at Week 1" rule: preseason and regular season keep entirely separate used-team
-- lists, so all 32 teams are available again when the real season starts.
--
-- No RLS change is required. Every picks policy (0001, lines 184-238) keys on
-- `game_id` alone and never references `picks.week`, so adding a column and
-- swapping the uniques leaves every policy intact. Verified against 0001 before
-- writing this.
--
-- Preseason elimination state is deliberately NOT stored. `group_members.status`,
-- `.strikes`, and `.eliminated_week` stay exclusively regular-season; the app
-- derives preseason standing at read time from these rows. That is what makes the
-- Week 1 reset need no reset job at all.
--
-- Apply with:  supabase db push   (or paste into the SQL editor). Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. picks.season_type
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.picks
  add column if not exists season_type text not null default 'regular';

-- Separate statement so a re-run doesn't fail on a duplicate constraint name.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.picks'::regclass and conname = 'picks_season_type_check'
  ) then
    alter table public.picks
      add constraint picks_season_type_check
      check (season_type in ('pre', 'regular', 'post'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Re-scope the two survival invariants to (season_type, ...)
--
-- The originals were declared inline in 0001 as table-level `unique (...)`, so
-- PostgreSQL auto-named them `picks_group_id_user_id_week_key` and
-- `picks_group_id_user_id_team_id_key`. Dropped by name with `if exists`, so this
-- is safe whether or not they are still present.
--
-- Confirm the names on your database first (they will be these unless someone
-- renamed them by hand):
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.picks'::regclass and contype = 'u';
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.picks drop constraint if exists picks_group_id_user_id_week_key;
alter table public.picks drop constraint if exists picks_group_id_user_id_team_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.picks'::regclass and conname = 'picks_one_per_week'
  ) then
    -- One pick per member per week, per phase.
    alter table public.picks
      add constraint picks_one_per_week unique (group_id, user_id, season_type, week);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.picks'::regclass and conname = 'picks_team_once_per_phase'
  ) then
    -- A team may be used once per phase — so preseason practice does not consume
    -- a team for the regular season.
    alter table public.picks
      add constraint picks_team_once_per_phase unique (group_id, user_id, season_type, team_id);
  end if;
end $$;

create index if not exists picks_group_phase_week_idx
  on public.picks (group_id, season_type, week);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. hidden_picks_for_week — the season-type-aware sibling of
--    hidden_pick_user_ids(uuid, int) from 0003.
--
-- 0003's version is left untouched: it has already run against real databases,
-- and rewriting an applied migration is how this repo has broken itself before.
-- A distinct name rather than an overload also keeps supabase.rpc() unambiguous.
--
-- Same contract as the original — members only, user_ids only, never the team —
-- and no pgcrypto: an unqualified extension call inside a `set search_path =
-- public` body raises 42883 at runtime on Supabase. Nothing here needs one.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.hidden_picks_for_week(
  p_group_id    uuid,
  p_season_type text,
  p_week        int
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id
  from public.picks p
  join public.games g on g.id = p.game_id
  where p.group_id = p_group_id
    and p.season_type = p_season_type
    and p.week = p_week
    and public.is_group_member(p_group_id)   -- caller must belong to the group
    and g.kickoff > now()
    and g.status = 'scheduled';
$$;

revoke all on function public.hidden_picks_for_week(uuid, text, int) from public;
grant execute on function public.hidden_picks_for_week(uuid, text, int) to authenticated;
