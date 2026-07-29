import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import type { Game } from "@/lib/nfl/types";
import { rowToGame } from "@/lib/game/score";
import { evaluateTeamPick } from "@/lib/game/elimination";
import { resolveCurrentWeek, seasonPhase, type SeasonPhase } from "@/lib/game/season";
import { buildGameIndex } from "./games";
import type { Group, GroupRules, HistoryPick, Member } from "./types";

export const FINAL_WEEK = 18;

type GroupRow = Database["public"]["Tables"]["groups"]["Row"];
type MemberRow = Database["public"]["Tables"]["group_members"]["Row"];
type PickRow = Database["public"]["Tables"]["picks"]["Row"];

export interface Viewer {
  id: string;
  name: string;
  email: string | null;
}

/**
 * Everything the four screens need for one league, fully serialized so it can
 * cross the RSC → client boundary as props. No functions, no Date objects
 * (`nowIso` instead) — the client rebuilds the game lookups from `games` via
 * `buildGameIndex`. This is the real-data shape that replaces `src/lib/mock`.
 */
export interface LeagueData {
  viewer: Viewer;
  group: Group;
  members: Member[];
  games: Game[];
  nowIso: string;
  currentWeek: number;
  finalWeek: number;
  phase: SeasonPhase;
  /** user_ids with a locked-but-still-hidden pick this week (padlock, no team). */
  hiddenPickUserIds: string[];
}

export type LeagueLoad =
  | { kind: "signed_out" }
  | { kind: "no_group"; viewer: Viewer }
  | { kind: "ok"; data: LeagueData };

function rowToGroup(r: GroupRow): Group {
  return {
    id: r.id,
    name: r.name,
    season: r.season,
    rules: { eliminationType: r.elimination_type, tieRule: r.tie_rule },
    inviteCode: r.invite_code,
    entryClosesAt: r.entry_closes_at,
    settingsLockedAt: r.settings_locked_at,
  };
}

/** A past pick's result: trust the scored value, else derive from the game. */
function historyResult(
  p: PickRow,
  game: Game | undefined,
  rules: GroupRules,
): HistoryPick["result"] | null {
  if (p.result === "win" || p.result === "loss" || p.result === "push") return p.result;
  const derived = evaluateTeamPick(game ?? null, p.team_id, rules);
  return derived === "win" || derived === "loss" || derived === "push" ? derived : null;
}

function toMember(row: MemberRow, name: string, picks: PickRow[], currentWeek: number, rules: GroupRules, gameById: (id: string) => Game | undefined): Member {
  const history: HistoryPick[] = [];
  let currentPick: Member["currentPick"] = null;
  for (const p of picks) {
    if (p.week === currentWeek) {
      currentPick = { week: p.week, teamId: p.team_id, gameId: p.game_id };
    } else if (p.week < currentWeek) {
      const result = historyResult(p, gameById(p.game_id), rules);
      if (result) history.push({ week: p.week, teamId: p.team_id, result });
    }
  }
  history.sort((a, b) => a.week - b.week);
  return {
    id: row.user_id,
    name,
    role: row.role,
    status: row.status,
    strikes: row.strikes,
    eliminatedWeek: row.eliminated_week,
    history,
    currentPick,
  };
}

/**
 * Load the current viewer's active league, RLS-scoped to them. Memoized per
 * request via React `cache`, so the layout header and the page body share one
 * round-trip. Pass `groupId` to target a specific membership (a future group
 * switcher); defaults to the earliest-joined group.
 */
