-- ============================================================================
-- Last Man Standing — one-shot database setup.
--
-- Convenience bundle of the migration files, concatenated in order, so the
-- whole schema can be applied in ONE paste into the Supabase SQL Editor. It is
-- generated from (and must stay in sync with) the numbered migrations:
--   supabase/migrations/0001_init.sql
--   supabase/migrations/0002_join_by_invite.sql
--   supabase/migrations/0003_group_create_and_pick_flags.sql
--   supabase/migrations/0004_profile_names_avatars.sql
--   supabase/migrations/0005_invite_code_without_pgcrypto.sql (folded into
--     create_group below, so this bundle needs no separate 0005 section)
--   supabase/migrations/0006_preseason_picks.sql
--   supabase/migrations/0007_profile_extras_and_buy_in.sql
--   supabase/migrations/0008_private_profile_fields.sql
--   supabase/migrations/0009_public_standings.sql
--   supabase/migrations/0010_account_closure_and_league_buy_in.sql
--   supabase/migrations/0011_admin_settings.sql
--   supabase/migrations/0012_create_group_entry_deadline.sql (also folded into
--     create_group below, for the same reason as 0005)
--   supabase/migrations/0013_lock_membership_writes.sql (folded in: the
--     "members insert self" policy is simply ABSENT below)
--   supabase/migrations/0014_pick_consistency.sql (folded into the picks
--     insert/update policies below — the game-consistency conjuncts)
--   supabase/migrations/0015_pick_and_buy_in_reminders.sql
-- Edit those, not this file. Run once on a fresh project.
--
-- KNOWN BROKEN, and not by 0015 — annotated rather than silently fixed, the way
-- 0003 carries its own known-bad line. This bundle currently FAILS on a fresh
-- project at the `picks` insert/update policies below, with
--
--   ERROR: column picks.season_type does not exist
--
-- because 0014's game-consistency conjuncts were folded into policies that sit
-- in the 0001 section, while `picks.season_type` is not added until the 0006
-- section further down. The numbered migrations are unaffected — applying
-- 0001..0015 in order works, which is what production did — so this only bites
-- someone standing up a brand-new project from this file. The fix is to define
-- those two policies after the 0006 section rather than before it; it is a
-- restructure of this file alone and wants its own change.
--
-- Verified by applying 0001..0015 in order onto an empty PostgreSQL 16, and by
-- applying this bundle with those two conjuncts removed, which then completes
-- and produces every 0015 object.
-- ============================================================================


-- Last Man Standing — initial schema + Row-Level Security.
--
-- The pick-privacy rule ("you can't read another player's current pick until
-- that team's game has kicked off") is enforced HERE, in Postgres, not in the
-- frontend. That is the whole reason picks live behind RLS: pick integrity is
-- the core of the app and must not be trustable to a client.
--
-- Apply with the Supabase CLI:  supabase db push   (or paste into the SQL editor)

-- ─────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles — one row per auth user (display name etc.)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  created_at   timestamptz not null default now()
);

-- Auto-create a profile whenever a new auth user signs up (magic link / OTP).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- groups — one private league. No default/global group; every group is created
-- deliberately and joined by invite.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  season            int  not null,
  elimination_type  text not null default 'single' check (elimination_type in ('single', 'two_time')),
  tie_rule          text not null default 'push'   check (tie_rule in ('push', 'loss')),
  invite_code       text not null unique,
  entry_closes_at   timestamptz not null,  -- first kickoff of Week 1
  settings_locked_at timestamptz,          -- set once Week 1 picks begin
  created_by        uuid not null references public.profiles (id),
  created_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- group_members — membership + survival state (denormalized for fast standings)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.group_members (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.groups (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             text not null default 'player' check (role in ('admin', 'player')),
  status           text not null default 'alive'  check (status in ('alive', 'eliminated')),
  strikes          int  not null default 0,
  eliminated_week  int,
  joined_at        timestamptz not null default now(),
  unique (group_id, user_id)
);
create index if not exists group_members_group_idx on public.group_members (group_id);
create index if not exists group_members_user_idx on public.group_members (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- games — the shared NFL schedule/results (global, not per-group). Written only
-- by the scheduled scorer (service role); readable by any authenticated user.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.games (
  id            text primary key,               -- provider (ESPN) game id
  season        int  not null,
  season_type   text not null default 'regular' check (season_type in ('pre', 'regular', 'post')),
  week          int  not null,
  kickoff       timestamptz not null,           -- source of truth for pick locks
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'in_progress', 'delayed', 'final', 'postponed')),
  home          text not null,
  away          text not null,
  home_score    int,
  away_score    int,
  status_detail text,
  updated_at    timestamptz not null default now()
);
create index if not exists games_week_idx on public.games (season, season_type, week);

