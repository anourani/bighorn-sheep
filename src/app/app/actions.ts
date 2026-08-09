"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canPick } from "@/lib/game/elimination";
import { resolveCurrentWeek, seasonPhase } from "@/lib/game/season";
import { rowToGame } from "@/lib/game/score";
import { FINAL_WEEK } from "@/lib/nfl/calendar";
import type { SeasonType } from "@/lib/nfl/types";
import { derivePractice, practiceUsedTeams } from "@/lib/league/practice";
import type { EliminationType, TieRule } from "@/lib/league/types";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * Run an action body, turning any unexpected throw into a result the caller can
 * render. Without this a raw throw escapes to the browser as an opaque
 * "client-side exception" with the real message redacted — notably
 * `createClient()`, which throws outright when the Supabase env vars are absent.
 * The detail still reaches the server log, which is where it's useful.
 *
 * Safe here because none of these actions call `redirect()` or `notFound()`,
 * whose control-flow errors must never be swallowed.
 */
async function attempt<T>(body: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (err) {
    console.error("[action] unexpected failure", err);
    return { ok: false, error: "unexpected_error" };
  }
}

/**
 * Set (or change) the viewer's pick for the current week. Every survival rule is
 * re-checked here server-side — never trusted to the greyed-out UI — and RLS +
 * the picks unique constraints are the final backstop.
 *
 * `seasonType` selects which of the two independent games this pick belongs to:
 * "regular" is the real league, "pre" is the practice round that resets at Week 1.
 * The week is still DERIVED here rather than accepted from the client — that is
 * what stops anyone submitting a pick for a future week — so `seasonType` is the
 * only new degree of freedom the caller gets.
 */
