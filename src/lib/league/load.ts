import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import type { Game } from "@/lib/nfl/types";
import { rowToGame } from "@/lib/game/score";
import { evaluateTeamPick } from "@/lib/game/elimination";
import { resolveCurrentWeek, seasonPhase, type SeasonPhase } from "@/lib/game/season";
import { FINAL_WEEK } from "@/lib/nfl/calendar";
import { buildGameIndex } from "./games";
import { derivePractice, type PracticeState } from "./practice";
import { formatDisplayName } from "./name";
import { ACTIVE_LEAGUE_COOKIE, resolveActiveGroupId } from "./active";
import type { Group, GroupRules, HistoryPick, Member } from "./types";

export { FINAL_WEEK };

type GroupRow = Database["public"]["Tables"]["groups"]["Row"];
type MemberRow = Database["public"]["Tables"]["group_members"]["Row"];
type PickRow = Database["public"]["Tables"]["picks"]["Row"];

export interface Viewer {
  id: string;
  /** Pre-formatted "First L." for display. */
  name: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  email: string | null;
  /** One of FAVORITE_ANIMALS, or null when unset or no longer on the list. */
  favoriteAnimal: string | null;
}

/** The identity fields carried on a profile row, shared by viewer + members. */
interface ProfileName {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  /** From profile_private — present only for rows RLS let the viewer read. */
  phone: string | null;
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
  /** Regular-season standing. Never touched by preseason practice. */
  members: Member[];
  /** Regular-season games only (`season_type = 'regular'`). */
  games: Game[];
  nowIso: string;
  currentWeek: number;
  finalWeek: number;
  phase: SeasonPhase;
  /** user_ids with a locked-but-still-hidden pick this week (padlock, no team). */
  hiddenPickUserIds: string[];
  /**
   * The preseason practice round, derived (never stored) and present only while
   * entry is still open. It becomes null the moment Week 1 kicks off — which IS
   * the reset: no job runs, nothing is deleted, practice simply stops being read.
   */
  practice: PracticeData | null;
}

export interface PracticeData extends PracticeState {
  /** user_ids with a locked-but-still-hidden practice pick this week. */
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

function toMember(row: MemberRow, profile: ProfileName | undefined, picks: PickRow[], currentWeek: number, rules: GroupRules, gameById: (id: string) => Game | undefined): Member {
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
  const firstName = profile?.firstName ?? "";
  const lastName = profile?.lastName ?? "";
  return {
    id: row.user_id,
    name: formatDisplayName(firstName, lastName),
    firstName,
    lastName,
    avatarUrl: profile?.avatarUrl ?? null,
    phone: profile?.phone ?? null,
    role: row.role,
    status: row.status,
    strikes: row.strikes,
    buyInPaid: row.buy_in_paid,
    eliminatedWeek: row.eliminated_week,
    history,
    currentPick,
  };
}

/**
 * The league the viewer last selected, if any. Read defensively: the cookie is
 * client-visible only in the sense that it rides on the request, and the value
 * is validated against real memberships by `resolveActiveGroupId` before it is
 * used for anything.
 */
async function preferredGroupId(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_LEAGUE_COOKIE)?.value ?? null;
}

/**
 * Load the current viewer's active league, RLS-scoped to them. Memoized per
 * request via React `cache`, so the layout header and the page body share one
 * round-trip. Pass `groupId` to target a specific membership; otherwise the
 * league the viewer selected on the account page (a cookie) wins, falling back
 * to the earliest-joined group.
 */
