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