export async function submitPick(input: {
  groupId: string;
  teamId: string;
  seasonType?: SeasonType;
}): Promise<ActionResult> {
  return attempt(async () => {
    const seasonType: SeasonType = input.seasonType ?? "regular";
    if (seasonType !== "regular" && seasonType !== "pre") {
      return { ok: false, error: "bad_season_type" };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { data: group } = await supabase
      .from("groups")
      .select("*")
      .eq("id", input.groupId)
      .single();
    if (!group) return { ok: false, error: "group_not_found" };

    const { data: membership } = await supabase
      .from("group_members")
      .select("status")
      .eq("group_id", input.groupId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return { ok: false, error: "not_a_member" };

    const now = new Date();
    const phase = seasonPhase(new Date(group.entry_closes_at), now);

    // Practice closes for good at the first Week 1 kickoff. After that the
    // preseason rows are still in the database but are nobody's live game.
    if (seasonType === "pre" && phase !== "preseason") {
      return { ok: false, error: "practice_closed" };
    }

    // Scoped to one season_type: mixing them would let an August preseason
    // kickoff decide the regular season's live week, and would match a team to
    // the wrong game entirely.
    const { data: gameRows } = await supabase
      .from("games")
      .select("*")
      .eq("season", group.season)
      .eq("season_type", seasonType);
    const games = (gameRows ?? []).map(rowToGame);

    const { data: myPicks } = await supabase
      .from("picks")
      .select("team_id, week, game_id")
      .eq("group_id", input.groupId)
      .eq("user_id", user.id)
      .eq("season_type", seasonType);

    // Which week is live, whether this member may pick at all, and which teams
    // they have already spent — all three answered per phase. For practice the
    // member's standing is DERIVED from preseason results, never read from
    // group_members, so a regular-season elimination can't block practice and a
    // practice elimination can't touch the real league.
    let week: number;
    let memberStatus = membership.status;
    let usedHistory: { teamId: string }[];

    if (seasonType === "pre") {
      const practice = derivePractice({
        games,
        picks: (myPicks ?? []).map((p) => ({
          userId: user.id,
          week: p.week,
          teamId: p.team_id,
          gameId: p.game_id,
        })),
        memberIds: [user.id],
        rules: { eliminationType: group.elimination_type, tieRule: group.tie_rule },
        now,
      });
      if (!practice) return { ok: false, error: "no_practice_schedule" };
      week = practice.currentWeek;
      const me = practice.members[user.id];
      memberStatus = me?.status ?? "alive";
      usedHistory = practiceUsedTeams(me, { excludeWeek: week });
    } else {
      week = resolveCurrentWeek({ phase, now, games, finalWeek: FINAL_WEEK });
      // Teams spent in OTHER weeks count as used; the current week's own pick may
      // be freely replaced, so exclude it from the used set.
      usedHistory = (myPicks ?? [])
        .filter((p) => p.week !== week)
        .map((p) => ({ teamId: p.team_id }));
    }

    const game = games.find(
      (g) => g.week === week && (g.home === input.teamId || g.away === input.teamId),
    );

    const guard = canPick({
      member: { status: memberStatus, history: usedHistory },
      teamId: input.teamId,
      game: game ? { status: game.status, kickoff: game.kickoff } : null,
      // Entry-window enforcement is a JOIN concern (join_by_invite), not a weekly
      // one: an enrolled member picks every week, locked per-game by kickoff. So
      // the entry gate is intentionally satisfied here.
      entryOpen: true,
      now,
    });
    if (!guard.ok) return { ok: false, error: guard.reason };

    const { error } = await supabase.from("picks").upsert(
      {
        group_id: input.groupId,
        user_id: user.id,
        season_type: seasonType,
        week,
        team_id: input.teamId,
        game_id: game!.id,
        result: "pending",
        updated_at: now.toISOString(),
      },
      { onConflict: "group_id,user_id,season_type,week" },
    );
    if (error) {
      // 23505 = unique_violation. Key off the SQLSTATE code rather than the message
      // text: 0006 renamed this constraint to `picks_team_once_per_phase`, and the
      // previous /team_id/ match silently stopped matching — turning "you've already
      // used that team" into "something went wrong on our end". The only unique
      // constraint a pick can now trip is the per-phase team one, since the week one
      // is this upsert's own conflict target.
      if (error.code === "23505") return { ok: false, error: "team_already_used" };
      // Anything else is a raw Postgres message — a constraint name is not copy
      // for a player to read, and the callers key off this as a code. Log it and
      // hand back a stable one.
      console.error("[submitPick] upsert failed", error);
      return { ok: false, error: "unexpected_error" };
    }

    revalidatePath("/app");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/**
 * Update the viewer's name. The image bytes are uploaded client-side (the
 * browser holds the File); this persists the resulting fields and revalidates
 * the caches so the roster/account refresh. RLS "profiles update own" is the
 * backstop — a caller can only ever write their own row.
 */
export async function updateProfile(input: {
  firstName: string;
  lastName: string;
}): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (firstName.length < 1) return { ok: false, error: "first_name_required" };

    const { error } = await supabase
      .from("profiles")
      .update({ first_name: firstName, last_name: lastName })
      .eq("id", user.id);
    if (error) {
      console.error("[updateProfile] update failed", error);
      return { ok: false, error: "unexpected_error" };
    }

    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/** Persist the viewer's uploaded avatar URL (bytes already in storage). */
export async function updateAvatar(url: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", user.id);
    if (error) {
      console.error("[updateAvatar] update failed", error);
      return { ok: false, error: "unexpected_error" };
    }

    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/**
 * The earliest regular-season Week 1 kickoff for the season a new group will land in,
 * or null when the schedule hasn't been loaded.
 *
 * Regular season and week 1 specifically: the earliest game of the year is the Hall of
 * Fame game in early August, and using that as an entry deadline would close entry on
 * a league the moment it was created.
 *
 * `games` is world-readable to authenticated users (0001_init.sql:179), so this needs
 * no elevated privileges.
 */
async function firstWeek1Kickoff(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const season = new Date().getUTCFullYear();
  const { data } = await supabase
    .from("games")
    .select("kickoff")
    .eq("season", season)
    .eq("season_type", "regular")
    .eq("week", 1)
    .order("kickoff", { ascending: true })
    .limit(1);
  return data?.[0]?.kickoff ?? null;
}

/** Create a league and enroll the caller as admin (atomic, via create_group). */
export async function createGroup(input: {
  name: string;
  eliminationType: EliminationType;
  tieRule: TieRule;
  entryClosesAt?: string;
}): Promise<ActionResult<{ groupId: string; inviteCode: string }>> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    /*
     * Entry closes at the first Week 1 kickoff — that is what the column means
     * (0001_init.sql:54) and what every consumer assumes.
     *
     * `create_group` can't know it: its fallback is `now() + interval '7 days'`, so a
     * league created in August closed its own entry a week later, and `join_by_invite`
     * then refuses every new member permanently with no override in the app. The RPC
     * has always accepted `p_entry_closes_at`; nothing ever passed one.
     *
     * `season` here must match what the RPC will choose, which is
     * `extract(year from now())` — the same default `create_group` applies when
     * `p_season` is null. If no schedule is loaded we send nothing and the 7-day
     * fallback stands, which is the best guess available.
     */
    const entryClosesAt = input.entryClosesAt ?? (await firstWeek1Kickoff(supabase));

    const { data, error } = await supabase.rpc("create_group", {
      p_name: input.name.trim(),
      p_elimination_type: input.eliminationType,
      p_tie_rule: input.tieRule,
      ...(entryClosesAt ? { p_entry_closes_at: entryClosesAt } : {}),
    });
    if (error || !data) {
      // The RPC raises name_required / bad_elimination_type / bad_tie_rule as
      // bare codes; pass those through, but never a raw Postgres message.
      const raised = error?.message?.match(/\b(name_required|bad_elimination_type|bad_tie_rule)\b/)?.[1];
      if (!raised && error) console.error("[createGroup] rpc failed", error);
      return { ok: false, error: raised ?? "create_failed" };
    }

    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true, data: { groupId: data.id, inviteCode: data.invite_code } };
  });
}

/** Join a league by invite code (idempotent, via join_by_invite). */
export async function joinGroup(code: string): Promise<ActionResult<{ groupId: string }>> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { data, error } = await supabase.rpc("join_by_invite", { p_code: code.trim() });
    if (error || !data) {
      const msg = error?.message ?? "";
      const reason = msg.includes("entry_closed")
        ? "entry_closed"
        : msg.includes("invalid_code")
          ? "invalid_code"
          : "join_failed";
      return { ok: false, error: reason };
    }

    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true, data: { groupId: data.id } };
  });
}
