-- Last Man Standing — move the phone number behind real access control.
--
-- 0007 put `phone` on `profiles`, whose read policy (0001) is `using (true)` for
-- any authenticated user: appropriate for names and avatars, which the roster
-- shows to co-members anyway, but not for the first genuinely private field on
-- the table. Because the browser talks straight to PostgREST with the public
-- anon key, RLS is the only gate — the UI rendering only your own account page
-- restricts nothing.
--
-- The fix is a separate `profile_private` table rather than a tighter policy on
-- `profiles`. A "me plus my co-members" policy there would have to subquery
-- group_members, whose own policy subqueries group_members — the classic route
-- to `infinite recursion detected in policy`. A new table leaves every existing
-- policy untouched (roster, standings and header provably unaffected) and
-- confines the new rule to one small surface. It is also the natural home for
-- future private fields (notification preferences).
--
-- Visibility: the owner, plus admins of any league the owner belongs to — the
-- commissioner-chasing-the-buy-in case. Writes stay owner-only: an admin can see
-- a number, never change one. The service role bypasses RLS as always, so a
-- future SMS notification job can still read numbers.
--
-- Replayable, unlike 0004: the backfill is guarded on `profiles.phone` still
-- existing, so a second run is a no-op instead of an error.
--
-- Apply with:  supabase db push   (or paste into the SQL editor).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profile_private (
  id    uuid primary key references public.profiles (id) on delete cascade,
  phone text
);

alter table public.profile_private enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. is_admin_for_member — am I an admin of any league this member belongs to?
--
-- SECURITY DEFINER so the body bypasses RLS. A plain subquery inside the policy
-- would itself be filtered by group_members' "members read same group" policy —
-- it happens to see enough rows to work today, but the correctness would hinge
-- on that policy's exact shape forever. The definer form is self-contained and
-- mirrors is_group_member / is_group_admin from 0001.
--
-- No pgcrypto: an unqualified extension call inside a `set search_path = public`
-- body raises 42883 at runtime on Supabase. Nothing here needs one.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Policies
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill from profiles.phone, then drop it.
--
-- Guarded on the column still existing so this file re-runs cleanly — 0004's
-- unguarded backfill-then-drop is why that migration can never run twice.
-- ─────────────────────────────────────────────────────────────────────────────
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
