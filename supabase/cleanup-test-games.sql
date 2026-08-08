-- NOT A MIGRATION. A one-off cleanup you run by hand, once, before or just after
-- loading a real NFL schedule.
--
-- Why this exists
-- ───────────────
-- `scripts/seed-test-week.ts` is the pre-season rehearsal harness: it invents 8
-- fake games so a real group of friends can walk the whole pick → lock → reveal →
-- result → elimination loop before any NFL game exists. It writes them into the
-- SAME `games` table the real schedule goes into, tagged `season_type = 'regular'`,
-- with ids shaped `test-{season}-{week}-{n}`.
--
-- docs/dry-run.md step 2 used to instruct `--season 2026 --week 1` — a real season
-- and a real week. So a database that has hosted a dry run holds 8 fabricated Week
-- 1 games that will sit alongside the 272 real ones. `gameForTeam`
-- (src/lib/league/games.ts) returns the FIRST match in a week, so a member could be
-- shown, or could pick, a game that does not exist.
--
-- This cannot recur: seed-test-week.ts now refuses to seed a week that already
-- holds real games, and sim-advance.ts only advances rows with the `test-` prefix.
-- This file is for rows written before those guards existed.

-- ─── 1. Look before you delete. Read-only; safe to run any time. ──────────────
select id, season, season_type, week, home, away, kickoff, status
from public.games
where id like 'test-%'
order by season, week, kickoff;

-- If that returns no rows, you are done — skip the rest.

-- ─── 2. See whether anyone actually picked one of them. ──────────────────────
-- Anything listed here is a real member's pick that will be destroyed by step 3.
-- Worth eyeballing before you run it.
select p.id, p.group_id, p.user_id, p.season_type, p.week, p.team_id, p.game_id
from public.picks p
where p.game_id like 'test-%'
order by p.week;

-- ─── 3. Delete — picks first, then games, in that order. ─────────────────────
-- `picks.game_id` is a plain FK with no ON DELETE clause (0001_init.sql:107), so
-- PostgreSQL refuses to delete a game while a pick still references it. One
-- statement cannot do this; the order matters.
--
-- Wrapped in a transaction so a failure on the second statement rolls the first
-- one back rather than leaving picks deleted and fake games behind.

begin;

delete from public.picks where game_id like 'test-%';
delete from public.games where id  like 'test-%';

-- Sanity check inside the transaction — both should be 0.
select
  (select count(*) from public.games where id      like 'test-%') as fake_games_left,
  (select count(*) from public.picks where game_id like 'test-%') as fake_picks_left;

commit;

-- ─── 4. Confirm the real schedule is what remains. ───────────────────────────
select season, season_type, week, count(*) as games
from public.games
group by season, season_type, week
order by season, season_type, week;
