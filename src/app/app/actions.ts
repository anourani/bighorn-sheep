"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { canPick } from "@/lib/game/elimination";
import { resolveCurrentWeek, seasonPhase } from "@/lib/game/season";
import { rowToGame } from "@/lib/game/score";
import { FINAL_WEEK } from "@/lib/nfl/calendar";
import type { SeasonType } from "@/lib/nfl/types";
import { derivePractice, practiceUsedTeams } from "@/lib/league/practice";
import { ACTIVE_LEAGUE_COOKIE } from "@/lib/league/active";
import { isFavoriteAnimal } from "@/lib/profile/animals";

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

    /*
     * `select("*")`, not `select("status, show_preseason")`.
     *
     * PostgREST raises 42703 on an unknown column rather than returning
     * undefined, and migrations here are applied to production BY HAND. Naming
     * 0011's column before 0011 lands would make `membership` null and turn
     * EVERY pick in the app into `not_a_member` — one late migration escalating
     * from "an admin panel is broken" to "nobody can play". A star select cannot
     * 42703, and the flag below falls open.
     */
    const { data: membership } = await supabase
      .from("group_members")
      .select("*")
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

    /*
     * Practice is per-member, and gating it in the UI alone would not gate it:
     * an exported Server Action is a reachable HTTP endpoint. `load.ts` drops the
     * whole practice round for a switched-off viewer, which is what hides the
     * weeks; this is what stops one being picked anyway.
     *
     * Fails OPEN (`?? true`) for the reason above — before 0011 is applied the
     * column is absent from the row, and the answer must be "carry on", not
     * "practice is closed for the entire league".
     *
     * Ordered AFTER practice_closed deliberately: when practice is over for
     * everyone, saying "your admin hasn't enabled this" would be a false
     * explanation of a true refusal.
     */
    if (seasonType === "pre" && !(membership.show_preseason ?? true)) {
      return { ok: false, error: "practice_not_enabled" };
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

/** Longer than any real number once punctuation and a country code are allowed. */
const MAX_PHONE_LENGTH = 32;

/**
 * Update the viewer's name and phone. The image bytes are uploaded client-side
 * (the browser holds the File); this persists the resulting fields and
 * revalidates the caches so the roster/account refresh. RLS "profiles update
 * own" is the backstop — a caller can only ever write their own row.
 *
 * `phone` is optional and free text. It is never parsed, formatted or dialled —
 * it exists so a commissioner can chase someone — so there is nothing to gain
 * from validating a shape and plenty to lose (international numbers, extensions).
 * Omit the key entirely to leave the stored number alone; pass "" to clear it.
 */
export async function updateProfile(input: {
  firstName: string;
  lastName: string;
  phone?: string | null;
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

    // Validate everything before writing anything, so a bad phone can't leave a
    // half-applied edit (name saved, phone rejected).
    let phone: string | null | undefined;
    if (input.phone !== undefined) {
      const trimmed = (input.phone ?? "").trim();
      if (trimmed.length > MAX_PHONE_LENGTH) return { ok: false, error: "phone_invalid" };
      phone = trimmed.length > 0 ? trimmed : null;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ first_name: firstName, last_name: lastName })
      .eq("id", user.id);
    if (error) {
      console.error("[updateProfile] update failed", error);
      return { ok: false, error: "unexpected_error" };
    }

    // The phone lives on profile_private (0008), not profiles: readable only by
    // the owner and their league admins. Upsert, because the row doesn't exist
    // until the first time a user sets a private field.
    if (phone !== undefined) {
      const { error: privErr } = await supabase
        .from("profile_private")
        .upsert({ id: user.id, phone }, { onConflict: "id" });
      if (privErr) {
        console.error("[updateProfile] private upsert failed", privErr);
        return { ok: false, error: "unexpected_error" };
      }
    }

    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/**
 * Persist the viewer's favorite animal, or null to clear it. This is also the
 * app's avatar setter — the animal is what every Avatar renders — so it
 * revalidates every route a player appears on, not just the account page.
 *
 * Validated against FAVORITE_ANIMALS here rather than by a check constraint: the
 * column is plain text so the list can grow without a migration run by hand
 * against production, which makes this the only gate on what gets written.
 */
export async function updateFavoriteAnimal(animal: string | null): Promise<ActionResult> {
  return attempt(async () => {
    if (animal !== null && !isFavoriteAnimal(animal)) return { ok: false, error: "bad_animal" };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { error } = await supabase
      .from("profiles")
      .update({ favorite_animal: animal })
      .eq("id", user.id);
    if (error) {
      console.error("[updateFavoriteAnimal] update failed", error);
      return { ok: false, error: "unexpected_error" };
    }

    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
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

/**
 * Mark a member's league buy-in paid or unpaid. Admin only.
 *
 * Goes through the set_member_buy_in RPC rather than a plain `.update()`:
 * `group_members` has no UPDATE policy at all (0001), so a direct update from
 * the client is silently a no-op — it reports success having changed nothing.
 * The RPC is SECURITY DEFINER and re-checks `is_group_admin` itself, so this is
 * enforced in Postgres and not by whichever component chose to render a toggle.
 */
export async function setMemberBuyIn(input: {
  groupId: string;
  userId: string;
  paid: boolean;
}): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { error } = await supabase.rpc("set_member_buy_in", {
      p_group_id: input.groupId,
      p_user_id: input.userId,
      p_paid: input.paid,
    });
    if (error) {
      const msg = error.message ?? "";
      // A missing function means 0007 has not been applied to this database —
      // worth its own code, because the symptom is otherwise indistinguishable
      // from a permissions problem. See CLAUDE.md: migrations are applied by hand.
      const reason = msg.includes("not_admin")
        ? "not_admin"
        : msg.includes("member_not_found")
          ? "member_not_found"
          : "buy_in_update_failed";
      console.error("[setMemberBuyIn] rpc failed", error);
      return { ok: false, error: reason };
    }

    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/**
 * Set what the pot costs, for one league. Admin-only.
 *
 * Goes through the set_group_buy_in RPC rather than a plain `.update()`, and the
 * reason is the same one 0007 gives for `set_member_buy_in` one table over:
 * `groups` DOES have an admin UPDATE policy (0001), but RLS cannot restrict
 * WHICH COLUMNS an update writes, so shipping the first client-side `groups`
 * update would hand the browser `invite_code`, `entry_closes_at`,
 * `elimination_type` and `tie_rule` along with the two it wants.
 *
 * Dollars are converted to cents by the caller. Validated here as well as in the
 * function body and the column's check constraint — three gates, because the
 * only one a determined caller cannot skip is the last.
 */
export async function setGroupBuyIn(input: {
  groupId: string;
  buyInCents: number;
  siteFeeCents: number;
}): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const buyInCents = Math.round(input.buyInCents);
    const siteFeeCents = Math.round(input.siteFeeCents);
    if (
      !Number.isFinite(buyInCents) ||
      !Number.isFinite(siteFeeCents) ||
      buyInCents < 0 ||
      siteFeeCents < 0
    ) {
      return { ok: false, error: "bad_amount" };
    }

    const { error } = await supabase.rpc("set_group_buy_in", {
      p_group_id: input.groupId,
      p_buy_in_cents: buyInCents,
      p_site_fee_cents: siteFeeCents,
    });
    if (error) {
      const msg = error.message ?? "";
      // A missing function means 0010 has not been applied to this database.
      // Worth its own code for the same reason 0007's was: the symptom is
      // otherwise indistinguishable from a permissions problem, and nothing in
      // this repo applies migrations (see CLAUDE.md).
      const reason = msg.includes("not_admin")
        ? "not_admin"
        : msg.includes("bad_amount")
          ? "bad_amount"
          : msg.includes("group_not_found")
            ? "group_not_found"
            : "buy_in_update_failed";
      console.error("[setGroupBuyIn] rpc failed", error);
      return { ok: false, error: reason };
    }

    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/**
 * Rename a league. Admin-only, and deliberately allowed at any point in the
 * season.
 *
 * Through the `set_group_name` RPC (0011) rather than a `.update()`, for the two
 * reasons `setGroupBuyIn` gives below: 0001's "groups update by admin
 * (unlocked)" policy refuses EVERY `groups` write once the season starts — which
 * is precisely the case this feature exists to fix — and RLS cannot restrict
 * which columns an update writes, so a client-side one would hand the browser
 * `invite_code` and the rules columns too. The RPC writes `name` and nothing
 * else.
 */
export async function setGroupName(input: {
  groupId: string;
  name: string;
}): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const name = input.name.trim();
    if (name.length === 0) return { ok: false, error: "name_required" };
    if (name.length > 60) return { ok: false, error: "name_too_long" };

    const { error } = await supabase.rpc("set_group_name", {
      p_group_id: input.groupId,
      p_name: name,
    });
    if (error) {
      const msg = error.message ?? "";
      // A missing function means 0011 has not been applied to this database.
      // Its own code, because the symptom is otherwise indistinguishable from a
      // permissions problem — same reasoning as 0007's and 0010's.
      const reason = msg.includes("not_admin")
        ? "not_admin"
        : msg.includes("name_required")
          ? "name_required"
          : msg.includes("name_too_long")
            ? "name_too_long"
            : msg.includes("group_not_found")
              ? "group_not_found"
              : "name_update_failed";
      console.error("[setGroupName] rpc failed", error);
      return { ok: false, error: reason };
    }

    // The league name is chrome: it is on the header and Standings, not just the
    // page that changed it.
    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/**
 * Change how the game is played. Admin-only, and frozen once the season starts —
 * the half of the split that `setGroupName` above deliberately isn't.
 *
 * The lock lives in the RPC, not here, and it tests TWO things: `settings_locked_at`
 * and `entry_closes_at <= now()`. Nothing in this project has ever written the
 * former, so on its own it would never fire and rules would stay editable in
 * Week 12. See 0011.
 */
export async function setGroupRules(input: {
  groupId: string;
  eliminationType: "single" | "two_time";
  tieRule: "push" | "loss";
}): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { error } = await supabase.rpc("set_group_rules", {
      p_group_id: input.groupId,
      p_elimination_type: input.eliminationType,
      p_tie_rule: input.tieRule,
    });
    if (error) {
      const msg = error.message ?? "";
      const reason = msg.includes("not_admin")
        ? "not_admin"
        : msg.includes("settings_locked")
          ? "settings_locked"
          : msg.includes("bad_elimination_type")
            ? "bad_elimination_type"
            : msg.includes("bad_tie_rule")
              ? "bad_tie_rule"
              : msg.includes("group_not_found")
                ? "group_not_found"
                : "rules_update_failed";
      console.error("[setGroupRules] rpc failed", error);
      return { ok: false, error: reason };
    }

    // Rules feed the elimination engine, so every screen that renders a result
    // is downstream of this.
    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/**
 * Turn the preseason practice round on or off for one member. Admin only.
 *
 * Through `set_member_preseason` (0011) for the same reason as
 * `setMemberBuyIn`: `group_members` has no UPDATE policy at all, so a direct
 * update from the client reports success having changed nothing.
 *
 * Read side is `load.ts`, which simply stops building `practice` for a
 * switched-off viewer; write side is `submitPick`, which refuses a preseason
 * pick from one. Their existing picks are untouched either way — the round is
 * derived at read time, so turning this off hides history rather than deleting
 * it.
 */
export async function setMemberPreseason(input: {
  groupId: string;
  userId: string;
  show: boolean;
}): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { error } = await supabase.rpc("set_member_preseason", {
      p_group_id: input.groupId,
      p_user_id: input.userId,
      p_show: input.show,
    });
    if (error) {
      const msg = error.message ?? "";
      const reason = msg.includes("not_admin")
        ? "not_admin"
        : msg.includes("member_not_found")
          ? "member_not_found"
          : "preseason_update_failed";
      console.error("[setMemberPreseason] rpc failed", error);
      return { ok: false, error: reason };
    }

    // The member's own picker and standings change, not the admin's.
    revalidatePath("/app");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/**
 * Read the scorer's last-run record for the Data Feed tab. Admin only.
 *
 * A read behind a Server Action rather than part of `loadLeague`, on purpose:
 * the admin modal is mounted for admins alone and most of them never open this
 * tab, so putting it in the loader would buy every Standings render an extra
 * query for a number almost nobody looks at. Called on the tab's mount instead.
 *
 * Returns the raw jsonb; `mapFeedStatus` in src/lib/league/feed.ts is what gives
 * it a shape, and it tolerates anything.
 */
export async function getFeedStatus(input: {
  groupId: string;
}): Promise<ActionResult<unknown>> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { data, error } = await supabase.rpc("feed_status_for_admin", {
      p_group_id: input.groupId,
    });
    if (error) {
      const msg = error.message ?? "";
      const reason = msg.includes("not_admin") ? "not_admin" : "feed_status_unavailable";
      console.error("[getFeedStatus] rpc failed", error);
      return { ok: false, error: reason };
    }

    return { ok: true, data };
  });
}

/**
 * Close the viewer's own account.
 *
 * Deliberately NOT a delete. The profile, membership, picks and strikes all
 * survive, because the player's line on the standings board is part of the
 * league's record for the season — removing someone from the board for good is
 * an admin action and does not exist yet. All this writes is a row in
 * `account_closures` (0010), which `/app`'s layout reads to redirect them to
 * `/account-closed`.
 *
 * The RPC takes no argument: it writes `auth.uid()`, so there is no id for a
 * caller to substitute, and there is no reopen counterpart for the same reason
 * the flag is not a `profiles.deleted_at` column — the account being closed must
 * not be able to open itself.
 *
 * Does not sign the caller out; the client does that, because `signOut()` clears
 * cookies the browser holds and this runs on the server.
 */
export async function closeOwnAccount(): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { error } = await supabase.rpc("close_own_account");
    if (error) {
      console.error("[closeOwnAccount] rpc failed", error);
      return { ok: false, error: "close_failed" };
    }

    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}

/**
 * Switch which league every screen renders — My Picks, Standings, the header
 * survivor strip. Stored in a cookie rather than a route param so it survives a
 * cold start and needs no change to any existing link.
 *
 * Membership is verified before the cookie is written. RLS would already stop a
 * non-member from reading the group, but an unchecked cookie would strand them
 * on a league that resolves to nothing on every screen at once.
 *
 * Deliberately does not `redirect()`: `attempt()` would swallow the control-flow
 * throw. The caller navigates (or refreshes) on `ok`.
 */
export async function selectLeague(groupId: string): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { data: membership, error } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id)
      .eq("group_id", groupId)
      .maybeSingle();
    if (error) {
      console.error("[selectLeague] membership lookup failed", error);
      return { ok: false, error: "unexpected_error" };
    }
    if (!membership) return { ok: false, error: "not_a_member" };

    const store = await cookies();
    store.set(ACTIVE_LEAGUE_COOKIE, groupId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      secure: process.env.NODE_ENV === "production",
    });

    revalidatePath("/app");
    revalidatePath("/app/account");
    revalidatePath("/app/standings");
    return { ok: true };
  });
}