-- ─────────────────────────────────────────────────────────────────────────────
-- picks — one team per member per week. Two hard survival invariants live in
-- the unique constraints: one pick per week, and a team used at most once/season.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.picks (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  week       int  not null,
  team_id    text not null,
  game_id    text not null references public.games (id),
  result     text check (result in ('win', 'loss', 'push', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at  timestamptz,
  unique (group_id, user_id, week),      -- one pick per week
  unique (group_id, user_id, team_id)    -- a team can only be used once all season
);
create index if not exists picks_group_week_idx on public.picks (group_id, week);
create index if not exists picks_game_idx on public.picks (game_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: is the current auth user a member (optionally admin) of a group?
-- SECURITY DEFINER so the membership check itself isn't subject to RLS recursion.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(gid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.games         enable row level security;
alter table public.picks         enable row level security;

-- profiles: readable by any authenticated user (member names); write only own.
create policy "profiles read" on public.profiles
  for select to authenticated using (true);
create policy "profiles upsert own" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- groups: members can read their groups; anyone authenticated can create one;
-- only an admin can update settings, and only while they're unlocked.
create policy "groups read for members" on public.groups
  for select to authenticated using (public.is_group_member(id));
create policy "groups insert by creator" on public.groups
  for insert to authenticated with check (created_by = auth.uid());
create policy "groups update by admin (unlocked)" on public.groups
  for update to authenticated
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id) and settings_locked_at is null);

-- group_members: read members of your own groups. There is deliberately NO
-- client INSERT/UPDATE/DELETE policy — membership is created only by the
-- SECURITY DEFINER functions join_by_invite / create_group (which bypass RLS),
-- so a direct anon-key insert cannot self-enroll, let alone as admin. See 0013.
create policy "members read same group" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));

-- games: read-only to all authenticated users; writes come from the service
-- role (scheduled scorer), which bypasses RLS.
create policy "games read" on public.games
  for select to authenticated using (true);

-- picks: the privacy heart of the app.
--   SELECT — you always see your own; you see another member's pick only once
--            that pick's game has kicked off (which also covers all past weeks,
--            since their games have long since kicked off).
create policy "picks read own or revealed" on public.picks
  for select to authenticated using (
    user_id = auth.uid()
    or (
      public.is_group_member(group_id)
      and exists (
        select 1 from public.games g
        where g.id = picks.game_id
          and (g.kickoff <= now() or g.status <> 'scheduled')
      )
    )
  );

