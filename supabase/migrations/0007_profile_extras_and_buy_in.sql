-- Last Man Standing — profile extras (phone, favorite animal) and per-league
-- buy-in tracking.
--
-- Buy-in lives on `group_members`, not `profiles`: a buy-in is owed to a league,
-- and a player in three leagues can be square with one and not the others.
--
-- `group_members` has no UPDATE policy at all (0001) — membership state is
-- written only by the service role, from netlify/functions/poll-scores.ts.
-- Marking a buy-in paid is the first legitimate admin write to another member's
-- row, so it goes through a SECURITY DEFINER RPC that checks is_group_admin()
-- itself. A `for update` policy would be the wrong tool: it cannot restrict
-- WHICH columns an admin writes, so it would hand the client role, status,
-- strikes and eliminated_week as well.
--
-- Reads need nothing new. The existing "members read same group" SELECT policy
-- already lets co-members see each other's rows, which is exactly the
-- purely-informative visibility this feature wants.
--
-- Apply with:  supabase db push   (or paste into the SQL editor). Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profiles: phone + favorite animal
--
-- favorite_animal is deliberately unconstrained text rather than a check
-- constraint or an enum. The allowed list is a shared TypeScript constant
-- (src/lib/profile/animals.ts) validated in the server action, so adding an
-- eleventh animal stays a code change instead of a migration against a live
-- database. Both columns are nullable — neither is required to play.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists favorite_animal text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. group_members: buy-in state
--
-- Defaults to false: every existing membership starts unpaid, and an admin marks
-- people off as the money arrives. buy_in_paid_at is an audit breadcrumb, not
-- something the UI reads today.
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
-- definer switch — the same thing join_by_invite (0002) relies on.
--
-- No pgcrypto: an unqualified extension call inside a `set search_path = public`
-- body raises 42883 at runtime on Supabase. Nothing here needs one.
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
