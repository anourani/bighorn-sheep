-- Last Man Standing — let a league admin correct an entry's pick after kickoff.
--
-- The league's commissioner needs a repair tool. A player texts their pick and
-- the app eats it; somebody taps the wrong card; a postponed game has to be
-- re-pointed. Until now the only fix was the Supabase SQL editor, because the
-- app has no privileged pick path at all — deliberately, but the deliberation
-- was about players, not about the commissioner.
--
-- THE OBVIOUS FIX IS WRONG, and this migration exists because of why. The
-- obvious fix is adding `public.is_group_admin(group_id)` as a disjunct to the
-- `picks` INSERT/UPDATE policies. Four reasons not to:
--
--   1. A policy is reachable DIRECTLY FROM THE BROWSER with the anon key, which
--      ships in the JS bundle. Relaxing one does not give an admin a corrective
--      tool; it gives anyone holding an admin session an unlogged, unvalidated
--      write endpoint into the picks table.
--   2. To let an admin write AFTER kickoff you must drop the
--      `g.kickoff > now() and g.status = 'scheduled'` conjunct for them — which
--      also lets an admin back-date THEIR OWN pick once a game has finished.
--      That is the single thing this whole app exists to prevent, and RLS cannot
--      express "for anyone but yourself" without restating the identity test in
--      four separate places.
--   3. The relaxed branch would have to re-derive 0014's and 0017's consistency
--      conjuncts (week / season_type / season / team must match the game, and
--      the entry must be the caller's). Deriving `game_id` FROM the team inside
--      a definer body, as below, makes all of them true by CONSTRUCTION rather
--      than by a predicate somebody has to keep in step.
--   4. docs/prd-rls-write-hardening.md already ruled on this exact shape: "If
--      one is wanted later it is a new definer RPC, not a relaxed policy."
--
-- So the four `picks` policies are UNTOUCHED. An admin still cannot write
-- another member's pick with the anon key, and still cannot touch a kicked-off
-- pick of their own. The only new door is `admin_set_pick`, which is
-- `security definer`, checks `is_group_admin` itself, and writes an audit row
-- inside the same transaction as the change.
--
-- Apply with:  supabase db push   (or paste into the SQL editor).
--
-- REPLAYABLE. `create table if not exists`, `drop policy if exists` +
-- `create policy`, `create or replace function` plus its grants. There is no
-- backfill at all, so there is nothing to fence — unlike 0011, 0016 and 0018,
-- whose one-shot UPDATEs had to be guarded.
--
-- No pgcrypto. Every function here is `security definer set search_path =
-- public`, and an unqualified extension call inside such a body raises 42883 at
-- runtime on Supabase (see CLAUDE.md). Everything called below — coalesce, now,
-- min, max, greatest, jsonb_build_object — is a pg_catalog builtin.
-- `gen_random_uuid()` appears only as a COLUMN DEFAULT, where it is resolved
-- once at DDL time and the OID stored; that is the asymmetry CLAUDE.md spells
-- out, and it is why the default is safe where a call in a body would not be.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Refuse to install onto a pre-0017 database.
--
-- Everything below names `picks.entry_no`. A plpgsql body is NOT parsed for
-- column existence at CREATE time, so without this the function would install
-- happily and fail at its first call with 42703 — which `rpcErrorCode`
-- (src/app/app/actions.ts) reports as the ladder's catch-all, i.e. "Couldn't
-- save that pick. Try again.". That is the click-Save-forever failure 0011
-- already cost this project a debugging session over.
--
-- Raising here puts the real reason in front of whoever is in the SQL editor,
-- which is 0012's asymmetry exactly: a silent wrong answer is unrecoverable
-- from inside the app; an error is not.
-- ─────────────────────────────────────────────────────────────────────────────
do $fence$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'picks'
       and column_name  = 'entry_no'
  ) then
    raise exception
      '0019 requires 0017_two_entries: public.picks.entry_no is missing. Apply 0017 first.';
  end if;
