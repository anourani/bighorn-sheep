-- Last Man Standing — an admin can remove a member, while entry is still open.
--
-- The undo that joining never had. Any member can hand out the invite code — it
-- is printed on Standings for the whole league — so a wrong join has always been
-- possible, and until now correcting one meant a hand-written DELETE in the SQL
-- editor. This is that DELETE, with the guards it needs to be safe from a button.
--
-- Apply with:  supabase db push   (or paste into the SQL editor). Replayable —
-- one `create or replace`, no DDL, no backfill.
--
-- No pgcrypto: `security definer set search_path = public`, and every call in
-- the body is a pg_catalog builtin (now, exists). See CLAUDE.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- remove_member — take a player out of a league, along with their picks.
--
-- Why a definer function rather than a policy: 0001 gives `group_members` no
-- DELETE policy at all, and adding one would have to say "an admin may delete
-- rows in their own group", which is also the rule for deleting the group's only
-- admin — RLS cannot express "any row except that one". The guards below can.
--
-- THE WINDOW IS ENTRY, NOT THE SEASON. Removal is refused once
-- `entry_closes_at` has passed, exactly as `set_member_preseason` (0011) is.
-- The symmetry is the argument: for as long as somebody can join, an admin can
-- un-join them, and the moment the season starts the roster stops being a signup
-- sheet and becomes part of the record — the same reason `close_own_account`
-- (0010) keeps a closed member's line on the standings board instead of deleting
-- it. A player who needs removing after kickoff is a SQL-editor job, deliberately.
--
-- PICKS ARE DELETED EXPLICITLY, and that is not belt-and-braces. `picks`
-- references `groups` and `profiles` (0001), never `group_members`, so dropping
-- a membership row leaves its picks behind with nothing pointing at them —
-- invisible, since every read is scoped by membership, but still holding
-- `unique (group_id, user_id, team_id)`. Someone removed and re-invited would
-- then find teams they had never picked already spent.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.remove_member(
  p_group_id uuid,
  p_user_id  uuid
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

  -- Before anything else: an admin removing themselves would be the one action
  -- here that cannot be undone from inside the app, since the control that
  -- reverses it is the one they just left behind.
  if p_user_id = auth.uid() then
    raise exception 'cannot_remove_self' using errcode = 'P0001';
  end if;

  select entry_closes_at into v_entry_closes_at
    from public.groups
   where id = p_group_id;

  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;

  if v_entry_closes_at <= now() then
    raise exception 'entry_closed' using errcode = '55000';
  end if;

  select role into v_role
    from public.group_members
   where group_id = p_group_id
     and user_id  = p_user_id;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  -- Players only. There is no demote control anywhere in the product, so an
  -- admin removed here could not be restored to admin from the app either — and
  -- a league whose admins have all been removed has no way back at all.
  if v_role = 'admin' then
    raise exception 'cannot_remove_admin' using errcode = 'P0001';
  end if;

  delete from public.picks
   where group_id = p_group_id
     and user_id  = p_user_id;

  delete from public.group_members
   where group_id = p_group_id
     and user_id  = p_user_id;
end;
$$;

-- The revoke is not decoration. Every migration here revokes first, because a
-- `create or replace` keeps the old ACL and a body pasted without its grant
-- fails with a bare 42501 — indistinguishable from "not an admin" at the call
-- site, which is why `rpcErrorCode` reads a bare 42501 as a missing migration.
revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
