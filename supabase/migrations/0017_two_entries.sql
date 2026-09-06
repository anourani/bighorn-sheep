-- ─────────────────────────────────────────────────────────────────────────────
-- 0017_two_entries — a player may hold up to TWO entries in one league.
--
-- APPLY THIS TO PRODUCTION BY HAND. Nothing in netlify.toml or CI touches
-- Supabase; merging the PR deploys the code and leaves the database behind.
--
-- THE DECISION: a group_members row IS an entry. `entry_no` (1 or 2) joins
-- (group_id, user_id) as the identity of a player's run at the season, and the
-- three uniques that spelled "one person, one run" are re-keyed to include it.
--
-- Rejected: re-keying `picks` to `member_id`. Every policy, every RPC and every
-- loader already carries (group_id, user_id); pointing picks at group_members
-- would rewrite all of them to reach the same place, and would make `picks`
-- reference a table it has deliberately never referenced (see 0013_remove_member,
-- which explains why picks are deleted explicitly rather than by cascade).
--
-- Rejected: an `entries` table. Survival state (status, strikes,
-- eliminated_week) and money state (buy_in_paid) are per-entry and already live
-- on group_members. A second table would split one row's worth of facts in two.
--
-- REPLAYABLE. Every column is `add column if not exists`, every constraint is
-- guarded, and the backfill is the column DEFAULT rather than an UPDATE — so a
-- rerun cannot re-stamp anyone. (0011's show_preseason backfill is the cautionary
-- tale: a bare UPDATE out in the file re-runs on every replay.)
--
-- WHAT THIS DOES NOT DO. `close_own_account()` (0010) is keyed on the profile
-- id and is untouched, so closing an account closes BOTH entries. That is the
-- intended behaviour and the account page says so. There is also no way to
-- REMOVE an entry from the app in v1 — `remove_member` gains p_entry_no here so
-- an admin can do it, but no self-serve path exists.
--
-- Confirm the constraint state before and after (the README's deploy probe
-- checks columns, routines and tables, but no constraints):
--
--   select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid in ('public.group_members'::regclass, 'public.picks'::regclass)
--     and contype = 'u'
--   order by 1, 2;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The column, on both tables.
--
-- smallint with a CHECK rather than an enum or a plain int: the cap is a product
-- rule ("up to two"), and a check constraint is the one place it can be raised
-- later without a type change. `default 1` is what makes every existing row an
-- entry 1 with no UPDATE, and what makes the app's `entry_no ?? 1` reads agree
-- with the database rather than merely paper over it.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.group_members
  add column if not exists entry_no smallint not null default 1;
alter table public.picks
  add column if not exists entry_no smallint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.group_members'::regclass and conname = 'group_members_entry_no_check'
  ) then
    alter table public.group_members
      add constraint group_members_entry_no_check check (entry_no in (1, 2));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.picks'::regclass and conname = 'picks_entry_no_check'
  ) then
    alter table public.picks
      add constraint picks_entry_no_check check (entry_no in (1, 2));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Re-key group_members' uniqueness.
--
-- 0001:72 declared it as a bare inline `unique (group_id, user_id)`, so
-- PostgreSQL auto-named it and that name appears NOWHERE in this repo. Dropping
-- by a guessed name would silently do nothing on a database where someone had
-- renamed it — and the failure mode is the worst kind: the migration reports
-- success, the new unique is added alongside the old one, and the old one goes
-- on refusing every second entry. So this finds the constraint by its COLUMN
-- SET and drops whatever it is actually called.
--
-- The loop is also what makes this replayable: after the first run no unique on
-- exactly (group_id, user_id) remains, so the body never executes again.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.group_members'::regclass
       and con.contype = 'u'
       and (
         select array_agg(att.attname::text order by att.attname)
           from unnest(con.conkey) k
           join pg_attribute att
             on att.attrelid = con.conrelid and att.attnum = k
       ) = array['group_id', 'user_id']
  loop
    execute format('alter table public.group_members drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.group_members'::regclass and conname = 'group_members_entry_key'
  ) then
    alter table public.group_members
      add constraint group_members_entry_key unique (group_id, user_id, entry_no);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Re-key the two survival invariants.