end
$fence$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. pick_overrides — who changed whose pick, from what, to what, and when.
--
-- `account_closures`' shape (0010): RLS on, a SELECT policy, and deliberately NO
-- insert/update/delete policies. THE ABSENCE IS THE ENFORCEMENT — only a
-- security-definer function can write here, which is the same asymmetry 0010
-- needed to stop an account clearing its own closure row.
--
-- Worth the fifteen lines because this is the ONE write in the app where one
-- person silently rewrites another person's game record after the fact.
-- Everything else an admin can do is either visible to the member (their buy-in
-- dot, their preseason weeks) or removes them outright. A changed pick looks
-- exactly like a pick they made themselves, so "my Week 6 pick changed" has no
-- answer without this table.
--
-- Written inside `admin_set_pick`'s transaction, so the audit row and the change
-- land together or not at all.
--
-- No UI reads it in v1. The read policy is what makes an override log possible
-- later without another hand-applied migration, which is the cheaper half of the
-- decision to add it now.
--
-- To read the trail for a league:
--   select * from public.pick_overrides where group_id = '<uuid>' order by created_at desc;
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pick_overrides (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid     not null references public.groups   (id) on delete cascade,
  user_id     uuid     not null references public.profiles (id) on delete cascade,
  entry_no    smallint not null default 1,
  season      integer  not null,
  season_type text     not null default 'regular'
                check (season_type in ('pre', 'regular', 'post')),
  week        integer  not null,
  -- Null on either side means "there was no pick" / "the pick was cleared". Both
  -- are real states, so neither gets a placeholder.
  from_team   text,
  from_result text,
  to_team     text,
  admin_id    uuid     not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.pick_overrides enable row level security;

drop policy if exists "pick overrides read by admin" on public.pick_overrides;
create policy "pick overrides read by admin" on public.pick_overrides
  for select to authenticated using (public.is_group_admin(group_id));

-- Deliberately no insert / update / delete policies. See the header above: the
-- absence is the enforcement, not an oversight.

create index if not exists pick_overrides_lookup
  on public.pick_overrides (group_id, week, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. admin_set_pick — the one privileged write path into another entry's pick.
--
-- Returns JSONB rather than the picks row, and that is not decoration: the
-- caller has to re-score immediately afterwards, and `season` + `throughWeek`
-- are exactly what `recomputeSeason` needs. Handing them back here means the
-- action needs no second round trip for the schedule, and — more importantly —
-- that "the live week" has ONE definition, computed off the DATABASE's clock,
-- rather than one here and one in TypeScript that can disagree by a few seconds
-- either side of a kickoff.
--
-- p_team_id is deliberately NOT defaulted. Null means CLEAR, and a caller has to
-- say so: a default of null would turn a dropped field into a deleted pick.
-- p_entry_no IS defaulted, matching remove_member and set_member_buy_in, and a
-- defaulted parameter may not precede a non-defaulted one — hence the order.
--
-- REGULAR SEASON ONLY, hardcoded rather than taken as a parameter. Preseason
-- practice is derived at read time and never written to group_members, and
-- recomputeSeason filters `season_type = 'regular'` on both of its queries — so
-- a practice override could not be re-scored by anything. A parameter here would
-- offer something the rest of the system cannot honour.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_pick(
  p_group_id uuid,
  p_user_id  uuid,
  p_week     int,
  p_team_id  text,
  p_entry_no int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin       uuid := auth.uid();
  v_season      int;
  v_first_kick  timestamptz;
  v_live_week   int;
  v_game_id     text;
  v_existing    public.picks;
  v_has_row     boolean;
  v_prev_team   text;
  v_prev_result text;
begin
  -- remove_member's ladder, in remove_member's order.
  if v_admin is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  -- Shape before substance, submitPick's idiom: a hand-rolled POST naming entry
  -- 7 or week 1e9 must not reach a CHECK constraint nobody has copy for.
  if p_entry_no is null or p_entry_no not in (1, 2) then
    raise exception 'bad_entry' using errcode = 'P0001';
  end if;

  if p_week is null or p_week < 1 then
    raise exception 'bad_week' using errcode = 'P0001';
  end if;

  select season into v_season from public.groups where id = p_group_id;

  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;

  -- Scoped to entry_no, for remove_member's reason: two entries are two
  -- independent runs at the season, and (group, user) alone names neither.
  if not exists (
    select 1 from public.group_members
     where group_id = p_group_id
       and user_id  = p_user_id
       and entry_no = p_entry_no
  ) then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  -- THE WINDOW, and it is derived here rather than taken from the client.
  --
  -- "Has started" is the WEEK's earliest kickoff, which is the same fact
  -- resolveWeekFromKickoffs() derives in TS — so the tab's week list and this
  -- gate cannot disagree. Deliberately NOT the individual game's kickoff: an
  -- admin fixing a Sunday-1pm result on Sunday afternoon must be able to write a
  -- row whose NEW team plays at 4pm, and that is the ordinary case rather than
  -- an edge one.
  --
  -- `season_type = 'regular'` and an explicit week, for 0012's reason: a
  -- whole-season minimum is the Hall of Fame game in early August.
  select min(kickoff) into v_first_kick
    from public.games
   where season      = v_season
     and season_type = 'regular'
     and week        = p_week;

  if v_first_kick is null then
    raise exception 'week_not_scheduled' using errcode = 'P0002';
  end if;

  -- 55000, the code entry_closed and preseason_closed already use for "the
  -- window for this is shut".
  if v_first_kick > now() then
    raise exception 'week_not_started' using errcode = '55000';
  end if;

  -- Resolve the game FROM THE TEAM.
  --
  -- This is what makes 0014's and 0017's consistency conjuncts true by
  -- construction: week, season_type, season and team all come off the one row
  -- selected here, and a definer bypasses the policies that would otherwise have
  -- checked them. The client never sends a game_id and cannot.
  if p_team_id is not null then
    select g.id into v_game_id
      from public.games g
     where g.season      = v_season
       and g.season_type = 'regular'
       and g.week        = p_week
       and p_team_id in (g.home, g.away);

    if not found then
      -- Bye week, unknown team id, or a schedule that isn't loaded. canPick's
      -- own code, so the drawer and the pick screen say the same thing.
      raise exception 'no_game_for_team' using errcode = 'P0002';
    end if;
  end if;

  select * into v_existing
    from public.picks
   where group_id    = p_group_id
     and user_id     = p_user_id
     and entry_no    = p_entry_no
     and season_type = 'regular'
     and week        = p_week;

  -- CAPTURED here, not read from FOUND further down. FOUND is reset by the next
  -- SELECT INTO / INSERT / UPDATE / DELETE, and this body has several between
  -- here and the branch that needs it — so reading it there would be correct
  -- today and silently wrong the day somebody inserts a statement between.
  v_has_row     := found;
  v_prev_team   := v_existing.team_id;
  v_prev_result := v_existing.result;

  if p_team_id is null then
    -- IDEMPOTENT. Clearing a week that holds no pick is a no-op, not an error:
    -- close_own_account's posture, so a double-click or a retry after a dropped
    -- response does not raise. Nothing changed, so nothing is audited either.
    if v_has_row then
      delete from public.picks where id = v_existing.id;
    end if;
  else
    -- picks_team_once_per_phase, pre-checked so the refusal has a NAME rather
    -- than arriving as a bare 23505.
    --
    -- REFUSED, never released. submitPick's delete-then-upsert release is safe
    -- because it only ever frees the CALLER's OWN, UN-KICKED-OFF row. Neither
    -- half holds here: a conflicting row in a started week has already been
    -- SCORED, so freeing it makes that week a no_pick, which recomputeSeason
    -- counts as a loss and may eliminate the member outright — in a week the
    -- admin was not even looking at. A conflicting row in a future week is a
    -- plan RLS hides from the admin and that they did not intend to touch. Both
    -- are silent; neither is this verb's to make.
    if exists (
      select 1 from public.picks
       where group_id    = p_group_id
         and user_id     = p_user_id
         and entry_no    = p_entry_no
         and season_type = 'regular'
         and team_id     = p_team_id
         and week       <> p_week
    ) then
      raise exception 'team_already_used' using errcode = 'P0001';
    end if;

    if v_has_row then
      update public.picks
         set team_id    = p_team_id,
             game_id    = v_game_id,
             -- BOTH, every time. Leaving the old team's result behind would have
             -- the board printing last week's loss against this week's new team
             -- until the scorer next runs; locked_at has zero readers in src/ and
             -- netlify/, but a stale one is still a lie. recomputeSeason
             -- overwrites both from scratch on its next fold — it is idempotent
             -- and refolds weeks 1..throughWeek every run — so 'pending'/null is
             -- the honest interim. Re-deriving evaluateWeek in SQL here would be
             -- a second scoring engine beside the one score.ts exists to keep
             -- singular.
             result     = 'pending',
             locked_at  = null,
             updated_at = now()
       where id = v_existing.id;
    else
      insert into public.picks
        (group_id, user_id, entry_no, season_type, week,
         team_id, game_id, result, locked_at, updated_at)
      values
        (p_group_id, p_user_id, p_entry_no, 'regular', p_week,
         p_team_id, v_game_id, 'pending', null, now());
    end if;
  end if;

  -- A no-op clear changed nothing, so it leaves no trail.
  if v_has_row or p_team_id is not null then
    insert into public.pick_overrides
      (group_id, user_id, entry_no, season, season_type, week,
       from_team, from_result, to_team, admin_id)
    values
      (p_group_id, p_user_id, p_entry_no, v_season, 'regular', p_week,
       v_prev_team, v_prev_result, p_team_id, v_admin);
  end if;

  -- The greatest regular week whose FIRST kickoff has passed — the number
  -- resolveWeekFromKickoffs() derives in TS, computed here off the database's
  -- clock. `greatest(p_week, …)` because an admin may be repairing a week the
  -- scorer would otherwise no longer fold.
  select coalesce(max(w.week), p_week) into v_live_week
    from (select week, min(kickoff) as first_kick
            from public.games
           where season = v_season and season_type = 'regular'
           group by week) w
   where w.first_kick <= now();

  return jsonb_build_object(
    'season',         v_season,
    'week',           p_week,
    'throughWeek',    greatest(p_week, v_live_week),
    'previousTeamId', v_prev_team,
    'teamId',         p_team_id,
    'cleared',        p_team_id is null
  );
exception
  when unique_violation then
    -- Matched by CONDITION NAME (23505), never by constraint text: 0006's rename
    -- silently broke submitPick's /team_id/ message match, and 0017 re-keyed both
    -- of these constraints again. Two can raise it here — picks_team_once_per_phase
    -- (already excluded above, so what reaches this is a race) and
    -- picks_one_per_week (a concurrent write of the same week). actions.ts makes
    -- the same call: from where the admin is sitting both are honestly described
    -- by "that team is already used", and neither is worth a code the drawer has
    -- no copy for.
    raise exception 'team_already_used' using errcode = 'P0001';
end;
$$;

-- Replay these WITH the body. A function pasted without its grants fails with
-- 42501, which rpcErrorCode (src/app/app/actions.ts) reports as
-- migration_missing — indistinguishable from the function not existing at all.
revoke all on function public.admin_set_pick(uuid, uuid, int, text, int) from public;
grant execute on function public.admin_set_pick(uuid, uuid, int, text, int) to authenticated;
