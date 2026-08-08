-- Last Man Standing — make invite-code generation work on Supabase.
--
-- `create_group` has never succeeded on a real Supabase project. Its invite-code
-- line called `gen_random_bytes(5)`, which lives in the **pgcrypto** extension:
--
--   ERROR: 42883: function gen_random_bytes(integer) does not exist
--   QUERY: code := upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8))
--   CONTEXT: PL/pgSQL function create_group(...) line 25 at assignment
--
-- 0001 does `create extension if not exists "pgcrypto"`, so the extension is
-- present — but Supabase installs extensions into the `extensions` schema, and
-- the function is declared `set search_path = public`. Inside the body, an
-- unqualified `gen_random_bytes` is resolved at runtime against that search
-- path, which does not include `extensions`. So it is invisible.
--
-- (The `gen_random_uuid()` column defaults were never affected: a column default
-- resolves its function once, at DDL time, and stores the OID. Only unqualified
-- calls inside a function body are re-resolved at call time. That is why the
-- schema looked healthy while this one code path was dead.)
--
-- The fix removes the dependency rather than widening the search path: since
-- PostgreSQL 13, `gen_random_uuid()` is in `pg_catalog`, which is always on the
-- search path and cannot be shadowed. It is also cryptographically random, so
-- invite codes keep their unguessability. Same 8-uppercase-hex-character format
-- as before, so existing codes stay valid and nothing else needs to change.
--
-- Apply with:  supabase db push   (or paste into the SQL editor). Idempotent.

create or replace function public.create_group(
  p_name             text,
  p_elimination_type text        default 'single',
  p_tie_rule         text        default 'push',
  p_season           int         default null,
  p_entry_closes_at  timestamptz default null
)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid        := auth.uid();
  g        public.groups;
  code     text;
  v_season int         := coalesce(p_season, extract(year from now())::int);
  v_entry  timestamptz := coalesce(p_entry_closes_at, now() + interval '7 days');
  attempts int         := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if length(coalesce(trim(p_name), '')) = 0 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if p_elimination_type not in ('single', 'two_time') then
    raise exception 'bad_elimination_type' using errcode = 'P0001';
  end if;
  if p_tie_rule not in ('push', 'loss') then
    raise exception 'bad_tie_rule' using errcode = 'P0001';
  end if;

  -- A short, human-friendly invite code. Retry on the (rare) collision.
  -- gen_random_uuid() is pg_catalog (core since PG13) and cryptographically
  -- random — deliberately NOT pgcrypto's gen_random_bytes, which this function's
  -- search_path cannot reach on Supabase.
  loop
    attempts := attempts + 1;
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.groups where invite_code = code);
    if attempts > 10 then
      raise exception 'invite_code_generation_failed';
    end if;
  end loop;

  insert into public.groups
    (name, season, elimination_type, tie_rule, invite_code, entry_closes_at, created_by)
  values
    (trim(p_name), v_season, p_elimination_type, p_tie_rule, code, v_entry, uid)
  returning * into g;

  insert into public.group_members (group_id, user_id, role, status)
  values (g.id, uid, 'admin', 'alive');

  return g;
end;
$$;

revoke all on function public.create_group(text, text, text, int, timestamptz) from public;
grant execute on function public.create_group(text, text, text, int, timestamptz) to authenticated;
