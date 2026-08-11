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
-- Edit those, not this file. Run once on a fresh project.
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

-- group_members: read members of your own groups; insert only yourself.
create policy "members read same group" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));
create policy "members insert self" on public.group_members
  for insert to authenticated with check (user_id = auth.uid());

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
      select 1 from public.games g
      where g.id = picks.game_id and g.kickoff > now() and g.status = 'scheduled'
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
    and exists (
      select 1 from public.games g
      where g.id = picks.game_id and g.kickoff > now() and g.status = 'scheduled'
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
  v_entry  timestamptz := coalesce(p_entry_closes_at, now() + interval '7 days');
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

  -- A short, human-friendly invite code. Retry on the (rare) collision.
  loop
    attempts := attempts + 1;
    -- gen_random_uuid() is pg_catalog (core since PG13) and cryptographically
    -- random. Deliberately NOT pgcrypto's gen_random_bytes: pgcrypto lives in
    -- the `extensions` schema on Supabase, which this function's
    -- `search_path = public` cannot reach. See migration 0005.
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
