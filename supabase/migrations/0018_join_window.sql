-- Last Man Standing — let people join until the LAST kickoff of Week 1.
--
-- The league's rule, as its commissioner states it, is that a new player may
-- enter right up until the final game of Week 1 starts. The app closed entry at
-- the FIRST kickoff of Week 1 instead, roughly five days earlier.
--
-- The obvious fix — move `groups.entry_closes_at` five days later — is wrong,
-- and this migration exists because of why. That column carries TWO facts that
-- happened to coincide:
--
--   1. "entry is still open"  — join_by_invite (0002), add_entry (0017),
--      remove_member (0017), and the invite CTAs in the app.
--   2. "the season has not started yet" — seasonPhase() in
--      src/lib/game/season.ts derives the app's whole notion of phase from it,
--      set_group_rules (0011) freezes the rules on it, set_member_preseason
--      (0011/0017) closes the practice window on it, and load.ts builds the
--      practice round behind it.
--
-- Move the column and the second meaning moves with it: the app would sit in
-- phase "preseason" through Week 1's Thursday and Sunday games — practice
-- standings board, preseason headcount, and a rules editor an admin could still
-- change while football was being played. So the two facts are SPLIT here.
-- `join_closes_at` carries the entry window; `entry_closes_at` keeps meaning the
-- first kickoff of Week 1 and every phase, practice and rules-freeze consumer is
-- deliberately left reading it.
--
-- Apply with:  supabase db push   (or paste into the SQL editor).
--
-- REPLAYABLE. Every function below is `create or replace` plus its grants, and
-- the one UPDATE is FENCED inside the column-creation guard — 0011's
-- show_preseason lesson and 0016's tour backfill. A bare UPDATE out in the file
-- would re-run on every replay and stomp a deadline an admin had since set by
-- hand.
--
-- THE ONE NEW EXPRESSION, and it is the whole safety story:
--
--   coalesce(g.join_closes_at, g.entry_closes_at)
--
-- Nullable column, never a default. Before the backfill runs, for a league whose
-- Week 1 is not loaded, or against a database where only half of this file was
-- pasted, every gate below falls back to exactly today's behaviour. The failure
-- mode of a half-applied migration is "joining still closes at the first
-- kickoff", which is a rule nobody is surprised by — not an exception, and not
-- an open door.
--
-- No pgcrypto. Every function here is `security definer set search_path =
-- public`, and an unqualified extension call inside such a body raises 42883 at
-- runtime on Supabase (see CLAUDE.md). Everything called below — coalesce, now,
-- max, min, count — is a pg_catalog builtin.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The column, and a fenced backfill.
--
-- `season_type = 'regular' and week = 1` for the same reason 0012 spells it out:
-- a full schedule's earliest game is the Hall of Fame game in early August, so
-- an unqualified max/min over the season is not the number anyone means. This
-- reads the same three columns 0012 and alignEntryDeadlines read, so the three
-- cannot disagree.
--
-- max(), where 0012 takes min(). That single difference is this whole feature.
-- ─────────────────────────────────────────────────────────────────────────────
do $fence$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'groups'
       and column_name  = 'join_closes_at'
  ) then
    alter table public.groups add column join_closes_at timestamptz;

    comment on column public.groups.join_closes_at is
      'Last kickoff of regular-season Week 1 — when joining stops. Null falls '
      'back to entry_closes_at. Distinct from entry_closes_at, which is the '
      'FIRST kickoff of Week 1 and means the season has started.';

    -- Fenced: runs once, on the migration that creates the column. Null for a
    -- league whose Week 1 is not loaded, which the coalesce below covers.
    update public.groups g
       set join_closes_at = (select max(kickoff)
                               from public.games gm
                              where gm.season      = g.season
                                and gm.season_type = 'regular'
                                and gm.week        = 1);
  end if;