--
-- 0006 named these explicitly, so unlike §2 they can be dropped by name. Both
-- keep their names — they mean the same thing, one scope narrower — because the
-- names are load-bearing at the call site: submitPick keys off SQLSTATE 23505
-- and its comment names `picks_team_once_per_phase` (see 0006's own note about
-- the previous rename silently breaking a message match).
--
-- The scope this adds is the whole feature: entry 1 and entry 2 each get one
-- pick per week, and each spends a team once per phase, INDEPENDENTLY. Picking
-- the Ravens with both entries in the same week is legal and deliberate.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.picks drop constraint if exists picks_one_per_week;
alter table public.picks drop constraint if exists picks_team_once_per_phase;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.picks'::regclass and conname = 'picks_one_per_week'
  ) then
    alter table public.picks
      add constraint picks_one_per_week
      unique (group_id, user_id, entry_no, season_type, week);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.picks'::regclass and conname = 'picks_team_once_per_phase'
  ) then
    alter table public.picks
      add constraint picks_team_once_per_phase
      unique (group_id, user_id, entry_no, season_type, team_id);
  end if;
end $$;

create index if not exists picks_group_entry_phase_week_idx
  on public.picks (group_id, user_id, entry_no, season_type, week);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Close the hole this opens in the picks write policies.
--
-- 0014 tied a pick's week / season_type / team / season to its game, but every
-- clause keys the WRITER on `user_id = auth.uid()` alone. Add entry_no to the
-- table and that is suddenly not enough: a direct PostgREST call with the anon
-- key (which ships in the browser bundle — RLS is the only real boundary here)
-- could write `entry_no = 2` while holding only entry 1, manufacturing a second
-- entry's picks without a second entry existing.
--
-- The new conjunct is the fix, and it is deliberately an EXISTS against
-- group_members rather than a count: it says "you hold the entry you are writing
-- for", which is exactly the missing sentence.
--
-- Everything else is transcribed unchanged from 0014:57-106. Idempotent
-- (drop + recreate). The SELECT and DELETE policies are untouched: SELECT is
-- already scoped to own-or-revealed, and DELETE to own-row-before-kickoff, and
-- neither can forge an entry.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "picks insert own before kickoff" on public.picks;
create policy "picks insert own before kickoff" on public.picks
  for insert to authenticated with check (
    user_id = auth.uid()
    and public.is_group_member(group_id)
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = picks.group_id
        and gm.user_id  = auth.uid()
        and gm.entry_no = picks.entry_no
    )
    and exists (
      select 1
      from public.games g
      join public.groups gr on gr.id = picks.group_id
      where g.id = picks.game_id
        and g.kickoff > now()
        and g.status = 'scheduled'
        and g.week = picks.week
        and g.season_type = picks.season_type
        and g.season = gr.season
        and picks.team_id in (g.home, g.away)
    )
  );

