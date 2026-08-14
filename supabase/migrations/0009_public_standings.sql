-- Last Man Standing — publish ONE league's standings to signed-out visitors.
--
-- The landing page (`/`) is anonymous-only: src/middleware.ts sends signed-in
-- visitors to /app. Every RLS policy in 0001 is `to authenticated`, so an
-- anonymous visitor can read nothing. This migration adds the one read path.
--
-- THE THREAT MODEL, because it drives every choice below: the anon key is
-- public — it ships in the JS bundle. Anything reachable with it is reachable
-- by anyone. So filtering in the server component would be theatre; a stranger
-- would just POST to /rest/v1/rpc/... themselves. The privacy rule has to be
-- in SQL, and it is, in exactly one place.
--
-- Apply with:  supabase db push   (or paste into the SQL editor). Idempotent.
-- NOT APPLIED BY THE BUILD — see README "#### Deploying". Nothing is published
-- until the separate `insert into public.public_league` at the bottom is run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. public_league — which league is public. A pointer table, not a flag column.
--
-- The obvious design is `groups.public_standings boolean`. It is unsafe. 0001's
-- policy
--
--   create policy "groups update by admin (unlocked)" on public.groups
--     for update to authenticated using (public.is_group_admin(id))
--
-- lets any league admin UPDATE their own group row, and RLS cannot restrict
-- WHICH columns an update writes — 0007's header comment says exactly this,
-- which is why set_member_buy_in exists at all. A flag on `groups` would
-- therefore be self-serve: any admin of any league could PATCH
-- /rest/v1/groups?id=eq.<theirs> with the anon key and publish their own
-- members' board to the open internet. Closing that would mean revoking
-- table-level UPDATE and re-granting column by column — a large blast radius
-- for no gain.
--
-- A separate table with RLS on and NO policies denies every client role
-- outright (anon and authenticated both get zero rows, not an error). Only the
-- service role and SECURITY DEFINER bodies can see it.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.public_league (
  -- `primary key check (singleton)` makes "at most one published league" a
  -- database invariant rather than a convention, so there is no ordering
  -- tie-break for a future reader to get wrong.
  singleton  boolean primary key default true check (singleton),
  group_id   uuid not null references public.groups (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.public_league enable row level security;

-- DO NOT ADD A POLICY HERE. RLS-enabled-with-no-policies is the security
-- property this table exists for; adding one is the only way it becomes
-- readable or writable from a browser.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. public_league_snapshot — the entire public surface, in one function.
--
-- Zero arguments, deliberately. An argument (group id, or invite code) would
-- turn this into a universal standings reader for every private league in the
-- project, since anyone can call it. Taking no input is what makes it safe.
--
-- One function returning jsonb rather than three `returns table` siblings: the
-- payload has three shapes, so that would mean three grants and — the decisive
-- part — three copies of the public_league predicate and the privacy filter.
-- Those rules should exist once.
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
      gm.id      as member_id,
      gm.user_id as user_id,   -- join key ONLY. Never emitted — see note below.
      gm.role, gm.status, gm.strikes, gm.eliminated_week,
      -- "Alex N." built here so the full surname never leaves the database.
      -- Mirrors formatDisplayName() in src/lib/league/name.ts, including its
      -- fallbacks; the mapper must NOT re-run that helper on this string.
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
  -- THE PRIVACY LOCK. The exact inversion of 0006's hidden_picks_for_week and
  -- of 0001's pick insert/update guards, applied uniformly to every week — so
  -- "already revealed" is defined by kickoff, never by week number.
  visible as (
    select m.member_id, pk.week, pk.team_id, pk.game_id, pk.result
    from public.picks pk
    join g on g.id = pk.group_id
    join m on m.user_id = pk.user_id
    join public.games gg on gg.id = pk.game_id
    where pk.season_type = 'regular'
      and not (gg.kickoff > now() and gg.status = 'scheduled')
  ),
  -- Who has picked but not yet revealed. {member_id, week} pairs, not a flat
  -- list: this function cannot know the current week (that is derived from
  -- kickoffs in TS), and a flat list would light a padlock in the current-week
  -- column for someone whose only un-kicked pick is for a LATER week.
  hidden as (
    select m.member_id, pk.week
    from public.picks pk
    join g on g.id = pk.group_id
    join m on m.user_id = pk.user_id
    join public.games gg on gg.id = pk.game_id
    where pk.season_type = 'regular'
      and gg.kickoff > now()
      and gg.status = 'scheduled'
  )
  select jsonb_build_object(
    -- to_char(... at time zone 'UTC', ...'"Z"') rather than letting
    -- jsonb_build_object render the timestamptz: that rendering follows the
    -- session TimeZone, and a non-UTC session would ship shifted kickoffs. Note
    -- the adjacent trap — `at time zone 'utc'` alone yields a bare timestamp,
    -- which `new Date()` parses as LOCAL time. The explicit "Z" is load-bearing.
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
    -- Games are public NFL facts (schedule + scores), not league data. Needed
    -- to derive missing history results and to resolve the current week from
    -- kickoffs, the same way loadLeague() does.
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

-- No pgcrypto anywhere above: btrim, left, upper, to_char and now are all
-- pg_catalog, so the `search_path = public` trap documented in CLAUDE.md
-- (unqualified extension calls raise 42883 at runtime) does not bite.
--
-- DELIBERATELY ABSENT from the payload: user_id (it is the auth.users uuid AND
-- the folder name in the public `avatars` bucket — 0004 stores
-- <user_id>/avatar.<ext> — so publishing it would hand a stranger a direct
-- object path per member plus a stable cross-reference into auth; member_id
-- works identically as a React key), email, phone, profile_private, full
-- last_name, avatar_url, favorite_animal, buy_in_paid, invite_code,
-- settings_locked_at, created_by, and all preseason picks.
--
-- DELIBERATELY PRESENT: role (the grid shows an Admin pill — it reveals the
-- commissioner, which is not sensitive) and the hidden-pick pairs, which reveal
-- THAT a member has picked but never WHAT — the same minimal disclosure 0003
-- already sanctioned for signed-in members.
--
-- With no row in public_league, `g` is empty and this returns SQL NULL, which
-- reaches JS as `data === null`. That is the "nothing published" signal and the
-- state the code ships in.

revoke all on function public.public_league_snapshot() from public;
grant execute on function public.public_league_snapshot() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Publish. RUN THIS SEPARATELY — it is not part of the schema.
--
--   insert into public.public_league (group_id)
--   select id from public.groups where invite_code = 'YOURCODE';
--
-- Keyed on the invite code so there is no uuid to fat-finger. To retract:
--
--   delete from public.public_league;
--
-- One statement, no redeploy, and the landing page falls back to its no-data
-- state on the next revalidation.
-- ─────────────────────────────────────────────────────────────────────────────
