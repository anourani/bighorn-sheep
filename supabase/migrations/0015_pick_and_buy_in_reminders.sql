-- Last Man Standing — reminder emails for missing picks and unpaid buy-ins.
--
-- Everything the admin drawer's Emails tab needs: a log of what has been sent
-- (which is also the thing that stops anyone being emailed twice), one
-- definition of who is due, two projections of it, and a place for a member to
-- opt out.
--
-- Apply with:  supabase db push   (or paste into the SQL editor). Replayable —
-- every statement is `if not exists` / `create or replace`, and there is no
-- backfill at all, so this file is also deterministic, which 0011 is not.
--
-- Verified against a real PostgreSQL 16 by applying 0001..0015 in order onto an
-- empty database and then replaying this file: grants land as
-- reminder_due/record_reminder_send -> service_role only,
-- reminder_status_for_admin -> authenticated; reminder_sends is rls=true with
-- zero policies; `set role authenticated` is refused EXECUTE on reminder_due and
-- SELECT on reminder_sends; a non-admin member raises not_admin and a signed-out
-- caller not_authenticated; an eliminated member is absent from the pick list and
-- present in the buy-in list; an opted-out member and a closed account are absent
-- from both; a repeated pick send is a silent no-op while a failed one still
-- retries; and a buy-in send suppresses for p_min_interval and then returns.
--
-- No pgcrypto anywhere. Every function below is `security definer set
-- search_path = public`, and an unqualified extension call inside such a body
-- raises 42883 at runtime on Supabase (see CLAUDE.md). Every call here is a
-- pg_catalog builtin: now, coalesce, left, lower, gen_random_uuid,
-- jsonb_build_object, jsonb_agg.
--
-- ── The one decision worth reading before the SQL ────────────────────────────
--
-- THE BROWSER NEVER RECEIVES AN EMAIL ADDRESS. §3 defines who is due once, and
-- §4 exposes that definition to an admin's browser with the email column
-- dropped. Only the service-role send path (§3, granted to service_role alone)
-- ever resolves an address.
--
-- 0008 already established that a league admin may read a co-member's private
-- contact detail, so an admin-gated function returning emails would be in
-- keeping. Three things decided it the other way:
--
--   * Nothing in this project has ever moved an email out of auth.users. The
--     one function that reads that table, account_exists (0004), TAKES an email
--     and returns a boolean; it never emits one. Making this the first to hand
--     addresses to a browser is a bigger step than it looks — the payload then
--     lives in the RSC stream, in the tab's memory, and in any future
--     console.error that lands in a Netlify function log.
--   * The UI does not need it. The admin's decision is send / don't send, and
--     names plus reasons are the whole basis for it.
--   * It would invite the next step: a server action taking a recipient LIST.
--     A server action is a reachable HTTP endpoint, and one that accepts
--     arbitrary recipients, sending league-branded mail from a verified domain,
--     is an open relay. Keeping addresses server-side means the action's only
--     inputs are a group, a kind, and a set of member ids that can narrow the
--     due set but never widen it.
--
-- The honest cost: a clipboard / mailto: fallback for admins is foreclosed
-- without a SECOND, separately-granted function. That should be a deliberate
-- decision later rather than something folded in here.
--
-- And the honest limit: what §4 guarantees is that it never returns the EMAIL
-- COLUMN. It cannot guarantee that no address is ever in the payload, because
-- it returns first_name — and 0004's handle_new_user can seed first_name with a
-- whole address for a user created outside the app (its
-- `split_part(..., ' ', 1)` splits on a SPACE, which an email has none of, so
-- the `split_part(new.email, '@', 1)` branch below it is unreachable). The app's
-- own signup always sends first_name/last_name in raw_user_meta_data, so this
-- does not fire for anyone who joined normally; a dashboard- or SQL-created user
-- is the case. That is 0004's bug and belongs in its own migration, not folded
-- in here — but do not read §4 as a stronger promise than it makes. Such a name
-- is already on the standings board and the roster anyway.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profile_private.reminder_opt_out — declared now, written by nothing yet
--
-- 0008's header names profile_private as the home for "notification
-- preferences", and this is one line in a migration that is being hand-applied
-- anyway; adding it later means a whole second hand-applied migration for one
-- column.
--
-- The obvious objection is settings_locked_at: a column declared in 0001 for a
-- job nothing has ever written, which CLAUDE.md flags as a trap because a lock
-- gated on it alone would never fire. THE FAILURE DIRECTIONS ARE OPPOSITE. An
-- unwritten settings_locked_at makes a guard silently never fire — a false
-- negative that leaves the rules editable in week 12. An unwritten
-- reminder_opt_out is false for everyone, so §3 behaves exactly as if the
-- column did not exist, and "nobody has opted out" is a true statement.
--
-- Nothing writes it yet. Until an opt-out control ships, the escape hatch is
--   insert into public.profile_private (id, reminder_opt_out) values ('<uuid>', true)
--     on conflict (id) do update set reminder_opt_out = true;
-- in the SQL editor — the same posture as reopening an account_closures row.
--
-- It is read only inside §3, so no .select() in the app ever names it. That
-- matters: PostgREST raises 42703 on an unknown column rather than returning
-- undefined, so a widened select against a database missing this migration
-- would fail the whole query rather than degrade.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profile_private
  add column if not exists reminder_opt_out boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. reminder_sends — the log, and the idempotence