drop policy if exists "picks update own before kickoff" on public.picks;
create policy "picks update own before kickoff" on public.picks
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.games g
      where g.id = picks.game_id and g.kickoff > now() and g.status = 'scheduled'
    )
  )
  with check (
    user_id = auth.uid()
    and public.is_group_member(group_id)
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = picks.group_id
        and gm.user_id  = auth.uid()
        and gm.entry_no = picks.entry_no
    )
    and exists (
      select 1
      from public.games g
      join public.groups gr on gr.id = picks.group_id
      where g.id = picks.game_id
        and g.kickoff > now()
        and g.status = 'scheduled'
        and g.week = picks.week
        and g.season_type = picks.season_type
        and g.season = gr.season
        and picks.team_id in (g.home, g.away)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. hidden_pick_member_ids — the entry-aware sibling of hidden_picks_for_week.
--
-- A SIBLING, not a redefinition, on 0006's own precedent: it added
-- hidden_picks_for_week beside 0003's hidden_pick_user_ids rather than rewriting
-- an applied migration, and named it distinctly so supabase.rpc() stays
-- unambiguous. Both older functions keep working.
--
-- The difference is the identity it returns: group_members.id, not user_id. Two
-- entries belonging to one person are two rows on the standings board, and a
-- padlock has to land on the entry that picked rather than on both. Returning
-- user_id could not express that.
--
-- Same contract otherwise — members only, ids only, never the team. The
-- caller-must-belong gate is is_group_member, as before.
--
-- Note the join: picks carry (group_id, user_id, entry_no), which is exactly
-- group_members_entry_key, so this resolves to at most one membership row.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.hidden_pick_member_ids(
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
  select gm.id
  from public.picks p
  join public.games g on g.id = p.game_id
  join public.group_members gm
    on gm.group_id = p.group_id
   and gm.user_id  = p.user_id
   and gm.entry_no = p.entry_no
  where p.group_id = p_group_id
    and p.season_type = p_season_type
    and p.week = p_week
    and public.is_group_member(p_group_id)
    and g.kickoff > now()
    and g.status = 'scheduled';
$$;

revoke all on function public.hidden_pick_member_ids(uuid, text, int) from public;
grant execute on function public.hidden_pick_member_ids(uuid, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. add_entry — the ONLY way a second entry comes into existence.
--
-- join_by_invite is deliberately untouched. Its "already a member? return the
-- group" guard (0002:79-84) is what has enforced one-entry-per-person for the
-- app's whole life, and turning THAT into the second-entry path would mean every
-- re-click of an invite link silently enrolled someone twice. Adding an entry is
-- a decision, so it gets its own verb.
--
-- FAILS CLOSED, in this order, and every branch raises rather than returning a
-- sentinel: a definer function that answers "no" quietly is how an app ends up
-- reporting success for a write that never happened.
--
--   not_authenticated — no session
--   not_a_member      — you cannot add a second entry to a league you are not in
--   entry_closed      — the join window governs entries too. A second entry
--                       bought in week 9 would be a fresh run at a season that
--                       is nine weeks gone, and `alignEntryDeadlines` keeps
--                       entry_closes_at honest against the real Week 1 kickoff.
--   entry_limit       — already holds two. The CHECK would catch a third anyway;
--                       this is what makes the refusal legible at the call site.
--
-- role is hard-coded 'player'. An admin's second entry is not a second admin —
-- there is no demote control in the product (see 0013_remove_member), so an
-- accidental extra admin row would be unremovable from the app.
--
-- show_preseason is left to its 0011 default (false). Practice is opt-in per
-- member by admin action; a new entry inherits nothing, deliberately, because
-- the alternative is silently enrolling a second entry in a practice game its
-- owner never asked for.
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

  if g.entry_closes_at <= now() then
    raise exception 'entry_closed' using errcode = '55000';
  end if;

  if n >= 2 then
    raise exception 'entry_limit' using errcode = 'P0001';
  end if;

  -- entry_no 2 explicitly rather than n + 1: the only way to reach here is
  -- holding exactly one entry, and if a future migration ever allows a gap
  -- (entry 1 removed, entry 2 kept) then n + 1 would collide with the row that
  -- is still there. The unique constraint would catch it; naming the number
  -- means it cannot arise.
  insert into public.group_members (group_id, user_id, role, status, entry_no)
  values (p_group_id, uid, 'player', 'alive', 2)
  returning * into created;

  return created;
end;
$$;

revoke all on function public.add_entry(uuid) from public;
grant execute on function public.add_entry(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. The three per-member admin verbs gain p_entry_no.
--
-- All three located their row with `where group_id = ... and user_id = ...`,
-- which now matches TWO rows for a two-entry player. Left alone,
-- set_member_buy_in would mark both entries paid from one tap and remove_member
-- would delete a player's whole season when an admin meant to remove one entry.
--
-- The parameter is added LAST and DEFAULTED, so every existing named-argument
-- call site keeps working and means what it used to (entry 1). Postgres forbids
-- a non-defaulted parameter after a defaulted one anyway — the same constraint
-- 0012 ran into with create_group's p_entry_closes_at.
--
-- Each old signature is DROPPED first rather than left as an overload. A
-- three-argument call against both a 3-arg function and a 4-arg-with-default one
-- is ambiguous, and Postgres answers that with "function is not unique" — which
-- reaches the app as an unexplained failure on a control that worked yesterday.
--
-- Note the revoke/grant on each NEW signature. A create-or-replace keeps the old
-- ACL, but these are new functions as far as Postgres is concerned, so they
-- start with none; a body pasted without its grant fails with a bare 42501,
-- which rpcErrorCode reads as a missing migration.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.set_member_buy_in(uuid, uuid, boolean);
create or replace function public.set_member_buy_in(
  p_group_id uuid,
  p_user_id  uuid,
  p_paid     boolean,
  p_entry_no int default 1
)
returns public.group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.group_members;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  -- 0010's change, preserved: the stamp moves on EVERY change, both directions,
  -- because a card that reads "UNPAID · Updated 10/21, 2:47 PM" is the point.
  update public.group_members
     set buy_in_paid    = p_paid,
         buy_in_paid_at = now()
   where group_id = p_group_id
     and user_id  = p_user_id
     and entry_no = p_entry_no
  returning * into updated;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all on function public.set_member_buy_in(uuid, uuid, boolean, int) from public;
grant execute on function public.set_member_buy_in(uuid, uuid, boolean, int) to authenticated;

drop function if exists public.set_member_preseason(uuid, uuid, boolean);
create or replace function public.set_member_preseason(
  p_group_id uuid,
  p_user_id  uuid,
  p_show     boolean,
  p_entry_no int default 1
)
returns public.group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.group_members;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  if p_show is null then
    raise exception 'bad_value' using errcode = '22023';
  end if;

  -- 0011's window, preserved: practice ends at Week 1 and never returns, so
  -- unlike the money verb above this one closes with the entry deadline.
  if exists (
    select 1 from public.groups
     where id = p_group_id and entry_closes_at <= now()
  ) then
    raise exception 'preseason_closed' using errcode = '55000';
  end if;

  update public.group_members
     set show_preseason = p_show
   where group_id = p_group_id
     and user_id  = p_user_id
     and entry_no = p_entry_no
  returning * into updated;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all on function public.set_member_preseason(uuid, uuid, boolean, int) from public;
grant execute on function public.set_member_preseason(uuid, uuid, boolean, int) to authenticated;

drop function if exists public.remove_member(uuid, uuid);
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
  v_entry_closes_at timestamptz;
  v_role            text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select entry_closes_at into v_entry_closes_at
    from public.groups where id = p_group_id;

  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;

  if v_entry_closes_at <= now() then
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

  -- 0013's reason, now one scope narrower: picks reference groups and profiles,
  -- never group_members, so deleting a membership row leaves its picks behind
  -- holding picks_team_once_per_phase. Scoped to entry_no as well, or removing
  -- one entry would take the other entry's picks with it.
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
-- 8. public_league_snapshot — join picks on the entry, and publish entry_no.
--
-- Transcribed from 0009 with three changes and nothing else. The bug this fixes
-- would otherwise be silent and wrong in an interesting way: the `visible` and
-- `hidden` CTEs join `m on m.user_id = pk.user_id`, so with two membership rows
-- per person each of that person's picks would match BOTH — every entry 2 pick
-- would appear on entry 1's row and vice versa, and the landing board would show
-- two identical rows for a player whose entries had diverged.
--
-- `member_id` is group_members.id and so is already per-entry; it needs no
-- change and remains a total order for `order by m.member_id`.
--
-- entry_no joins the payload. It is 1 or 2 and identifies nothing about a person
-- — see the "deliberately absent" note in 0009, which this does not weaken.
--
-- create or replace, not drop: the return type is still jsonb.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.public_league_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select gr.*
    from public.public_league pl
    join public.groups gr on gr.id = pl.group_id
  ),
  m as (
    select
      gm.id       as member_id,
      gm.user_id  as user_id,   -- join key ONLY. Never emitted — see 0009.
      gm.entry_no as entry_no,
      gm.role, gm.status, gm.strikes, gm.eliminated_week,
      case
        when btrim(coalesce(p.first_name, '')) = ''
         and btrim(coalesce(p.last_name, ''))  = '' then 'Player'
        when btrim(coalesce(p.last_name, ''))  = '' then btrim(p.first_name)
        when btrim(coalesce(p.first_name, '')) = ''
          then upper(left(btrim(p.last_name), 1)) || '.'
        else btrim(p.first_name) || ' ' || upper(left(btrim(p.last_name), 1)) || '.'
      end as name
    from public.group_members gm
    join g on g.id = gm.group_id
    left join public.profiles p on p.id = gm.user_id
  ),
  visible as (
    select m.member_id, pk.week, pk.team_id, pk.game_id, pk.result
    from public.picks pk
    join g on g.id = pk.group_id
    join m on m.user_id = pk.user_id and m.entry_no = pk.entry_no
    join public.games gg on gg.id = pk.game_id
    where pk.season_type = 'regular'
      and not (gg.kickoff > now() and gg.status = 'scheduled')
  ),
  hidden as (
    select m.member_id, pk.week
    from public.picks pk
    join g on g.id = pk.group_id
    join m on m.user_id = pk.user_id and m.entry_no = pk.entry_no
    join public.games gg on gg.id = pk.game_id
    where pk.season_type = 'regular'
      and gg.kickoff > now()
      and gg.status = 'scheduled'
  )
  select jsonb_build_object(
    'now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'group', jsonb_build_object(
      'name',             g.name,
      'season',           g.season,
      'elimination_type', g.elimination_type,
      'tie_rule',         g.tie_rule,
      'entry_closes_at',  to_char(g.entry_closes_at at time zone 'UTC',
                                  'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',              m.member_id,
        'entry_no',        m.entry_no,
        'name',            m.name,
        'role',            m.role,
        'status',          m.status,
        'strikes',         m.strikes,
        'eliminated_week', m.eliminated_week,
        'picks', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'week',    v.week,
            'team_id', v.team_id,
            'game_id', v.game_id,
            'result',  v.result
          ) order by v.week), '[]'::jsonb)
          from visible v where v.member_id = m.member_id
        )
      ) order by m.member_id), '[]'::jsonb) from m
    ),
    'hidden_picks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'member_id', h.member_id, 'week', h.week)), '[]'::jsonb) from hidden h
    ),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',            gg.id,
        'season',        gg.season,
        'season_type',   gg.season_type,
        'week',          gg.week,
        'kickoff',       to_char(gg.kickoff at time zone 'UTC',
                                 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'status',        gg.status,
        'home',          gg.home,
        'away',          gg.away,
        'home_score',    gg.home_score,
        'away_score',    gg.away_score,
        'status_detail', gg.status_detail
      ) order by gg.kickoff), '[]'::jsonb)
      from public.games gg
      where gg.season = g.season and gg.season_type = 'regular'
    )
  )
  from g;
