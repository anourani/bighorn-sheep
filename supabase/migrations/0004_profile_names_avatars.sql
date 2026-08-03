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
--
-- Apply with:  supabase db push   (or paste into the SQL editor)

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