--   INSERT — only your own pick, in a group you belong to, for a game that
--            hasn't kicked off yet.
create policy "picks insert own before kickoff" on public.picks
  for insert to authenticated with check (
    user_id = auth.uid()
    and public.is_group_member(group_id)
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

--   UPDATE — you may change your pick until the (current) team's game kicks off,
--            and the replacement team's game must also be un-kicked.
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

--   DELETE — you may retract your own pick before kickoff.
create policy "picks delete own before kickoff" on public.picks
  for delete to authenticated using (
    user_id = auth.uid()
    and exists (
      select 1 from public.games g
      where g.id = picks.game_id and g.kickoff > now() and g.status = 'scheduled'
    )
  );

-- Note: results and eliminations are written by the service-role scorer, which
-- bypasses RLS. The richer pick guard (team-not-used, entry-open, member alive)
-- is additionally enforced in application code (see src/lib/game/elimination.ts,
-- canPick) before any write is attempted.


-- Last Man Standing — join-by-invite RPCs.
--
-- The groups SELECT policy in 0001 ("groups read for members") only lets you read
-- a group you already belong to. A prospective joiner therefore cannot resolve an
-- invite code → group id under normal RLS. These two SECURITY DEFINER functions are
-- the sanctioned, minimal-surface bypass for exactly that:
--
--   invite_preview(code)  — anon-safe. Returns only a league's public-facing summary
--                           (name, counts, entry status) to someone who already holds
--                           the secret invite code. Lets the join form validate a code
--                           and show "You're joining {League}" before we email anyone.
--
--   join_by_invite(code)  — authenticated only. Resolves + validates + inserts the
--                           caller's own membership row, idempotently. Returns the group.
--
-- Apply with:  supabase db push   (or paste into the SQL editor)

-- ─────────────────────────────────────────────────────────────────────────────
-- invite_preview — validate a code and surface a minimal public summary.
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
    (g.entry_closes_at > now())                                     as entry_open,
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
-- join_by_invite — resolve the group, enforce the entry window, insert membership.
-- Idempotent: joining a league you're already in returns the group without error.
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

  if g.entry_closes_at <= now() then
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


-- Last Man Standing — group creation + current-pick presence flag.
--
-- Two SECURITY DEFINER functions the wired-up app needs:
--
--   create_group(...)          — authenticated. Atomically creates a league and
--                                enrolls the caller as its admin, generating a
--                                unique invite code. One round-trip, no orphan
--                                group if the membership insert were to fail.
--
--   hidden_pick_user_ids(g, w) — authenticated, members only. Returns just the
--                                user_ids in a group who have locked a pick for
--                                week `w` whose game HASN'T kicked off yet. This
--                                is the sanctioned, minimal leak behind the
--                                Standings padlock: it reveals THAT a rival has
--                                picked (so the UI shows a lock, not an empty
--                                slot) without revealing WHICH team. The team
--                                itself stays hidden by the picks RLS in 0001.
--
-- Apply with:  supabase db push   (or paste into the SQL editor)

-- ─────────────────────────────────────────────────────────────────────────────
-- create_group — create a league + the creator's admin membership, atomically.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- hidden_pick_user_ids — who has a locked-but-not-yet-revealed pick this week.
-- Members only; returns user_ids only (never the team). Powers the padlock.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.hidden_pick_user_ids(p_group_id uuid, p_week int)
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
    and p.week = p_week
    and public.is_group_member(p_group_id)   -- caller must belong to the group
    and g.kickoff > now()
    and g.status = 'scheduled';
$$;

revoke all on function public.hidden_pick_user_ids(uuid, int) from public;
grant execute on function public.hidden_pick_user_ids(uuid, int) to authenticated;


-- Last Man Standing — real names + avatars, and account-existence detection.
--
-- Three changes ship together here:
--
--   1. Names. The free-text `display_name` is replaced by structured
--      `first_name` / `last_name`. Everyone renders uniformly as "First L."
--      (e.g. "Alex N.") in the app; the columns are the source. We backfill
--      first/last from the old `display_name` and then DROP it — nothing reads
--      it once the app is on the new columns.
--
--   2. Avatars. A nullable `avatar_url` on profiles, plus a public `avatars`
--      storage bucket whose objects are keyed by the owner's user id so a member
--      can only write their own image.
--
--   3. account_exists(email). Powers the unified login: one email field that
--      tells the user whether they already have an account (send a link) or need
--      to create one. anon-callable by necessity; the email-enumeration tradeoff
--      is accepted for this private, invite-only app.
--
-- NOTE: the storage.* policies below require the migration to run as the
-- database owner (supabase db push / SQL editor). A restricted role cannot
-- create policies on storage.objects.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profiles: structured name + avatar columns
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists first_name text not null default '';
alter table public.profiles add column if not exists last_name  text not null default '';
alter table public.profiles add column if not exists avatar_url text;

-- Backfill first/last from the legacy single `display_name`, once. Only touches
-- rows not yet split, so it is safe to re-run.
update public.profiles
set
  first_name = split_part(trim(display_name), ' ', 1),
  last_name  = ltrim(substr(trim(display_name), length(split_part(trim(display_name), ' ', 1)) + 1))
where coalesce(first_name, '') = '';

-- Auto-create a profile on signup. Reads the new first_name/last_name metadata,
-- falling back to the legacy `display_name` metadata (for any old magic link
-- still in flight), then the email local-part — so every client provisions a
-- sensible profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''),
      split_part(coalesce(new.raw_user_meta_data ->> 'display_name', new.email), ' ', 1),
      split_part(new.email, '@', 1)
    ),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The old free-text name is fully migrated into first_name/last_name above and