--
-- APPEND-ONLY, where 0011's feed_status is a single upserted row. That contrast
-- is deliberate. feed_status is one row because a */5 cron would otherwise write
-- ~105k rows a year for a value only ever read as "the latest". Here the log IS
-- the feature — it is what dedupes a send and what prints "reminded 2 days ago"
-- beside a name — and a thirty-person league writes at most thirty rows a week.
--
-- run_id groups one click's rows, so the tab can say "sent 12, 4 minutes ago"
-- without a second table.
--
-- RLS on, and deliberately NO policies. The anon key ships in the browser
-- bundle, so a readable-by-authenticated policy would hand every player the
-- league's send history. Written by the service role through
-- record_reminder_send, read through reminder_status_for_admin — the same shape
-- as 0010's account_closures and 0011's feed_status, where the absence of
-- policies IS the enforcement.
--
-- Idempotence is a DATABASE property here, and that is the whole point.
-- src/lib/cron-auth.ts justifies leaving poll-scores ungated on the grounds
-- that it is idempotent; email is not idempotent unless something makes it so,
-- and a unique index is the only thing that survives a crashed job, a
-- double-click, and a future unauthenticated cron hit alike.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.reminder_sends (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null,
  group_id    uuid not null references public.groups (id)   on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('pick', 'buy_in')),
  season      integer not null,
  season_type text not null default 'regular' check (season_type in ('pre', 'regular', 'post')),
  -- Null for buy_in. A debt is not a weekly fact; see the index note below.
  week        integer,
  status      text not null check (status in ('sent', 'failed')),
  provider_id text,
  error       text,
  sent_at     timestamptz not null default now()
);

alter table public.reminder_sends enable row level security;

-- Deliberately no select / insert / update / delete policies. See the header.

-- Two asymmetries here, and BOTH look like oversights, so read the reasons.
--
--   * `where status = 'sent'` — a failed attempt must not block its own retry.
--     Without it, one provider hiccup would permanently consume a member's slot
--     for that week and they would silently never be reminded.
--
--   * There is NO equivalent index for kind = 'buy_in', on purpose. Its week is
--     null, and Postgres treats nulls as distinct, so the same index would
--     dedupe precisely nothing while looking like it did. There is also no
--     natural period for a debt: nagging in week 2 and again in week 6 is
--     legitimate, where nagging twice about week 6's pick is not. Buy-in
--     reminders are therefore THROTTLED by p_min_interval in §3 rather than
--     keyed. Pick reminders are keyed; buy-in reminders are throttled.
create unique index if not exists reminder_sends_pick_once
  on public.reminder_sends (group_id, user_id, season, season_type, week)
  where kind = 'pick' and status = 'sent';