export const loadLeague = cache(async (groupId?: string): Promise<LeagueLoad> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "signed_out" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const viewer: Viewer = {
    id: user.id,
    name: profile?.display_name ?? user.email?.split("@")[0] ?? "Player",
    email: user.email ?? null,
  };

  const { data: myMemberships } = await supabase
    .from("group_members")
    .select("group_id, joined_at")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  if (!myMemberships || myMemberships.length === 0) return { kind: "no_group", viewer };

  const activeGroupId =
    groupId && myMemberships.some((m) => m.group_id === groupId)
      ? groupId
      : myMemberships[0]!.group_id;

  const { data: groupRow } = await supabase
    .from("groups")
    .select("*")
    .eq("id", activeGroupId)
    .single();
  if (!groupRow) return { kind: "no_group", viewer };
  const group = rowToGroup(groupRow);

  const [{ data: memberRows }, { data: pickRows }, { data: gameRows }] = await Promise.all([
    supabase.from("group_members").select("*").eq("group_id", group.id),
    supabase.from("picks").select("*").eq("group_id", group.id),
    supabase.from("games").select("*").eq("season", group.season),
  ]);

  const games = (gameRows ?? []).map(rowToGame);
  const idx = buildGameIndex(games);

  const now = new Date();
  const phase = seasonPhase(new Date(group.entryClosesAt), now);
  const currentWeek = resolveCurrentWeek({ phase, now, games, finalWeek: FINAL_WEEK });

  // Member display names (profiles are world-readable to authenticated users).
  const memberIds = (memberRows ?? []).map((m) => m.user_id);
  const nameById = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", memberIds);
    for (const pr of profiles ?? []) nameById.set(pr.id, pr.display_name);
  }

  const picksByUser = new Map<string, PickRow[]>();
  for (const p of pickRows ?? []) {
    const arr = picksByUser.get(p.user_id) ?? [];
    arr.push(p);
    picksByUser.set(p.user_id, arr);
  }

  const members: Member[] = (memberRows ?? []).map((row) =>
    toMember(
      row,
      nameById.get(row.user_id) ?? "Player",
      picksByUser.get(row.user_id) ?? [],
      currentWeek,
      group.rules,
      idx.gameById,
    ),
  );

  // Preserve the Standings padlock: which rivals have locked a hidden pick.
  let hiddenPickUserIds: string[] = [];
  if (phase !== "preseason") {
    const { data: hidden } = await supabase.rpc("hidden_pick_user_ids", {
      p_group_id: group.id,
      p_week: currentWeek,
    });
    if (Array.isArray(hidden)) hiddenPickUserIds = hidden as string[];
  }

  return {
    kind: "ok",
    data: {
      viewer,
      group,
      members,
      games,
      nowIso: now.toISOString(),
      currentWeek,
      finalWeek: FINAL_WEEK,
      phase,
      hiddenPickUserIds,
    },
  };
});

// ── Account: the viewer's full league list (all memberships, not just active) ──
export interface LeagueSummary {
  group: Group;
  role: Member["role"];
  status: Member["status"];
  strikes: number;
  aliveCount: number;
  memberCount: number;
}

export interface AccountData {
  viewer: Viewer;
  memberSinceIso: string | null;
  leagues: LeagueSummary[];
}

export const loadAccount = cache(async (): Promise<AccountData | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, created_at")
    .eq("id", user.id)
    .maybeSingle();

  const viewer: Viewer = {
    id: user.id,
    name: profile?.display_name ?? user.email?.split("@")[0] ?? "Player",
    email: user.email ?? null,
  };

  const { data: myMemberships } = await supabase
    .from("group_members")
    .select("group_id, role, status, strikes, joined_at")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  const leagues: LeagueSummary[] = [];
  for (const m of myMemberships ?? []) {
    const { data: groupRow } = await supabase
      .from("groups")
      .select("*")
      .eq("id", m.group_id)
      .single();
    if (!groupRow) continue;
    const { data: peers } = await supabase
      .from("group_members")
      .select("status")
      .eq("group_id", m.group_id);
    const memberCount = peers?.length ?? 0;
    const aliveCount = (peers ?? []).filter((p) => p.status === "alive").length;
    leagues.push({
      group: rowToGroup(groupRow),
      role: m.role,
      status: m.status,
      strikes: m.strikes,
      aliveCount,
      memberCount,
    });
  }

  return {
    viewer,
    memberSinceIso: profile?.created_at ?? null,
    leagues,
  };
});
