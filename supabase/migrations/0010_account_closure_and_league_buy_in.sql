-- Last Man Standing — account closure, and a per-league buy-in amount.
--
-- Three unrelated-looking pieces that the redesigned account page needs
-- together: the buy-in card has to know how much is owed and when the admin
-- last touched the flag, and the Danger Zone has to be able to close an account
-- without erasing the player from the standings board.
--
-- Apply with:  supabase db push   (or paste into the SQL editor). Idempotent —
-- every statement is `if not exists` / `create or replace`, and the one insert
-- path is `on conflict do nothing`. Unlike 0004 this file may be replayed.
--
-- No pgcrypto anywhere. Every function below is `security definer set
-- search_path = public`, and an unqualified extension call inside such a body
-- raises 42883 at runtime on Supabase (see CLAUDE.md). Nothing here needs one.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. groups: what the buy-in actually costs
--
-- 0007 tracked only WHETHER a member had paid, never HOW MUCH, so the figure
-- lived in a TypeScript constant (`BUY_IN_LABEL`) — per-league data rendered as
-- a global, correct only while the product runs one league. These two columns
-- are that constant's replacement, and `set_group_buy_in` below is the write
-- path.
--
-- Cents, not dollars: an integer column cannot drift the way a float does, and
-- the app formats at the edge. The defaults are the inaugural league's stake, so
-- an existing row needs no backfill.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. account_closures — "I'm done, close my account"
--
-- A separate table rather than a `profiles.deleted_at` column, and the reason is
-- the one 0009 gives for `public_league`: 0001's "profiles update own" policy
-- lets a user UPDATE their own row, and RLS cannot restrict WHICH COLUMNS an
-- update writes. A `deleted_at` column would therefore be clearable by the very
-- account it locks out, straight from the browser with the anon key. A table
-- with RLS on and no INSERT/UPDATE/DELETE policies at all can only be written by
-- a security-definer function, which is exactly the asymmetry this needs.
--
-- Closing is deliberately NOT a delete. The player's profile, membership, picks
-- and strikes all survive, because their line on the standings board is part of
-- the league's record for the season — see `close_own_account` below. Removing
-- someone from the board for good is an admin action and does not exist yet.
--
-- To reopen an account until that admin control ships:
--   delete from public.account_closures where id = '<user-uuid>';
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.account_closures (
  id        uuid primary key references public.profiles (id) on delete cascade,
  closed_at timestamptz not null default now()
);

alter table public.account_closures enable row level security;

-- The owner (so the app can lock them out) plus admins of any league they are in
-- (so the follow-up admin screen can see who has left). is_admin_for_member is
-- 0008's helper — security definer, so it doesn't recurse through
-- group_members' own policy.
drop policy if exists "account closure read" on public.account_closures;
create policy "account closure read" on public.account_closures
  for select to authenticated
  using (id = auth.uid() or public.is_admin_for_member(id));

-- Deliberately no insert / update / delete policies. See the header above: the
-- absence is the enforcement, not an oversight.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. close_own_account — the only write path into the table
--
-- Owner-only by construction: it writes auth.uid() and takes no argument, so
-- there is no id for a caller to substitute. Idempotent, so a double-submit or a
-- retry after a dropped response is a no-op rather than an error.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. set_group_buy_in — the admin write path for the amount
--
-- `groups` DOES have an admin UPDATE policy (0001, "groups update by admin
-- (unlocked)"), so this could have been a plain .update() from the client. It is
-- an RPC for the same reason set_member_buy_in is: that policy cannot restrict
-- which columns an admin writes, so shipping the first client-side groups update
-- would hand the browser invite_code, entry_closes_at, elimination_type and
-- tie_rule as well. This function writes two columns and nothing else.
--
-- Deliberately NOT gated on settings_locked_at, which that policy checks.
-- Locking exists to freeze the rules once entry closes; correcting what the pot
-- costs is money admin, not a rules change, and getting it wrong after kickoff
-- is exactly when you most need to fix it.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. set_member_buy_in — stamp the timestamp in BOTH directions
--
-- 0007 wrote `buy_in_paid_at = case when p_paid then now() else null end`, which
-- is right for a column read as "when did they pay" and wrong for the one the
-- account page now renders: "UNPAID · Updated 10/21". Nulling the column on the
-- unpaid branch means the one state that most needs a date is the one state that
-- can never have one.
--
-- 0007 is not edited — it has run against real databases (CLAUDE.md: never
-- rewrite an applied migration). This replaces the function body only; the
-- signature, grants and error codes are unchanged, and rows that were last
-- toggled before this ran keep whatever they have. The UI omits the "Updated"
-- text when the column is null, so the pre-existing nulls degrade quietly.
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