create index if not exists reminder_sends_lookup
  on public.reminder_sends (group_id, kind, sent_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. reminder_due — the one definition of who should be emailed
--
-- Returns the address, and is granted to service_role ONLY. §4 wraps it for the
-- browser with that column dropped. See the header for why.
--
-- Why this cannot be derived on the client, even for the admin's own display:
-- 0001's "picks read own or revealed" policy returns another member's pick only
-- once its game has kicked off. So on a Wednesday, a client-side "has this
-- member picked?" reports NO for the entire league — every one of whom has
-- picked. The check has to run somewhere that sees the real rows, which is
-- here.
--
-- Two per-kind rules that are easy to get backwards:
--
--   * pick requires gm.status = 'alive'. Emailing an eliminated player to
--     remind them to pick is the cruellest bug this feature could have.
--   * buy_in deliberately does NOT filter on status. A player who went out in
--     week 3 still owes the pot.
--
-- p_week is ignored for buy_in and required for pick; the caller derives it (it
-- is NOT the app's "current week" — see src/lib/league/reminders.ts).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reminder_due(
  p_group_id     uuid,
  p_kind         text,
  p_season       integer,
  p_season_type  text default 'regular',
  p_week         integer default null,
  p_min_interval interval default interval '3 days'
)
returns table (
  user_id      uuid,
  first_name   text,
  last_name    text,
  email        text,
  last_sent_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select gm.user_id,
         p.first_name,
         p.last_name,
         u.email::text,
         ls.last_sent_at
    from public.group_members gm
    join public.profiles p on p.id = gm.user_id
    join auth.users     u on u.id = gm.user_id
    left join public.profile_private pp on pp.id = gm.user_id
    left join lateral (
      select max(rs.sent_at) as last_sent_at
        from public.reminder_sends rs
       where rs.group_id = gm.group_id
         and rs.user_id  = gm.user_id
         and rs.kind     = p_kind
         and rs.status   = 'sent'
    ) ls on true
   where gm.group_id = p_group_id
     and u.email is not null
     and not coalesce(pp.reminder_opt_out, false)
     -- A closed account keeps its line on the standings board but must not be
     -- emailed; close_own_account is the user asking to be left alone.
     and not exists (
       select 1 from public.account_closures ac where ac.id = gm.user_id
     )
     and (
       (p_kind = 'pick'
         and gm.status = 'alive'
         and p_week is not null
         and not exists (
           select 1 from public.picks pk
            where pk.group_id    = gm.group_id
              and pk.user_id     = gm.user_id
              and pk.season_type = p_season_type
              and pk.week        = p_week
         )
         -- Keyed, not throttled: the unique index is the real guarantee and
         -- this is the cheap pre-filter that keeps a doomed insert off the wire.
         and not exists (
           select 1 from public.reminder_sends rs
            where rs.group_id    = gm.group_id
              and rs.user_id     = gm.user_id
              and rs.kind        = 'pick'
              and rs.status      = 'sent'
              and rs.season      = p_season
              and rs.season_type = p_season_type
              and rs.week        = p_week
         ))
       or
       (p_kind = 'buy_in'
         and gm.buy_in_paid = false
         and (ls.last_sent_at is null or ls.last_sent_at < now() - p_min_interval))
     )
   order by p.first_name, p.last_name, gm.user_id;
$$;

revoke all on function public.reminder_due(uuid, text, integer, text, integer, interval) from public;
grant execute on function public.reminder_due(uuid, text, integer, text, integer, interval) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. reminder_status_for_admin — the browser's projection
--
-- security definer, so inside this body current_user is the function OWNER and
-- it may call reminder_due despite that function being granted to service_role
-- alone. One due-ness definition, two projections — and this one structurally
-- cannot leak an address, because it never names the column.
--
-- Takes a group id to prove the caller administers THAT league, and returns
-- only that league's rows, so unlike public_league_snapshot there is no risk of
-- the argument turning it into a universal reader.
--
-- Returns jsonb (the public_league_snapshot / feed_status_for_admin precedent)
-- so `now` travels with the payload. Every "reminded 2 hours ago" the drawer
-- prints is one subtraction against THIS clock; sourcing the two ends from
-- different machines is how such a string goes negative.
--
-- first_name / last_name go out raw, never a formatted name.
-- formatDisplayName (src/lib/league/name.ts) is the one place a name is
-- composed in this project, and a second rule written in SQL would drift from
-- it silently.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reminder_status_for_admin(
  p_group_id    uuid,
  p_season      integer,
  p_season_type text default 'regular',
  p_week        integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pick_rows   jsonb;
  buyin_rows  jsonb;
  last_pick   timestamptz;
  last_buy_in timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  -- Note the absent `email` in both projections. That omission is the privacy
  -- boundary described in the header; do not add it "for convenience".
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId',     d.user_id,
           'firstName',  d.first_name,
           'lastName',   d.last_name,
           'lastSentAt', d.last_sent_at
         )), '[]'::jsonb)
    into pick_rows
    from public.reminder_due(p_group_id, 'pick', p_season, p_season_type, p_week) d;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId',     d.user_id,
           'firstName',  d.first_name,
           'lastName',   d.last_name,
           'lastSentAt', d.last_sent_at
         )), '[]'::jsonb)
    into buyin_rows
    from public.reminder_due(p_group_id, 'buy_in', p_season, p_season_type, null) d;

  -- When the last run of each kind happened, for the manual cooldown. Read off
  -- the log rather than off the due list: someone reminded an hour ago has
  -- since dropped OFF the due list precisely because they were reminded, so a
  -- cooldown derived from the due rows would reset itself.
  select max(sent_at) into last_pick
    from public.reminder_sends
   where group_id = p_group_id and kind = 'pick' and status = 'sent';

  select max(sent_at) into last_buy_in
    from public.reminder_sends
   where group_id = p_group_id and kind = 'buy_in' and status = 'sent';

  return jsonb_build_object(
    'now',        now(),
    'season',     p_season,
    'seasonType', p_season_type,
    'week',       p_week,
    'pick',       jsonb_build_object('due', pick_rows,  'lastSentAt', last_pick),
    'buyIn',      jsonb_build_object('due', buyin_rows, 'lastSentAt', last_buy_in)
  );
