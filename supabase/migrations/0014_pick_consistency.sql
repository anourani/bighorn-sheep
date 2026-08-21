-- Last Man Standing — tie a pick's own columns to the game it references.
--
-- 0001's pick INSERT/UPDATE policies check only that the referenced game has not
-- kicked off:
--
--   with check (
--     user_id = auth.uid()
--     and public.is_group_member(group_id)
--     and exists (select 1 from public.games g
--                 where g.id = picks.game_id
--                   and g.kickoff > now() and g.status = 'scheduled')
--   )
--
-- Nothing ties picks.week / picks.season_type / picks.team_id / the group's season
-- to that game. submitPick (src/app/app/actions.ts) derives all of these correctly,
-- but it is a convenience, not a gate: with the public anon key a member can POST
-- to /rest/v1/picks directly and write an internally INCONSISTENT row — e.g.
-- week = 1 pointing at a Week 10 game (which never resolves in time, so the Week 1
-- result stays pending and an elimination is dodged), or a team_id that isn't even
-- playing in the referenced game.
--
-- The fix adds the consistency invariants to each `with check`. These are pure
-- "the row agrees with its game" facts, cheap to evaluate (the games row is already
-- being looked up), and they make a direct write necessarily valid:
--
--   * g.week        = picks.week
--   * g.season_type = picks.season_type
--   * g.season      = the group's season
--   * picks.team_id in (g.home, g.away)   -- the picked team actually plays it
--
-- DELIBERATELY NOT added here (documented so it isn't "fixed" later by mistake):
--
--   * "member is alive" / entry-window checks. Already enforced by submitPick, and
--     re-derived by the scorer every run — recomputeSeason (src/lib/game/score.ts)
--     recomputes status from results regardless, so a pick written after
--     elimination confers no advantage. Putting an alive check in RLS would add a
--     group_members subquery to the hot Sunday-noon write path for no integrity gain.
--   * A submit_pick definer RPC. The pattern would match the rest of the app, but it
--     duplicates canPick/elimination.ts into SQL and adds a round-trip on the one
--     path that spikes at kickoff. The consistency predicates below close the only
--     variant with real impact at a fraction of the cost.
--
-- The DELETE policy is left untouched: the app never deletes picks (it overwrites
-- via upsert), and 0001's DELETE policy is already own-row + before-kickoff.
--
-- The drop/create window fails CLOSED (no policy = deny), so a pick write during the
-- migration is refused and retried, never wrongly admitted. No app code changes are
-- required — submitPick already writes consistent rows.
--
-- APPLY TO PRODUCTION BY HAND — merging this deploys the code, not the database.
-- Apply with:  supabase db push   (or paste into the SQL editor). Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT — own pick, member of the group, game not kicked off, AND the pick is
-- internally consistent with that game.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "picks insert own before kickoff" on public.picks;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE — the `using` clause still gates WHICH existing rows you may change (your
-- own, whose current game has not kicked off); the `with check` now also enforces
-- that the NEW values are consistent with the newly-referenced game.
-- ─────────────────────────────────────────────────────────────────────────────
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
