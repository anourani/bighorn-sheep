-- Last Man Standing — the admin settings modal's write paths, plus feed health.
--
-- Four unrelated-looking pieces that the retabbed admin modal needs together:
-- renaming a league after it locks, editing the rules before it locks, deciding
-- per member whether the preseason practice round exists for them, and telling
-- the admin whether the score feed is actually running.
--
-- Apply with:  supabase db push   (or paste into the SQL editor). Replayable —
-- every statement is `if not exists` / `create or replace` / `on conflict`, and
-- the one backfill is fenced inside the block that creates its column so a
-- replay cannot re-run it. Like 0010 and unlike 0004, this file may be replayed.
--
-- NOT deterministic, though, which is a different property: the backfill in §3
-- reads now(), so applying this during preseason and applying it in December
-- give different answers. That is intended — see the note there.
--
-- No pgcrypto anywhere. Every function below is `security definer set
-- search_path = public`, and an unqualified extension call inside such a body
-- raises 42883 at runtime on Supabase (see CLAUDE.md). Every call here is a
-- pg_catalog builtin: btrim, length, left, coalesce, now, jsonb_build_object.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. set_group_name — rename, at any point in the season
--
-- Until now the name could not be changed at all: `AdminSettingsModal` never
-- built the field, and 0001's "groups update by admin (unlocked)" policy would
-- have refused it anyway once the season started, because its WITH CHECK is
--
--   is_group_admin(id) and settings_locked_at is null
--
-- and RLS cannot restrict WHICH COLUMNS an update writes. So the split this
-- feature needs — name always editable, rules frozen at lock — cannot be a
-- second policy. It is two definer functions that differ by one test: this one
-- has no lock check, and set_group_rules below does.
--
-- Same reasoning as set_group_buy_in (0010): a client-side `groups` update would
-- also hand the browser invite_code, entry_closes_at, elimination_type and
-- tie_rule. This writes one column.
--
-- A typo in a league name is precisely the sort of thing you notice after
-- kickoff, which is the case the old policy made unfixable outside the SQL
-- editor.
--
-- The 60-character cap is new: `groups.name` has no length constraint (0001),
-- and the name is printed into a fixed tile on Standings. `name_required` reuses
-- create_group's vocabulary (0005) so both share one copy dictionary.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_group_name(
  p_group_id uuid,
  p_name     text
)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.groups;
  -- btrim, not the app's trim: a name of only spaces must not pass.
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  if length(v_name) = 0 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;

  if length(v_name) > 60 then
    raise exception 'name_too_long' using errcode = 'P0001';
  end if;

  update public.groups
     set name = v_name
   where id = p_group_id
  returning * into updated;

  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all on function public.set_group_name(uuid, text) from public;
grant execute on function public.set_group_name(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. set_group_rules — editable until the season starts, and not after
--
-- The other half of the split above, and the half that enforces the lock:
-- a league cannot change what counts as elimination halfway through a season
-- people have already played.
--
-- TWO conditions, not one, and this is the important part. 0001 declared
-- settings_locked_at for exactly this job and NOTHING IN THIS PROJECT HAS EVER
-- WRITTEN IT — grep: the column has readers (this file, the RLS policy, the two
-- modals, the mock fixture) and no writer anywhere in src/, supabase/ or
-- netlify/. So a lock gated on that column alone would never fire, and rules
-- would stay editable in Week 12.
--
-- `entry_closes_at <= now()` is the second term, and it is the same "the season
-- has started" fact seasonPhase() derives everywhere else in the app — the
-- modal already computes it as `entryClosed`. Keeping settings_locked_at in the
-- test as well means that if anything ever does start writing it, it works as
-- 0001 intended without another migration.
--
-- The two `check (... in (...))` constraints on the columns (0001) are repeated
-- here rather than relied upon, so a bad value returns the stable code the UI
-- maps instead of a raw constraint-violation string. The constraint is still the
-- gate a determined caller cannot skip; this is the friendly one. Codes match
-- create_group's (0005).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_group_rules(
  p_group_id         uuid,
  p_elimination_type text,
  p_tie_rule         text
)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g       public.groups;
  updated public.groups;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  if p_elimination_type not in ('single', 'two_time') then
    raise exception 'bad_elimination_type' using errcode = 'P0001';
  end if;

  if p_tie_rule not in ('push', 'loss') then
    raise exception 'bad_tie_rule' using errcode = 'P0001';
  end if;

  select * into g from public.groups where id = p_group_id;
  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;

  if g.settings_locked_at is not null or g.entry_closes_at <= now() then
    raise exception 'settings_locked' using errcode = '55000';
  end if;

  update public.groups
     set elimination_type = p_elimination_type,
         tie_rule         = p_tie_rule
   where id = p_group_id
  returning * into updated;

  return updated;