end;
$$;

revoke all on function public.reminder_status_for_admin(uuid, integer, text, integer) from public;
grant execute on function public.reminder_status_for_admin(uuid, integer, text, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. record_reminder_send — the write path
--
-- A function rather than a bare .insert() from the service role (which would
-- work, RLS being bypassed) for the same reason record_feed_sync is one:
-- sent_at becomes POSTGRES's clock rather than a Netlify container's, and §4
-- returns now() from the same database for the UI to subtract.
--
-- `on conflict do nothing` against the partial unique index, so a retry after a
-- crash between the provider's 2xx and this write is a no-op rather than an
-- error. The job treats a no-op as success — the member has been emailed, which
-- is the fact the index encodes.
--
-- Granted to service_role only. `authenticated` must never reach this.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_reminder_send(
  p_run_id      uuid,
  p_group_id    uuid,
  p_user_id     uuid,
  p_kind        text,
  p_season      integer,
  p_season_type text default 'regular',
  p_week        integer default null,
  p_status      text default 'sent',
  p_provider_id text default null,
  p_error       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'bad_status' using errcode = '22023';
  end if;

  if p_kind not in ('pick', 'buy_in') then
    raise exception 'bad_kind' using errcode = '22023';
  end if;

  insert into public.reminder_sends (
    run_id, group_id, user_id, kind, season, season_type, week,
    status, provider_id, error
  )
  values (
    p_run_id, p_group_id, p_user_id, p_kind, p_season,
    coalesce(p_season_type, 'regular'), p_week,
    p_status, p_provider_id,
    -- Capped: a provider stack trace must not become an unbounded column.
    left(p_error, 500)
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.record_reminder_send(uuid, uuid, uuid, text, integer, text, integer, text, text, text) from public;
grant execute on function public.record_reminder_send(uuid, uuid, uuid, text, integer, text, integer, text, text, text) to service_role;