export const loadLeague = cache(async (groupId?: string): Promise<LeagueLoad> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "signed_out" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, avatar_url, favorite_animal")
    .eq("id", user.id)
    .maybeSingle();

  const viewer: Viewer = {
    id: user.id,
    name: formatDisplayName(
      profile?.first_name,
      profile?.last_name,
      user.email?.split("@")[0] ?? "Player",
    ),
    firstName: profile?.first_name ?? "",
    lastName: profile?.last_name ?? "",
    avatarUrl: profile?.avatar_url ?? null,
    email: user.email ?? null,
    favoriteAnimal: profile?.favorite_animal ?? null,
  };

  const { data: myMemberships } = await supabase
    .from("group_members")
    .select("group_id, joined_at")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  if (!myMemberships || myMemberships.length === 0) return { kind: "no_group", viewer };

  const activeGroupId = resolveActiveGroupId(
    myMemberships.map((m) => m.group_id),
    groupId ?? (await preferredGroupId()),
  );
  if (!activeGroupId) return { kind: "no_group", viewer };

  const { data: groupRow } = await supabase
    .from("groups")
    .select("*")
    .eq("id", activeGroupId)
    .single();
  if (!groupRow) return { kind: "no_group", viewer };
  const group = rowToGroup(groupRow);

  // Every query below is scoped by season_type. Without that, preseason week N
  // and regular week N land in the same bucket in buildGameIndex (which keys on
  // week alone), so gameForTeam returns whichever row Postgres happened to
  // return first and an August preseason kickoff drags currentWeek forward.
  const [
    { data: memberRows },
    { data: pickRows },
    { data: gameRows },
    { data: prePickRows },
    { data: preGameRows },
  ] = await Promise.all([
    supabase.from("group_members").select("*").eq("group_id", group.id),
    supabase.from("picks").select("*").eq("group_id", group.id).eq("season_type", "regular"),
    supabase.from("games").select("*").eq("season", group.season).eq("season_type", "regular"),
    supabase.from("picks").select("*").eq("group_id", group.id).eq("season_type", "pre"),
    supabase.from("games").select("*").eq("season", group.season).eq("season_type", "pre"),
  ]);

  const games = (gameRows ?? []).map(rowToGame);
  const idx = buildGameIndex(games);

  const now = new Date();
  const phase = seasonPhase(new Date(group.entryClosesAt), now);
  const currentWeek = resolveCurrentWeek({ phase, now, games, finalWeek: FINAL_WEEK });

  // Member identities (profiles are world-readable to authenticated users).
  const memberIds = (memberRows ?? []).map((m) => m.user_id);
  const profileById = new Map<string, ProfileName>();
  if (memberIds.length > 0) {
    // profile_private comes back RLS-filtered, not erroring: the viewer receives
    // their own row, plus every member's row when they admin a shared league.
    // Anyone else's phone is simply absent — no app-side gate exists or could.
    const [{ data: profiles }, { data: privateRows }] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name, avatar_url").in("id", memberIds),
      supabase.from("profile_private").select("id, phone").in("id", memberIds),
    ]);
    const phoneById = new Map((privateRows ?? []).map((r) => [r.id, r.phone]));
    for (const pr of profiles ?? [])
      profileById.set(pr.id, {
        firstName: pr.first_name,
        lastName: pr.last_name,
        avatarUrl: pr.avatar_url,
        phone: phoneById.get(pr.id) ?? null,
      });
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
      profileById.get(row.user_id),
      picksByUser.get(row.user_id) ?? [],
      currentWeek,
      group.rules,
      idx.gameById,
    ),
  );

  // Preserve the Standings padlock: which rivals have locked a hidden pick.
  // Uses the season-typed RPC (0006) rather than 0003's week-only one, so a
  // rival's PRACTICE pick for the same week number can never light the regular
  // season's padlock.
  let hiddenPickUserIds: string[] = [];
  if (phase !== "preseason") {
    const { data: hidden } = await supabase.rpc("hidden_picks_for_week", {
      p_group_id: group.id,
      p_season_type: "regular",
      p_week: currentWeek,
    });
    if (Array.isArray(hidden)) hiddenPickUserIds = hidden as string[];
  }

  // The practice round, built only while entry is still open. Once Week 1 kicks
  // off this stays null and preseason disappears from the UI on its own.
  let practice: PracticeData | null = null;
  if (phase === "preseason") {
    const derived = derivePractice({
      games: (preGameRows ?? []).map(rowToGame),
      picks: (prePickRows ?? []).map((p) => ({
        userId: p.user_id,
        week: p.week,
        teamId: p.team_id,
        gameId: p.game_id,
      })),
      memberIds,
      rules: group.rules,
      now,
    });
    if (derived) {
      const { data: hidden } = await supabase.rpc("hidden_picks_for_week", {
        p_group_id: group.id,
        p_season_type: "pre",
        p_week: derived.currentWeek,
      });
      practice = {
        ...derived,
        hiddenPickUserIds: Array.isArray(hidden) ? (hidden as string[]) : [],
      };
    }
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
      practice,
    },
  };
});