end;
$$;

revoke all on function public.set_group_rules(uuid, text, text) from public;
grant execute on function public.set_group_rules(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. group_members.show_preseason — who gets the practice round
--
-- The NFL preseason is a practice round: picks are real, but the standing is
-- DERIVED at read time from preseason picks and never written to
-- group_members.status/.strikes, so it is thrown away wholesale at Week 1 (see
-- src/lib/league/practice.ts). This flag decides, per member, whether that round
-- exists for them at all — both the weeks in their picker and their ability to
-- pick one.
--
-- Default false: joining a league should not silently enrol you in a practice
-- game, and the admin turning it on per player is the decision this implements.
--
-- The backfill is the exception to that, and it is deliberately WIDER than "has
-- already made a preseason pick". Someone who joined during preseason but hasn't
-- picked yet is the very person about to — evicting them on the day this
-- migration lands, with no message anywhere saying why, would read as a data bug
-- rather than a policy. So every existing member of a league still in preseason
-- keeps what they have today, and `default false` governs everyone who joins
-- from here.
--
-- FENCED INSIDE THE COLUMN-CREATION GUARD, for 0004's reason turned around: a
-- bare UPDATE out here would re-run on every replay and silently re-enable every
-- member an admin had since turned OFF. The `if not exists` means the backfill
-- runs exactly once, on the apply that creates the column. This is the single
-- most important line in the file.
--
-- Consequence worth naming: because the predicate reads now(), applying this
-- after Week 1 backfills nobody. That is correct — practice is over by then —
-- but it does mean the migration is replayable without being deterministic.
--
-- No index: every read is already scoped by group_id, which is indexed.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'group_members'
       and column_name  = 'show_preseason'
  ) then
    alter table public.group_members
      add column show_preseason boolean not null default false;

    update public.group_members gm
       set show_preseason = true
      from public.groups g
     where g.id = gm.group_id
       and g.entry_closes_at > now();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. set_member_preseason — the admin write path for that flag