end
$fence$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. invite_preview — transcribed from 0002 with one expression changed.
--
-- This one is easy to forget and loud when you do: it is what the signed-out
-- invite screen reads. Left on entry_closes_at it would tell someone the league
-- was closed while join_by_invite next door accepted them.
--
-- Still granted to `anon` as well as `authenticated` — the whole point of this
-- function is that it answers before anyone has signed in.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.invite_preview(p_code text)
returns table (
  name             text,
  season           int,
  entry_open       boolean,
  member_count     int,
  elimination_type text,
  tie_rule         text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.name,
    g.season,
    (coalesce(g.join_closes_at, g.entry_closes_at) > now())         as entry_open,
    (select count(*) from public.group_members m
       where m.group_id = g.id)::int                                as member_count,
    g.elimination_type,
    g.tie_rule
  from public.groups g
  where g.invite_code = p_code
  limit 1;
$$;

revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. join_by_invite — transcribed from 0002 with one expression changed.
--
-- Still raises `entry_closed`, deliberately. The app's copy dictionaries key off
-- that code (JoinByCode.tsx, LoginFlow.tsx); a new code would be a silent
-- fall-through to the `?? res.error` catch-all in every one of them.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.join_by_invite(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g   public.groups;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into g from public.groups where invite_code = p_code;
  if not found then
    raise exception 'invalid_code' using errcode = 'P0002';
  end if;

  if coalesce(g.join_closes_at, g.entry_closes_at) <= now() then
    raise exception 'entry_closed' using errcode = 'P0001';
  end if;

  -- Already a member? Nothing to do — return the group so the caller lands in it.
  if exists (
    select 1 from public.group_members m
    where m.group_id = g.id and m.user_id = uid
  ) then
    return g;
  end if;

  insert into public.group_members (group_id, user_id, role, status)
  values (g.id, uid, 'player', 'alive');

  return g;
end;
$$;

revoke all on function public.join_by_invite(text) from public;
grant execute on function public.join_by_invite(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. add_entry — transcribed from 0017 with one expression changed.
--
-- A second entry is an entry, so it closes on the same clock. 0017's own note
-- makes the argument this preserves: a second run bought in week 9 would be a
-- fresh start at a season nine weeks gone. Week 1 Monday night is still Week 1.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.add_entry(p_group_id uuid)
returns public.group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  g       public.groups;
  n       int;
  created public.group_members;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into g from public.groups where id = p_group_id;
  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;

  select count(*) into n
    from public.group_members
   where group_id = p_group_id and user_id = uid;

  if n = 0 then
    raise exception 'not_a_member' using errcode = 'P0002';
  end if;

  if coalesce(g.join_closes_at, g.entry_closes_at) <= now() then
    raise exception 'entry_closed' using errcode = '55000';
  end if;

  if n >= 2 then
    raise exception 'entry_limit' using errcode = 'P0001';
  end if;

  insert into public.group_members (group_id, user_id, role, status, entry_no)
  values (p_group_id, uid, 'player', 'alive', 2)
  returning * into created;

  return created;
end;
$$;

revoke all on function public.add_entry(uuid) from public;
grant execute on function public.add_entry(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. remove_member — transcribed from 0017 with one expression changed.
--
-- Removal is the UNDO for a join, which is 0013's stated reason for closing it
-- on the same deadline in the first place. Moving one without the other would
-- leave an admin unable to remove somebody who joined on the Sunday of Week 1 —
-- the exact window this migration opens.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.remove_member(
  p_group_id uuid,
  p_user_id  uuid,
  p_entry_no int default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_join_closes_at timestamptz;
  v_role           text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select coalesce(join_closes_at, entry_closes_at) into v_join_closes_at
    from public.groups where id = p_group_id;

  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;

  if v_join_closes_at <= now() then
    raise exception 'entry_closed' using errcode = '55000';
  end if;

  select role into v_role
    from public.group_members
   where group_id = p_group_id
     and user_id  = p_user_id
     and entry_no = p_entry_no;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  if v_role = 'admin' then
    raise exception 'cannot_remove_admin' using errcode = 'P0001';
  end if;

  -- 0013's reason, kept verbatim: picks reference groups and profiles, never
  -- group_members, so deleting a membership row leaves its picks behind holding
  -- picks_team_once_per_phase. Scoped to entry_no as well, or removing one entry
  -- would take the other entry's picks with it.
  delete from public.picks
   where group_id = p_group_id
     and user_id  = p_user_id
     and entry_no = p_entry_no;

  delete from public.group_members
   where group_id = p_group_id
     and user_id  = p_user_id
     and entry_no = p_entry_no;
end;
$$;

revoke all on function public.remove_member(uuid, uuid, int) from public;
grant execute on function public.remove_member(uuid, uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. create_group — transcribed from 0012, deriving BOTH deadlines.
--
-- The SIGNATURE IS STILL UNCHANGED, and 0012's reasoning is why: a parameter
-- without a default may not follow one that has a default, so adding
-- p_join_closes_at would mean reordering, which means `drop function`, which
-- breaks the positional call in docs/dry-run.md and forces an edit to
-- src/lib/supabase/types.ts. There is no p_join_closes_at. The join deadline is
-- derived, or it is null and falls back.
--
-- v_join deliberately does NOT raise when it comes back null, where v_entry
-- does. They are not the same kind of unknown: a missing entry_closes_at leaves
-- the league with no notion of when its season starts, which is unrecoverable
-- from inside the app; a missing join_closes_at just means joining follows
-- entry_closes_at, which is what it did for the app's whole life before this.
-- Refuse for the fact you cannot substitute; fall back for the one you can.
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
  -- The first kickoff of Week 1 — 0012's derivation, unchanged. See that file
  -- for why season_type/week are named rather than taking the season minimum.
  v_entry  timestamptz := coalesce(
                            p_entry_closes_at,
                            (select min(kickoff)
                               from public.games
                              where season      = v_season
                                and season_type = 'regular'
                                and week        = 1));
  -- The LAST kickoff of Week 1. Same three columns, max instead of min.
  v_join   timestamptz := (select max(kickoff)
                             from public.games
                            where season      = v_season
                              and season_type = 'regular'
                              and week        = 1);
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
    (name, season, elimination_type, tie_rule, invite_code,
     entry_closes_at, join_closes_at, created_by)
  values
    (trim(p_name), v_season, p_elimination_type, p_tie_rule, code,
     v_entry, v_join, uid)
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