// ── Account: the viewer's full league list (all memberships, not just active) ──
export interface LeagueSummary {
  group: Group;
  role: Member["role"];
  status: Member["status"];
  strikes: number;
  /** Admin-controlled, read-only to the member. See migration 0007. */
  buyInPaid: boolean;
  /**
   * Resolved here rather than in the client so the account page needs no clock
   * of its own — a `new Date()` during render is a hydration mismatch waiting
   * for someone to load the page across a kickoff.
   */
  phase: SeasonPhase;
  aliveCount: number;
  memberCount: number;
}

export interface AccountData {
  viewer: Viewer;
  memberSinceIso: string | null;
  /**
   * The viewer's own phone, from profile_private (account page only — it is
   * deliberately not on Viewer, which rides on every screen's payload).
   */
  phone: string | null;
  leagues: LeagueSummary[];
  /**
   * Which of `leagues` every other screen is currently rendering. Null only when
   * the viewer is in no leagues. The account page marks this one as selected and
   * reads its buy-in status.
   */
  activeGroupId: string | null;
}

export const loadAccount = cache(async (): Promise<AccountData | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: privateRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, avatar_url, favorite_animal, created_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("profile_private").select("phone").eq("id", user.id).maybeSingle(),
  ]);

  const viewer: Viewer = {
    id: user.id,
    name: formatDisplayName(
      profile?.first_name,
      profile?.last_name,
      user.email?.split("@")[0] ?? "Player",
    ),
    firstName: profile?.first_name ?? "",
    lastName: profile?.last_name ?? "",
    avatarUrl: profile?.avatar_url ?? null,
    email: user.email ?? null,
    favoriteAnimal: profile?.favorite_animal ?? null,
  };

  const { data: myMemberships } = await supabase
    .from("group_members")
    .select("group_id, role, status, strikes, buy_in_paid, joined_at")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  const memberships = myMemberships ?? [];
  const groupIds = memberships.map((m) => m.group_id);

  // Two queries for the whole list, not two per league. RLS already restricts
  // both to groups the viewer belongs to, so `.in()` cannot widen the result.
  const [{ data: groupRows }, { data: peerRows }] = groupIds.length
    ? await Promise.all([
        supabase.from("groups").select("*").in("id", groupIds),
        supabase.from("group_members").select("group_id, status").in("group_id", groupIds),
      ])
    : [{ data: [] as GroupRow[] }, { data: [] as { group_id: string; status: string }[] }];

  const groupById = new Map((groupRows ?? []).map((g) => [g.id, g]));
  const counts = new Map<string, { total: number; alive: number }>();
  for (const p of peerRows ?? []) {
    const c = counts.get(p.group_id) ?? { total: 0, alive: 0 };
    c.total += 1;
    if (p.status === "alive") c.alive += 1;
    counts.set(p.group_id, c);
  }

  const now = new Date();
  const leagues: LeagueSummary[] = [];
  for (const m of memberships) {
    const groupRow = groupById.get(m.group_id);
    if (!groupRow) continue;
    const c = counts.get(m.group_id) ?? { total: 0, alive: 0 };
    const group = rowToGroup(groupRow);
    leagues.push({
      group,
      role: m.role,
      status: m.status,
      strikes: m.strikes,
      buyInPaid: m.buy_in_paid,
      phase: seasonPhase(new Date(group.entryClosesAt), now),
      aliveCount: c.alive,
      memberCount: c.total,
    });
  }

  return {
    viewer,
    memberSinceIso: profile?.created_at ?? null,
    phone: privateRow?.phone ?? null,
    leagues,
    // Resolved exactly as loadLeague does, so the league marked "Selected" here
    // is the one My Picks and Standings are actually showing.
    activeGroupId: resolveActiveGroupId(
      leagues.map((l) => l.group.id),
      await preferredGroupId(),
    ),
  };
});