-- nothing reads it anymore — drop it. (No index/policy/view depends on it.)
alter table public.profiles drop column if exists display_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. account_exists — has this email already completed sign-in at least once?
--
-- `signInWithOtp({ shouldCreateUser: true })` inserts an auth.users row when the
-- link is REQUESTED, before it is clicked. Filtering on email_confirmed_at makes
-- "exists" mean "has actually signed in", so a half-finished new user still lands
-- in the name-collection branch of the login flow.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.account_exists(p_email text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(trim(p_email))
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.account_exists(text) from public;
grant execute on function public.account_exists(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. avatars storage bucket + RLS
--
-- Path convention: `<user_id>/avatar.<ext>`, so (storage.foldername(name))[1]
-- is the owner's uid. Public read (images render via a plain <img>); writes are
-- restricted to the owner's own folder.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars read public" on storage.objects;
create policy "avatars read public" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);


-- Last Man Standing — make picks season-type aware, so the NFL preseason can be
-- a live practice round that resets completely at Week 1.
--
-- `picks` gains season_type, and both survival invariants are re-scoped to it.
-- The second one IS the "everything resets at Week 1" rule: preseason and
-- regular season keep entirely separate used-team lists, so all 32 teams are
-- available again when the real season starts.
--
-- No RLS change is required. Every picks policy (0001) keys on `game_id` alone
-- and never references `picks.week`.
--
-- Preseason elimination state is deliberately NOT stored. group_members.status,
-- .strikes and .eliminated_week stay exclusively regular-season; the app derives
-- preseason standing at read time. That is what makes the Week 1 reset need no
-- reset job at all.

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
-- The originals were declared inline above as table-level `unique (...)`, so
-- PostgreSQL auto-named them `picks_group_id_user_id_week_key` and
-- `picks_group_id_user_id_team_id_key`.
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
--    hidden_pick_user_ids(uuid, int) above.
--
-- The older version is left in place: it has already run against real databases,
-- and rewriting an applied migration is how this repo has broken itself before.
-- A distinct name rather than an overload also keeps supabase.rpc() unambiguous.
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


-- Last Man Standing — profile extras (phone, favorite animal) and per-league
-- buy-in tracking.
--
-- Buy-in lives on `group_members`, not `profiles`: a buy-in is owed to a league,
-- and a player in three leagues can be square with one and not the others.
--
-- `group_members` has no UPDATE policy at all — membership state is written only
-- by the service role, from netlify/functions/poll-scores.ts. Marking a buy-in
-- paid is the first legitimate admin write to another member's row, so it goes
-- through a SECURITY DEFINER RPC that checks is_group_admin() itself. A
-- `for update` policy would be the wrong tool: it cannot restrict WHICH columns
-- an admin writes, so it would hand the client role, status, strikes and
-- eliminated_week as well.
--
-- Reads need nothing new. The existing "members read same group" SELECT policy
-- already lets co-members see each other's rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profiles: phone + favorite animal
--
-- favorite_animal is deliberately unconstrained text rather than a check
-- constraint or an enum. The allowed list is a shared TypeScript constant
-- (src/lib/profile/animals.ts) validated in the server action, so adding an
-- eleventh animal stays a code change instead of a migration against a live
-- database. Both columns are nullable — neither is required to play.
--
-- (phone is superseded by 0008 below, which moves it to profile_private and
-- drops this column — kept here so this bundle stays a faithful concatenation.)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists favorite_animal text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. group_members: buy-in state
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.group_members
  add column if not exists buy_in_paid boolean not null default false;
alter table public.group_members
  add column if not exists buy_in_paid_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. set_member_buy_in — the admin write path
--
-- SECURITY DEFINER so it can bypass the (absent) UPDATE policy, but it re-checks
-- authorisation itself before touching anything. is_group_admin() reads
-- auth.uid(), which resolves from the request JWT and is unaffected by the
-- definer switch.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_member_buy_in(
  p_group_id uuid,
  p_user_id  uuid,
  p_paid     boolean
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

  update public.group_members
     set buy_in_paid    = p_paid,
         buy_in_paid_at = case when p_paid then now() else null end
   where group_id = p_group_id
     and user_id  = p_user_id
  returning * into updated;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all on function public.set_member_buy_in(uuid, uuid, boolean) from public;
grant execute on function public.set_member_buy_in(uuid, uuid, boolean) to authenticated;


-- Last Man Standing — move the phone number behind real access control.
--
-- `phone` on world-readable `profiles` (0007) was the first genuinely private
-- field on that table. It moves to `profile_private`: readable by the owner and
-- by admins of leagues the owner belongs to, writable only by the owner. A
-- separate table rather than a tighter profiles policy, because a policy
-- subquerying group_members from a table group_members' own policy subqueries is
-- the classic route to `infinite recursion detected in policy`.

create table if not exists public.profile_private (
  id    uuid primary key references public.profiles (id) on delete cascade,
  phone text
);

alter table public.profile_private enable row level security;

-- Am I an admin of any league this member belongs to? SECURITY DEFINER so the
-- body bypasses RLS — self-contained, like is_group_member/is_group_admin above.
create or replace function public.is_admin_for_member(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid()
      and mine.role = 'admin'
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function public.is_admin_for_member(uuid) from public;
grant execute on function public.is_admin_for_member(uuid) to authenticated;

drop policy if exists "private profile read" on public.profile_private;
create policy "private profile read" on public.profile_private
  for select to authenticated
  using (id = auth.uid() or public.is_admin_for_member(id));

drop policy if exists "private profile insert" on public.profile_private;
create policy "private profile insert" on public.profile_private
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "private profile update" on public.profile_private;
create policy "private profile update" on public.profile_private
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No DELETE policy: rows die with the profile via the FK cascade.

-- Backfill from profiles.phone, then drop it. Guarded so a re-run is a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone'
  ) then
    insert into public.profile_private (id, phone)
    select id, phone from public.profiles where phone is not null
    on conflict (id) do update set phone = excluded.phone;
  end if;
end $$;

alter table public.profiles drop column if exists phone;


-- ─────────────────────────────────────────────────────────────────────────────
-- 0009 — public_league + public_league_snapshot.
--
-- The signed-out landing page's only read path. See
-- supabase/migrations/0009_public_standings.sql for the full rationale,
-- particularly why the pointer table exists instead of a `groups` column (an
-- admin-writable flag would be self-serve publication) and why the function
-- takes no arguments (an argument would make it a universal standings reader).
--
-- Applying this publishes NOTHING. The landing page stays in its no-data state
-- until a row is inserted into public_league by hand:
--
--   insert into public.public_league (group_id)
--   select id from public.groups where invite_code = 'YOURCODE';
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
-- 0010 — account closure, and a per-league buy-in amount.
--
-- See supabase/migrations/0010_account_closure_and_league_buy_in.sql for the
-- full rationale, particularly why closure is a policy-less side table rather
-- than a `profiles.deleted_at` column (RLS cannot restrict which columns an
-- update writes, so a self-clearable lockout is not a lockout) and why the
-- buy-in amount goes through an RPC despite `groups` already having an admin
-- UPDATE policy (same reason, one table over).
--
-- The set_member_buy_in below REPLACES the copy defined earlier in this file:
-- the timestamp now records every change rather than only the paid branch, so
-- the account page can print "UNPAID · Updated 10/21". Order matters — this
-- bundle is meant to be read and run top to bottom.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.groups
  add column if not exists buy_in_cents integer not null default 2000;
alter table public.groups
  add column if not exists site_fee_cents integer not null default 100;

alter table public.groups drop constraint if exists groups_buy_in_cents_nonneg;
alter table public.groups
  add constraint groups_buy_in_cents_nonneg check (buy_in_cents >= 0);
alter table public.groups drop constraint if exists groups_site_fee_cents_nonneg;
alter table public.groups
  add constraint groups_site_fee_cents_nonneg check (site_fee_cents >= 0);

-- Closing an account is not a delete: the player's profile, membership, picks
-- and strikes all survive, because their line on the standings board is part of
-- the league's record for the season. RLS on, and deliberately no insert /
-- update / delete policies — the absence is what stops a closed account
-- clearing its own lockout with the anon key.
--
-- To reopen an account:
--   delete from public.account_closures where id = '<user-uuid>';
create table if not exists public.account_closures (
  id        uuid primary key references public.profiles (id) on delete cascade,
  closed_at timestamptz not null default now()
);

alter table public.account_closures enable row level security;

drop policy if exists "account closure read" on public.account_closures;
create policy "account closure read" on public.account_closures
  for select to authenticated
  using (id = auth.uid() or public.is_admin_for_member(id));

create or replace function public.close_own_account()
returns public.account_closures
language plpgsql
security definer
set search_path = public
as $$
declare
  closed public.account_closures;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.account_closures (id)
  values (auth.uid())
  on conflict (id) do nothing;

  select * into closed from public.account_closures where id = auth.uid();
  return closed;
end;
$$;

revoke all on function public.close_own_account() from public;
grant execute on function public.close_own_account() to authenticated;

create or replace function public.set_group_buy_in(
  p_group_id       uuid,
  p_buy_in_cents   integer,
  p_site_fee_cents integer
)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.groups;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  if p_buy_in_cents is null or p_site_fee_cents is null
     or p_buy_in_cents < 0 or p_site_fee_cents < 0 then
    raise exception 'bad_amount' using errcode = '22023';
  end if;

  update public.groups
     set buy_in_cents   = p_buy_in_cents,
         site_fee_cents = p_site_fee_cents
   where id = p_group_id
  returning * into updated;

  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all on function public.set_group_buy_in(uuid, integer, integer) from public;
grant execute on function public.set_group_buy_in(uuid, integer, integer) to authenticated;

create or replace function public.set_member_buy_in(
  p_group_id uuid,
  p_user_id  uuid,
  p_paid     boolean
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

  update public.group_members
     set buy_in_paid    = p_paid,
         buy_in_paid_at = now()
   where group_id = p_group_id
     and user_id  = p_user_id
  returning * into updated;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  return updated;
end;
$$;

revoke all on function public.set_member_buy_in(uuid, uuid, boolean) from public;
grant execute on function public.set_member_buy_in(uuid, uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- From 0011_admin_settings.sql — admin write paths + feed health.
-- ─────────────────────────────────────────────────────────────────────────────
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
-- The flag is a PRESEASON-ONLY affair and closes for good at the first Week 1
-- kickoff. `set_member_preseason` refuses to move it after that, and the loader
-- ignores it regardless — practice does not exist once the season starts, so
-- there is no Week 11 in which somebody's preseason could be switched back on.
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
-- success and changes nothing. Mirrors set_member_buy_in (0007/0010) exactly,
-- with one addition it does not have: a window.
--
-- Practice is over at the first Week 1 kickoff and never comes back, so this
-- refuses to move the flag after `entry_closes_at` — the same "the season has
-- started" fact set_group_rules tests and seasonPhase() derives everywhere else.
-- The read side already ignores the flag by then, so this is belt and braces:
-- what it actually buys is that the stored value cannot drift away from what the
-- season allows, and that an admin can't be misled into thinking a toggle they
-- just flipped in Week 11 did something.
--
-- Unlike set_group_rules this does NOT also test settings_locked_at. That column
-- has never been written by anything (see §2), and here the kickoff is the whole
-- and only rule.
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


-- ============================================================================
-- 0015 — reminder emails for missing picks and unpaid buy-ins.
--
-- Verbatim from supabase/migrations/0015_pick_and_buy_in_reminders.sql, minus
-- that file's apply-instructions header. The privacy decision it turns on is
-- worth repeating here: reminder_due returns email addresses and is granted to
-- service_role ALONE; reminder_status_for_admin is the browser's projection of
-- the same definition with that column dropped, so no address ever reaches a
-- browser. Do not "simplify" the two into one function.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profile_private.reminder_opt_out — declared now, written by nothing yet
--
-- 0008's header names profile_private as the home for "notification
-- preferences", and this is one line in a migration that is being hand-applied
-- anyway; adding it later means a whole second hand-applied migration for one
-- column.
--
-- The obvious objection is settings_locked_at: a column declared in 0001 for a
-- job nothing has ever written, which CLAUDE.md flags as a trap because a lock
-- gated on it alone would never fire. THE FAILURE DIRECTIONS ARE OPPOSITE. An
-- unwritten settings_locked_at makes a guard silently never fire — a false
-- negative that leaves the rules editable in week 12. An unwritten
-- reminder_opt_out is false for everyone, so §3 behaves exactly as if the
-- column did not exist, and "nobody has opted out" is a true statement.
--
-- Nothing writes it yet. Until an opt-out control ships, the escape hatch is
--   insert into public.profile_private (id, reminder_opt_out) values ('<uuid>', true)
--     on conflict (id) do update set reminder_opt_out = true;
-- in the SQL editor — the same posture as reopening an account_closures row.
--
-- It is read only inside §3, so no .select() in the app ever names it. That
-- matters: PostgREST raises 42703 on an unknown column rather than returning
-- undefined, so a widened select against a database missing this migration
-- would fail the whole query rather than degrade.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profile_private
  add column if not exists reminder_opt_out boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. reminder_sends — the log, and the idempotence
--
-- APPEND-ONLY, where 0011's feed_status is a single upserted row. That contrast
-- is deliberate. feed_status is one row because a */5 cron would otherwise write
-- ~105k rows a year for a value only ever read as "the latest". Here the log IS
-- the feature — it is what dedupes a send and what prints "reminded 2 days ago"
-- beside a name — and a thirty-person league writes at most thirty rows a week.
--
-- run_id groups one click's rows, so the tab can say "sent 12, 4 minutes ago"
-- without a second table.
--
-- RLS on, and deliberately NO policies. The anon key ships in the browser
-- bundle, so a readable-by-authenticated policy would hand every player the
-- league's send history. Written by the service role through
-- record_reminder_send, read through reminder_status_for_admin — the same shape
-- as 0010's account_closures and 0011's feed_status, where the absence of
-- policies IS the enforcement.
--
-- Idempotence is a DATABASE property here, and that is the whole point.
-- src/lib/cron-auth.ts justifies leaving poll-scores ungated on the grounds
-- that it is idempotent; email is not idempotent unless something makes it so,
-- and a unique index is the only thing that survives a crashed job, a
-- double-click, and a future unauthenticated cron hit alike.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.reminder_sends (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null,
  group_id    uuid not null references public.groups (id)   on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('pick', 'buy_in')),
  season      integer not null,
  season_type text not null default 'regular' check (season_type in ('pre', 'regular', 'post')),
  -- Null for buy_in. A debt is not a weekly fact; see the index note below.
  week        integer,
  status      text not null check (status in ('sent', 'failed')),
  provider_id text,
  error       text,
  sent_at     timestamptz not null default now()
);

alter table public.reminder_sends enable row level security;

-- Deliberately no select / insert / update / delete policies. See the header.

-- Two asymmetries here, and BOTH look like oversights, so read the reasons.
--
--   * `where status = 'sent'` — a failed attempt must not block its own retry.
--     Without it, one provider hiccup would permanently consume a member's slot
--     for that week and they would silently never be reminded.
--
--   * There is NO equivalent index for kind = 'buy_in', on purpose. Its week is
--     null, and Postgres treats nulls as distinct, so the same index would
--     dedupe precisely nothing while looking like it did. There is also no
--     natural period for a debt: nagging in week 2 and again in week 6 is
--     legitimate, where nagging twice about week 6's pick is not. Buy-in
--     reminders are therefore THROTTLED by p_min_interval in §3 rather than
--     keyed. Pick reminders are keyed; buy-in reminders are throttled.
create unique index if not exists reminder_sends_pick_once
  on public.reminder_sends (group_id, user_id, season, season_type, week)
  where kind = 'pick' and status = 'sent';

create index if not exists reminder_sends_lookup
  on public.reminder_sends (group_id, kind, sent_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. reminder_due — the one definition of who should be emailed
--
-- Returns the address, and is granted to service_role ONLY. §4 wraps it for the
-- browser with that column dropped. See the header for why.
--
-- Why this cannot be derived on the client, even for the admin's own display:
-- 0001's "picks read own or revealed" policy returns another member's pick only
-- once its game has kicked off. So on a Wednesday, a client-side "has this
-- member picked?" reports NO for the entire league — every one of whom has
-- picked. The check has to run somewhere that sees the real rows, which is
-- here.
--
-- Two per-kind rules that are easy to get backwards:
--
--   * pick requires gm.status = 'alive'. Emailing an eliminated player to
--     remind them to pick is the cruellest bug this feature could have.
--   * buy_in deliberately does NOT filter on status. A player who went out in
--     week 3 still owes the pot.
--
-- p_week is ignored for buy_in and required for pick; the caller derives it (it
-- is NOT the app's "current week" — see src/lib/league/reminders.ts).
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
  select gm.user_id,
         p.first_name,
         p.last_name,
         u.email::text,
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
     -- A closed account keeps its line on the standings board but must not be
     -- emailed; close_own_account is the user asking to be left alone.
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
              and pk.season_type = p_season_type
              and pk.week        = p_week
         )
         -- Keyed, not throttled: the unique index is the real guarantee and
         -- this is the cheap pre-filter that keeps a doomed insert off the wire.
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
   order by p.first_name, p.last_name, gm.user_id;
$$;

revoke all on function public.reminder_due(uuid, text, integer, text, integer, interval) from public;
grant execute on function public.reminder_due(uuid, text, integer, text, integer, interval) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. reminder_status_for_admin — the browser's projection
--
-- security definer, so inside this body current_user is the function OWNER and
-- it may call reminder_due despite that function being granted to service_role
-- alone. One due-ness definition, two projections — and this one structurally
-- cannot leak an address, because it never names the column.
--
-- Takes a group id to prove the caller administers THAT league, and returns
-- only that league's rows, so unlike public_league_snapshot there is no risk of
-- the argument turning it into a universal reader.
--
-- Returns jsonb (the public_league_snapshot / feed_status_for_admin precedent)
-- so `now` travels with the payload. Every "reminded 2 hours ago" the drawer
-- prints is one subtraction against THIS clock; sourcing the two ends from
-- different machines is how such a string goes negative.
--
-- first_name / last_name go out raw, never a formatted name.
-- formatDisplayName (src/lib/league/name.ts) is the one place a name is
-- composed in this project, and a second rule written in SQL would drift from
-- it silently.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reminder_status_for_admin(
  p_group_id    uuid,
  p_season      integer,
  p_season_type text default 'regular',
  p_week        integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pick_rows   jsonb;
  buyin_rows  jsonb;
  last_pick   timestamptz;
  last_buy_in timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  -- Note the absent `email` in both projections. That omission is the privacy
  -- boundary described in the header; do not add it "for convenience".
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId',     d.user_id,
           'firstName',  d.first_name,
           'lastName',   d.last_name,
           'lastSentAt', d.last_sent_at
         )), '[]'::jsonb)
    into pick_rows
    from public.reminder_due(p_group_id, 'pick', p_season, p_season_type, p_week) d;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId',     d.user_id,
           'firstName',  d.first_name,
           'lastName',   d.last_name,
           'lastSentAt', d.last_sent_at
         )), '[]'::jsonb)
    into buyin_rows
    from public.reminder_due(p_group_id, 'buy_in', p_season, p_season_type, null) d;

  -- When the last run of each kind happened, for the manual cooldown. Read off
  -- the log rather than off the due list: someone reminded an hour ago has
  -- since dropped OFF the due list precisely because they were reminded, so a
  -- cooldown derived from the due rows would reset itself.
  select max(sent_at) into last_pick
    from public.reminder_sends
   where group_id = p_group_id and kind = 'pick' and status = 'sent';

  select max(sent_at) into last_buy_in
    from public.reminder_sends
   where group_id = p_group_id and kind = 'buy_in' and status = 'sent';

  return jsonb_build_object(
    'now',        now(),
    'season',     p_season,
    'seasonType', p_season_type,
    'week',       p_week,
    'pick',       jsonb_build_object('due', pick_rows,  'lastSentAt', last_pick),
    'buyIn',      jsonb_build_object('due', buyin_rows, 'lastSentAt', last_buy_in)
  );