--
-- An RPC for the strongest of the three reasons in this file: `group_members`
-- has NO update policy at all (0001), so a direct update from the client reports
-- success and changes nothing. Mirrors set_member_buy_in (0007/0010) exactly.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_member_preseason(
  p_group_id uuid,
  p_user_id  uuid,
  p_show     boolean
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

  update public.group_members
     set show_preseason = p_show
   where group_id = p_group_id
     and user_id  = p_user_id
  returning * into updated;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all on function public.set_member_preseason(uuid, uuid, boolean) from public;
grant execute on function public.set_member_preseason(uuid, uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. feed_status — did the scorer actually run?
--
-- `poll-scores` has never recorded anything about its own runs. Its only outputs
-- are a console.log and a Response that Netlify's cron discards, so the admin
-- modal's "ESPN · healthy" pill was a hardcoded string and the only way to know
-- whether scores were updating was to read a function log.
--
-- ONE ROW, upserted, not an append-only log: the cron is */5 * * * * all year,
-- which would be ~105k rows a year for a value only ever read as "the latest",
-- plus a retention job nobody would write.
--
-- Two timestamps, and that is the point. `checked_at` is the heartbeat, written
-- on EVERY run; `last_ok_at` only advances on success. A fresh checked_at beside
-- a stale last_ok_at reads as "we are checking and it is failing" — a different
-- message from "nothing has run at all", which one timestamp would have
-- collapsed them into.
--
-- Why not derive this from max(games.updated_at) and add no schema? Because that
-- is when a SCORE last changed, not when we last looked. It goes stale on any
-- quiet day while the feed is perfectly healthy.
--
-- The `singleton boolean primary key default true check (singleton)` shape is
-- lifted from 0009's public_league: the one-row invariant is a database fact
-- rather than a convention, so no reader needs a tie-break rule.
--
-- RLS on, and deliberately NO policies. The anon key ships in the browser
-- bundle, so a readable-by-authenticated policy would hand every player the
-- provider's error strings. Written by the service role (which bypasses RLS)
-- through record_feed_sync, read through feed_status_for_admin — the same shape
-- as 0010's account_closures, where the absence of policies IS the enforcement.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.feed_status (
  singleton       boolean primary key default true check (singleton),
  checked_at      timestamptz not null default now(),
  status          text not null default 'ok' check (status in ('ok', 'error')),
  detail          text not null default '',
  provider        text not null default 'espn',
  season          integer,
  last_ok_at      timestamptz,
  games_upserted  integer not null default 0,
  members_updated integer not null default 0,
  error           text
);

alter table public.feed_status enable row level security;

-- Deliberately no select / insert / update / delete policies. See the header.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. record_feed_sync — the poller's write path
--
-- A function rather than a bare .upsert() from the service role (which would
-- work, RLS being bypassed) for two reasons that are not style:
--
--   * `last_ok_at = coalesce(excluded.last_ok_at, f.last_ok_at)` is a
--     data-integrity invariant — a failing run must not erase when the feed last
--     worked — and putting it here is what stops a future caller forgetting it.
--   * `checked_at` becomes POSTGRES's clock rather than a Netlify container's.
--     feed_status_for_admin returns now() from the same database, and the UI
--     subtracts one from the other to print "checked 3 minutes ago"; sourcing
--     the two from different machines is how that goes negative.
--
-- Granted to service_role only. `authenticated` must never reach this.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_feed_sync(
  p_status          text,
  p_detail          text,
  p_provider        text,
  p_season          integer,
  p_games_upserted  integer default 0,
  p_members_updated integer default 0,
  p_error           text default null
)
returns public.feed_status
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.feed_status;
begin
  if p_status not in ('ok', 'error') then
    raise exception 'bad_status' using errcode = '22023';
  end if;

  insert into public.feed_status as f (
    singleton, checked_at, status, detail, provider, season,
    last_ok_at, games_upserted, members_updated, error
  )
  values (
    true, now(), p_status, coalesce(p_detail, ''), coalesce(p_provider, 'unknown'), p_season,
    case when p_status = 'ok' then now() else null end,
    coalesce(p_games_upserted, 0), coalesce(p_members_updated, 0),
    -- Capped: a provider stack trace must not become an unbounded column.
    left(p_error, 500)
  )
  on conflict (singleton) do update set
    checked_at      = excluded.checked_at,
    status          = excluded.status,
    detail          = excluded.detail,
    provider        = excluded.provider,
    season          = excluded.season,
    last_ok_at      = coalesce(excluded.last_ok_at, f.last_ok_at),
    games_upserted  = excluded.games_upserted,
    members_updated = excluded.members_updated,
    error           = excluded.error
  returning * into row_out;

  return row_out;
end;
$$;

revoke all on function public.record_feed_sync(text, text, text, integer, integer, integer, text) from public;
grant execute on function public.record_feed_sync(text, text, text, integer, integer, integer, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. feed_status_for_admin — the read path
--
-- Takes a group id purely to prove the caller administers something; there is
-- one row, so the argument does not select WHICH status comes back. That makes
-- it unlike the hazard CLAUDE.md flags for public_league_snapshot, where a
-- group-id parameter would have turned an anon-callable function into a
-- universal standings reader. This one is admin-gated and league-independent.
--
-- Returns jsonb (the public_league_snapshot precedent) so `now` can travel with
-- the row — see record_feed_sync above for why the clock has to be the
-- database's. `sync` is SQL null when the poller has never run, which is a state
-- the caller renders rather than an error.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.feed_status_for_admin(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'checkedAt',      f.checked_at,
           'status',         f.status,
           'detail',         f.detail,
           'provider',       f.provider,
           'season',         f.season,
           'lastOkAt',       f.last_ok_at,
           'gamesUpserted',  f.games_upserted,
           'membersUpdated', f.members_updated,
           'error',          f.error
         )
    into payload
    from public.feed_status f
   where f.singleton;

  return jsonb_build_object('now', now(), 'sync', payload);
end;
$$;

revoke all on function public.feed_status_for_admin(uuid) from public;
grant execute on function public.feed_status_for_admin(uuid) to authenticated;
