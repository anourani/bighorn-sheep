-- Last Man Standing — an eliminated entry keeps picking, and nobody else sees it.
--
-- A knocked-out player used to get a locked grid and "You're eliminated, so
-- picks are closed." They may now carry on picking week to week, for their own
-- sake, on their own picks page — and THIS migration is what makes that safe to
-- allow. Without it, the app code change alone would be a privacy hole:
--
--   * 0001's "picks read own or revealed" hands ANY member's pick to the whole
--     league once its game has kicked off, with no test of who was still alive
--     when it was made. An eliminated entry's Week 10 pick would reach every
--     living member's browser on Sunday at 1pm, and only a render-time blank
--     in the standings grid (`cellFor`) kept it off the board. The rows were in
--     the payload.
--   * 0017's hidden_pick_member_ids would light a standings padlock for it in
--     the live week — "has picked" is itself a fact about a dead entry the
--     league is not supposed to have.
--   * 0009/0017's public_league_snapshot — the ANONYMOUS landing-page RPC —
--     emitted those picks too, and the anon key ships in the JS bundle, so a
--     TypeScript filter in the server component would have been theatre (the
--     argument 0009 made for putting the kickoff lock in SQL, made again).
--
-- The rule, stated once: a regular-season pick for a week STRICTLY AFTER the
-- entry's eliminated_week is that entry's own, readable by its owner and by
-- nobody else. The elimination week itself is not "after" — the losing pick is
-- the record of how the entry went out, and stays on the board.
-- `eliminated_week is null` hides nothing, matching the client's guard exactly:
-- a row marked eliminated with no week recorded draws its history rather than
-- blanking the season. Preseason is never affected — nothing eliminates there
-- (0006) — so the helper answers false for any season_type but 'regular'.
--
-- ONE definition, `entry_out_before_week`, called from all three places above,
-- so they cannot drift. `src/lib/league/post-elimination.ts` is the TypeScript
-- copy of the same predicate for every consumer that folds picks after reading
-- them, and its test reads this file to keep the two spellings aligned.
--
-- NOT changed, deliberately:
--
--   * The picks INSERT/UPDATE/DELETE policies. They have never tested member
--     status (0014 said so in as many words: "a pick written after elimination
--     confers no advantage, because recomputeSeason re-derives status"), and
--     that is still true — `computeStatus` stops folding at the elimination
--     week, so nothing an eliminated entry picks afterwards can change its
--     strikes, its status or anyone's standings. The scorer still writes
--     picks.result for those rows; only their owner can read it back.
--   * admin_set_pick. The refusal for a post-elimination week lives in the
--     app (`setPickForMember` returns member_eliminated, and the drawer draws
--     the row as "Out" with a disabled control). After this migration an admin
--     cannot READ such a pick anyway, so the 0019 body — long, and hand-applied
--     — is not re-pasted for a check the action already makes.
--   * reminder_due (0015/0017). It already requires gm.status = 'alive' for a
--     pick reminder, so an eliminated player is not nagged about a game they
--     are playing for fun. That stays.
--
-- Apply with:  supabase db push   (or paste into the SQL editor).
--
-- REPLAYABLE. `drop policy if exists` + `create policy`, and `create or
-- replace function` plus its grants. No table, no column, no backfill — so
-- there is nothing to fence except the 0017 dependency below.
--
-- No pgcrypto. Every function here is `security definer set search_path =
-- public`, and an unqualified extension call inside such a body raises 42883 at
-- runtime on Supabase (see CLAUDE.md). Everything called below — coalesce,
-- now, to_char, jsonb_build_object, jsonb_agg — is a pg_catalog builtin.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Refuse to install onto a pre-0017 database.
--
-- Everything below names `picks.entry_no` and `group_members.entry_no`. A
-- policy IS parsed for column existence at CREATE time, so the policy would
-- fail loudly on its own — but a `language sql` function body is parsed too,
-- while a caller of the helper inside a plpgsql body would not be, and the
-- next migration to add one would inherit the silent failure 0019 §0 describes.
-- Raising here, first, puts the reason in front of whoever is in the SQL
-- editor. 0012's asymmetry: an error is recoverable, a wrong answer is not.
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
      '0020 requires 0017_two_entries: public.picks.entry_no is missing. Apply 0017 first.';
  end if;
end
$fence$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. entry_out_before_week — THE predicate.
--
-- True iff the (group, user, entry) row is eliminated, its eliminated_week is
-- recorded, and p_week is strictly after it — for the regular season only.
--
-- `security definer` for two reasons. The SELECT policy on picks calls it, and
-- a policy's subquery runs as the caller, so a plain function would read
-- group_members under THAT table's RLS ("members read same group" — fine for
-- a member, but a dependency the policy should not carry). And it keeps the
-- policy's text to one line, which is what makes the three call sites
-- reviewable side by side. `stable`, so the planner may cache it per row
-- within a statement.
--
-- Granted to `authenticated` only. public_league_snapshot is itself
-- `security definer`, so it calls this as the owner and anon needs no grant —
-- and anon should not have one: called directly it would confirm, per
-- (group, user, entry, week), whether somebody is out, which is the landing
-- page's business to summarise and nobody else's to probe.
--
-- (group_id, user_id, entry_no) is group_members_entry_key (0017), so the
-- lookup is one index probe and resolves to at most one row.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.entry_out_before_week(
  p_group_id    uuid,
  p_user_id     uuid,
  p_entry_no    smallint,
  p_season_type text,
  p_week        int
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_season_type = 'regular'
     and exists (
       select 1
         from public.group_members gm
        where gm.group_id  = p_group_id
          and gm.user_id   = p_user_id
          and gm.entry_no  = p_entry_no
          and gm.status    = 'eliminated'
          and gm.eliminated_week is not null
          and p_week > gm.eliminated_week
     );
$$;

revoke all on function public.entry_out_before_week(uuid, uuid, smallint, text, int) from public;
grant execute on function public.entry_out_before_week(uuid, uuid, smallint, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. "picks read own or revealed" — the revealed branch now also requires the
--    picker to have still been in the league for that week.
--
-- The own-row branch (`user_id = auth.uid()`) is UNCHANGED: you always read
-- your own picks, which is what draws them on your picks page. Only the
-- "another member's, once kicked off" branch gains the conjunct.
--
-- `drop policy if exists` + `create policy` because Postgres has no
-- `create or replace policy`; the pair is idempotent. The other three picks
-- policies (0017's insert/update, 0001's delete) are not touched.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "picks read own or revealed" on public.picks;
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
      and not public.entry_out_before_week(
        picks.group_id, picks.user_id, picks.entry_no, picks.season_type, picks.week
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. hidden_pick_member_ids — no padlock for a dead entry's later week.
--
-- 0017's body verbatim plus the one conjunct. Same signature, so
-- `create or replace` and supabase.rpc() are unaffected; the grants are
-- replayed with the body, as every migration here does (a body pasted without
-- them fails 42501, which rpcErrorCode reports as migration_missing).
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
    and g.status = 'scheduled'
    and not public.entry_out_before_week(
      gm.group_id, gm.user_id, gm.entry_no, p.season_type, p.week
    );
$$;

revoke all on function public.hidden_pick_member_ids(uuid, text, int) from public;
grant execute on function public.hidden_pick_member_ids(uuid, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. public_league_snapshot — the anonymous board drops them too.
--
-- 0017 §8's body verbatim, with the conjunct in BOTH the `visible` and the
-- `hidden` CTEs: a dead entry's later pick must neither be emitted nor
-- padlocked. Everything else — the name abbreviation, the "no user id in the
-- payload" rule, the game list — is exactly as 0017 left it. Return type is
-- still jsonb, so `create or replace`.
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
      and not public.entry_out_before_week(
        pk.group_id, pk.user_id, pk.entry_no, pk.season_type, pk.week
      )
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
      and not public.entry_out_before_week(
        pk.group_id, pk.user_id, pk.entry_no, pk.season_type, pk.week
      )
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