$$;

revoke all on function public.public_league_snapshot() from public;
grant execute on function public.public_league_snapshot() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. reminder_due — entry-aware, but still ONE ROW PER PERSON.
--
-- Two bugs appear here the moment a second entry exists, and they pull in
-- opposite directions:
--
--   * DUPLICATE EMAILS. The body reads `from group_members gm where gm.group_id
--     = p_group_id`, so a two-entry player is two rows and would be emailed
--     twice about the same league. `distinct on (gm.user_id)` is the fix.
--   * A MISSED REMINDER. The pick branch's not-exists tested only
--     (group_id, user_id, season_type, week), so ANY entry having picked
--     silenced the reminder for BOTH. It now tests gm.entry_no as well, which
--     is what makes "one of your two entries has no pick" reach the inbox.
--
-- ONE EMAIL PER PERSON is the decision, and it is what keeps reminder_sends and
-- its partial unique index (0015:158-160) correct AS THEY ARE — the dedupe key
-- is (group, user, season, season_type, week), which is exactly right for one
-- send per person per week. Adding entry_no to that index would license the
-- second email this function exists to prevent. Do not "finish the job" by
-- adding it.
--
-- reminder_status_for_admin needs no change at all: it selects from this
-- function, so it inherits both fixes.
--
-- distinct on requires its expression to lead the ORDER BY, which would replace
-- the caller-visible name sort — hence the subquery, with the original
-- `order by first_name, last_name, user_id` applied outside it. The return type
-- is unchanged, so this is create or replace.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reminder_due(
  p_group_id     uuid,
  p_kind         text,
  p_season       integer,
  p_season_type  text default 'regular',
  p_week         integer default null,
  p_min_interval interval default interval '3 days'
)
returns table (
  user_id      uuid,
  first_name   text,
  last_name    text,
  email        text,
  last_sent_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select d.user_id, d.first_name, d.last_name, d.email, d.last_sent_at
  from (
    select distinct on (gm.user_id)
           gm.user_id,
           p.first_name,
           p.last_name,
           u.email::text as email,
           ls.last_sent_at
      from public.group_members gm
      join public.profiles p on p.id = gm.user_id
      join auth.users     u on u.id = gm.user_id
      left join public.profile_private pp on pp.id = gm.user_id
      left join lateral (
        select max(rs.sent_at) as last_sent_at
          from public.reminder_sends rs
         where rs.group_id = gm.group_id
           and rs.user_id  = gm.user_id
           and rs.kind     = p_kind
           and rs.status   = 'sent'
      ) ls on true
     where gm.group_id = p_group_id
       and u.email is not null
       and not coalesce(pp.reminder_opt_out, false)
       and not exists (
         select 1 from public.account_closures ac where ac.id = gm.user_id
       )
       and (
         (p_kind = 'pick'
           and gm.status = 'alive'
           and p_week is not null
           and not exists (
             select 1 from public.picks pk
              where pk.group_id    = gm.group_id
                and pk.user_id     = gm.user_id
                and pk.entry_no    = gm.entry_no
                and pk.season_type = p_season_type
                and pk.week        = p_week
           )
           and not exists (
             select 1 from public.reminder_sends rs
              where rs.group_id    = gm.group_id
                and rs.user_id     = gm.user_id
                and rs.kind        = 'pick'
                and rs.status      = 'sent'
                and rs.season      = p_season
                and rs.season_type = p_season_type
                and rs.week        = p_week
           ))
         or
         (p_kind = 'buy_in'
           and gm.buy_in_paid = false
           and (ls.last_sent_at is null or ls.last_sent_at < now() - p_min_interval))
       )
     order by gm.user_id, gm.entry_no
  ) d
  order by d.first_name, d.last_name, d.user_id;
$$;

revoke all on function public.reminder_due(uuid, text, integer, text, integer, interval) from public;
grant execute on function public.reminder_due(uuid, text, integer, text, integer, interval) to service_role;