end;
$$;

revoke all on function public.reminder_status_for_admin(uuid, integer, text, integer) from public;
grant execute on function public.reminder_status_for_admin(uuid, integer, text, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. record_reminder_send — the write path
--
-- A function rather than a bare .insert() from the service role (which would
-- work, RLS being bypassed) for the same reason record_feed_sync is one:
-- sent_at becomes POSTGRES's clock rather than a Netlify container's, and §4
-- returns now() from the same database for the UI to subtract.
--
-- `on conflict do nothing` against the partial unique index, so a retry after a
-- crash between the provider's 2xx and this write is a no-op rather than an
-- error. The job treats a no-op as success — the member has been emailed, which
-- is the fact the index encodes.
--
-- Granted to service_role only. `authenticated` must never reach this.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_reminder_send(
  p_run_id      uuid,
  p_group_id    uuid,
  p_user_id     uuid,
  p_kind        text,
  p_season      integer,
  p_season_type text default 'regular',
  p_week        integer default null,
  p_status      text default 'sent',
  p_provider_id text default null,
  p_error       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'bad_status' using errcode = '22023';
  end if;

  if p_kind not in ('pick', 'buy_in') then
    raise exception 'bad_kind' using errcode = '22023';
  end if;

  insert into public.reminder_sends (
    run_id, group_id, user_id, kind, season, season_type, week,
    status, provider_id, error
  )
  values (
    p_run_id, p_group_id, p_user_id, p_kind, p_season,
    coalesce(p_season_type, 'regular'), p_week,
    p_status, p_provider_id,
    -- Capped: a provider stack trace must not become an unbounded column.
    left(p_error, 500)
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.record_reminder_send(uuid, uuid, uuid, text, integer, text, integer, text, text, text) from public;
grant execute on function public.record_reminder_send(uuid, uuid, uuid, text, integer, text, integer, text, text, text) to service_role;
