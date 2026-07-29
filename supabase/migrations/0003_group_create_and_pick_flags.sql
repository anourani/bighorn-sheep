-- Last Man Standing — group creation + current-pick presence flag.
--
-- Two SECURITY DEFINER functions the wired-up app needs:
--
--   create_group(...)          — authenticated. Atomically creates a league and
--                                enrolls the caller as its admin, generating a
--                                unique invite code. One round-trip, no orphan
--                                group if the membership insert were to fail.
--
--   hidden_pick_user_ids(g, w) — authenticated, members only. Returns just the
--                                user_ids in a group who have locked a pick for
--                                week `w` whose game HASN'T kicked off yet. This
--                                is the sanctioned, minimal leak behind the
--                                Standings padlock: it reveals THAT a rival has
--                                picked (so the UI shows a lock, not an empty
--                                slot) without revealing WHICH team. The team
--                                itself stays hidden by the picks RLS in 0001.
--
-- Apply with:  supabase db push   (or paste into the SQL editor)

-- ─────────────────────────────────────────────────────────────────────────────
-- create_group — create a league + the creator's admin membership, atomically.
-- ─────────────────────────────────────────────────────────────────────────────
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
  loop
    attempts := attempts + 1;
    code := upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));
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

-- ─────────────────────────────────────────────────────────────────────────────
-- hidden_pick_user_ids — who has a locked-but-not-yet-revealed pick this week.
-- Members only; returns user_ids only (never the team). Powers the padlock.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.hidden_pick_user_ids(p_group_id uuid, p_week int)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id
  from public.picks p
  join public.games g on g.id = p.game_id
  where p.group_id = p_group_id
    and p.week = p_week
    and public.is_group_member(p_group_id)   -- caller must belong to the group
    and g.kickoff > now()
    and g.status = 'scheduled';
$$;

revoke all on function public.hidden_pick_user_ids(uuid, int) from public;
grant execute on function public.hidden_pick_user_ids(uuid, int) to authenticated;
