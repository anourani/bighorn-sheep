-- ============================================================================
-- Last Man Standing — one-shot database setup.
--
-- Convenience bundle of the three migration files, concatenated in order, so the
-- whole schema can be applied in ONE paste into the Supabase SQL Editor. It is
-- generated from (and must stay in sync with) the numbered migrations:
--   supabase/migrations/0001_init.sql
--   supabase/migrations/0002_join_by_invite.sql
--   supabase/migrations/0003_group_create_and_pick_flags.sql
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
    code := upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));
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
