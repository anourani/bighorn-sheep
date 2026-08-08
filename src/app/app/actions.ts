"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canPick } from "@/lib/game/elimination";
import { resolveCurrentWeek, seasonPhase } from "@/lib/game/season";
import { rowToGame } from "@/lib/game/score";
import type { EliminationType, TieRule } from "@/lib/league/types";

const FINAL_WEEK = 18;

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * Set (or change) the viewer's pick for the current week. Every survival rule is
 * re-checked here server-side — never trusted to the greyed-out UI — and RLS +
 * the picks unique constraints are the final backstop.
 */
export async function submitPick(input: {
  groupId: string;
  teamId: string;
}): Promise<ActionResult> {
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

  const { data: gameRows } = await supabase
    .from("games")
    .select("*")
    .eq("season", group.season);
  const games = (gameRows ?? []).map(rowToGame);

  const now = new Date();
  const phase = seasonPhase(new Date(group.entry_closes_at), now);
  const week = resolveCurrentWeek({ phase, now, games, finalWeek: FINAL_WEEK });

  const game = games.find(
    (g) => g.week === week && (g.home === input.teamId || g.away === input.teamId),
  );

  const { data: myPicks } = await supabase
    .from("picks")
    .select("team_id, week")
    .eq("group_id", input.groupId)
    .eq("user_id", user.id);
  // Teams spent in OTHER weeks count as used; the current week's own pick may be
  // freely replaced, so exclude it from the used set.
  const usedHistory = (myPicks ?? [])
    .filter((p) => p.week !== week)
    .map((p) => ({ teamId: p.team_id }));

  const guard = canPick({
    member: { status: membership.status, history: usedHistory },
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
      week,
      team_id: input.teamId,
      game_id: game!.id,
      result: "pending",
      updated_at: now.toISOString(),
    },
    { onConflict: "group_id,user_id,week" },
  );
  if (error) {
    // The (group_id,user_id,team_id) unique constraint = one use per season.
    const used = /team_id/.test(error.message) && /unique|duplicate/i.test(error.message);
    return { ok: false, error: used ? "team_already_used" : error.message };
  }

  revalidatePath("/app");
  revalidatePath("/app/standings");
  return { ok: true };
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
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/account");
  revalidatePath("/app/standings");
  return { ok: true };
}

/** Persist the viewer's uploaded avatar URL (bytes already in storage). */
export async function updateAvatar(url: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app");
  revalidatePath("/app/account");
  revalidatePath("/app/standings");
  return { ok: true };
}

/** Create a league and enroll the caller as admin (atomic, via create_group). */
export async function createGroup(input: {
  name: string;
  eliminationType: EliminationType;
  tieRule: TieRule;
  entryClosesAt?: string;
}): Promise<ActionResult<{ groupId: string; inviteCode: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const { data, error } = await supabase.rpc("create_group", {
    p_name: input.name.trim(),
    p_elimination_type: input.eliminationType,
    p_tie_rule: input.tieRule,
    ...(input.entryClosesAt ? { p_entry_closes_at: input.entryClosesAt } : {}),
  });
  if (error || !data) return { ok: false, error: error?.message ?? "create_failed" };

  revalidatePath("/app");
  revalidatePath("/app/account");
  revalidatePath("/app/standings");
  return { ok: true, data: { groupId: data.id, inviteCode: data.invite_code } };
}

/** Join a league by invite code (idempotent, via join_by_invite). */
export async function joinGroup(code: string): Promise<ActionResult<{ groupId: string }>> {
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
}
