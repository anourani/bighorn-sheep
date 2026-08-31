"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { canPick } from "@/lib/game/elimination";
import { resolveCurrentWeek, resolvePickWeek, seasonPhase } from "@/lib/game/season";
import { rowToGame } from "@/lib/game/score";
import { FINAL_WEEK, REGULAR_WEEKS } from "@/lib/nfl/calendar";
import { isKickedOff, type SeasonType } from "@/lib/nfl/types";
import { derivePractice, practiceUsedTeams } from "@/lib/league/practice";
import { ACTIVE_LEAGUE_COOKIE } from "@/lib/league/active";
import { isFavoriteAnimal } from "@/lib/profile/animals";
import {
  FEED_MANUAL_COOLDOWN_MS,
  feedCheckedRecently,
  mapFeedStatus,
} from "@/lib/league/feed";
import { runScorePoll } from "@/lib/nfl/poll";
import { serviceClient } from "@/lib/supabase/service";
import { getMailer } from "@/lib/mail";
import { runReminderSend } from "@/lib/league/reminder-run";
import {
  REMINDER_MANUAL_COOLDOWN_MS,
  mapReminderStatus,
  reminderSentRecently,
  reminderWeek,
  weekPickWindow,
  type ReminderKind,
} from "@/lib/league/reminders";

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
 * The stable code for a failed admin RPC.
 *
 * `known` is the ordered list of substrings the function itself raises; the
 * first match wins, so each ladder stays one line at its call site instead of a
 * five-deep nest of ternaries.
 *
 * The two tests after it are the ones that were previously invisible, and they
 * are why this helper exists at all. Every admin ladder used to end in a
 * catch-all like `name_update_failed`, whose copy reads "Couldn't save that. Try
 * again." — so the single most common failure in this project, a migration that
 * has not been applied by hand (see CLAUDE.md; nothing here applies them),
 * rendered as an invitation to click Save again forever. It cost a real
 * debugging session.
 *
 * Two shapes mean "the database is behind the code":
 *
 *   - The function is not there. PostgREST answers `PGRST202` with "Could not
 *     find the function … in the schema cache"; Postgres answers `42883`. Note
 *     that PostgREST's message names the argument list, which makes this look
 *     like an argument-mismatch bug when it is nothing of the kind.
 *   - The function is there but its grants were not replayed. Each migration
 *     does `revoke all … from public` before `grant execute … to authenticated`,
 *     so pasting the body without the grants leaves `42501 permission denied for
 *     function`, which fails identically to the function not existing.
 *
 * `known` is tested FIRST, and that ordering is load-bearing: `not_admin` is
 * itself raised with errcode 42501, so a bare-code test placed above it would
 * report every non-admin as a missing migration.
 */
function rpcErrorCode(
  error: { code?: string | null; message?: string | null },
  known: readonly string[],
  fallback: string,
): string {
  const message = error.message ?? "";
  for (const code of known) {
    if (message.includes(code)) return code;
  }

  const sqlstate = error.code ?? "";
  if (sqlstate === "PGRST202" || sqlstate === "42883" || message.includes("schema cache")) {
    return "migration_missing";
  }
  // Reached only when `known` did not match, so this is never a `not_admin`.
  if (sqlstate === "42501") return "migration_missing";

  return fallback;
}

/**
 * Set (or change) the viewer's pick for a week. Every survival rule is re-checked
 * here server-side — never trusted to the greyed-out UI — and RLS + the picks
 * unique constraints are the final backstop.
 *
 * `seasonType` selects which of the two independent games this pick belongs to:
 * "regular" is the real league, "pre" is the practice round that resets at Week 1.
 *
 * `week` is NEW, and it used to be the enforcement: the week was derived here and
 * the caller's opinion discarded, which is what confined a member to the live
 * week. Picking ahead means the caller names a week, so the refusal moves into
 * `resolvePickWeek` — a Server Action is a reachable HTTP endpoint, and the
 * greyed-out UI gates nothing. Omitting it still means "the live week", because a
 * tab loaded before this shipped sends no week at all.
 *
 * A team may be spent once per phase (`picks_team_once_per_phase`), so a pick for
 * a team already booked in another week has to do something about that week. The
 * rule is that the WEEK YOU TAP WINS: the other pick is released and its week
 * comes back in `releasedWeek` so the caller can say so. A release is only
 * possible while that game has not kicked off — after that the team is genuinely
 * spent and this returns `team_already_used`, which is also what RLS would say.
 */
export async function submitPick(input: {
  groupId: string;
  teamId: string;
  seasonType?: SeasonType;
  /** Omit for the live week — a tab from before picking ahead shipped. */
  week?: number;
}): Promise<ActionResult<{ releasedWeek: number | null }>> {
  return attempt(async () => {
    const seasonType: SeasonType = input.seasonType ?? "regular";
    if (seasonType !== "regular" && seasonType !== "pre") {
      return { ok: false, error: "bad_season_type" };
    }
    // Shape before substance, and before `createClient()`: a hand-rolled POST
    // carrying `week: 1e9` should not cost a database round trip. The phase's
    // real week set is checked further down, where it is known.
    if (
      input.week !== undefined &&
      input.week !== null &&
      (!Number.isInteger(input.week) || input.week < 1 || input.week > FINAL_WEEK)
    ) {
      return { ok: false, error: "bad_week" };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    /*
     * `select("*")` on group_members, not `select("status, show_preseason")`.
     *
     * PostgREST raises 42703 on an unknown column rather than returning
     * undefined, and migrations here are applied to production BY HAND. Naming
     * 0011's column before 0011 lands would make `membership` null and turn
     * EVERY pick in the app into `not_a_member` — one late migration escalating
     * from "an admin panel is broken" to "nobody can play". A star select cannot
     * 42703, and the flag below falls open.
     *
     * The two reads are independent — one names the league, the other this
     * member's row in it — so they go out together. Every pick pays this
     * latency with the grid live under the player's finger, so round trips
     * that need not be sequential must not be.
     */
    const [{ data: group }, { data: membership }] = await Promise.all([
      supabase.from("groups").select("*").eq("id", input.groupId).single(),
      supabase
        .from("group_members")
        .select("*")
        .eq("group_id", input.groupId)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    // `group` first, so a bogus groupId still reads group_not_found rather than
    // not_a_member — the order the sequential reads answered in.
    if (!group) return { ok: false, error: "group_not_found" };
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
    // the wrong game entirely. Independent of the pick history beside it, so
    // the pair goes out together — same trade as the identity reads above.
    const [{ data: gameRows }, { data: myPicks }] = await Promise.all([
      supabase
        .from("games")
        .select("*")
        .eq("season", group.season)
        .eq("season_type", seasonType),
      supabase
        .from("picks")
        .select("team_id, week, game_id")
        .eq("group_id", input.groupId)
        .eq("user_id", user.id)
        .eq("season_type", seasonType),
    ]);
    const games = (gameRows ?? []).map(rowToGame);

    // Which week is live, whether this member may pick at all, and which teams
    // they have already spent — all three answered per phase.
    //
    // Practice and the real league cannot reach each other in either direction.
    // A regular-season elimination can't block practice, because `memberStatus`
    // below is not read for a 'pre' pick; and a practice loss can't touch the real
    // league, because nothing about practice is stored — `group_members.status` is
    // written only by `recomputeSeason`, which filters to `season_type = 'regular'`.
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
      // `practice.weeks` and not a numeric range: the preseason is three weeks in
      // seasons without a Hall of Fame game and four in seasons with one, so this
      // is the only list that knows whether a P4 exists to be picked.
      const resolved = resolvePickWeek({
        requested: input.week,
        liveWeek: practice.currentWeek,
        weeks: practice.weeks,
      });
      if (!resolved.ok) return { ok: false, error: resolved.error };
      week = resolved.week;
      const me = practice.members[user.id];
      // NOTHING ELIMINATES IN PRACTICE, so the guard's status test is satisfied
      // outright — same shape as the `entryOpen: true` below it, and for the same
      // kind of reason: the condition is answered by the round's rules rather than
      // by this member's record. `PracticeMember` has no `status` to read.
      //
      // This is the whole fix for the bug where a losing preseason pick refused
      // every later practice pick with "You're eliminated, so picks are closed."
      memberStatus = "alive";
      usedHistory = practiceUsedTeams(me, { excludeWeek: week });
    } else {
      // REGULAR_WEEKS, deliberately not the weeks present in `games`: an unloaded
      // schedule makes that list empty, which would turn today's honest
      // `no_game_for_team` into `bad_week` for a caller who named no week at all.
      const resolved = resolvePickWeek({
        requested: input.week,
        liveWeek: resolveCurrentWeek({ phase, now, games, finalWeek: FINAL_WEEK }),
        weeks: REGULAR_WEEKS,
      });
      if (!resolved.ok) return { ok: false, error: resolved.error };
      week = resolved.week;
      // Teams spent in OTHER weeks count as used; the TARGET week's own pick may
      // be freely replaced, so exclude it from the used set.
      usedHistory = (myPicks ?? [])
        .filter((p) => p.week !== week)
        .map((p) => ({ teamId: p.team_id }));
    }

    const game = games.find(
      (g) => g.week === week && (g.home === input.teamId || g.away === input.teamId),
    );

    /*
     * The release: this team booked in some other week of this phase.
     *
     * A row whose game has not kicked off is a PLAN, and the week you tap wins —
     * so it comes out of `usedHistory` (or `canPick` would refuse before we ever
     * got to delete it) and is deleted below. A row whose game HAS kicked off is
     * a team genuinely spent, so it stays in the used list and `canPick` answers
     * `team_already_used`. That split is not a convenience: 0001's delete policy
     * carries the same `g.kickoff > now()` test, so a released row that had
     * started would be refused by RLS anyway and we would be reporting a success
     * the database declined.
     */
    const booked = (myPicks ?? []).find((p) => p.team_id === input.teamId && p.week !== week);
    const bookedGame = booked ? games.find((g) => g.id === booked.game_id) : undefined;
    const releasable =
      booked !== undefined &&
      bookedGame !== undefined &&
      !isKickedOff({ status: bookedGame.status, kickoff: bookedGame.kickoff }, now);
    if (releasable) {
      usedHistory = usedHistory.filter((h) => h.teamId !== input.teamId);
    }

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

    /*
     * Freeing the team has to happen BEFORE the upsert, because
     * `picks_team_once_per_phase` would reject the new row while the old one
     * still holds the team. That makes this two statements with no transaction
     * between them — PostgREST offers none — so it runs only after every guard
     * above has passed, leaving infrastructure as the sole realistic failure.
     *
     * When the upsert then fails anyway, the member has lost a pick and gained
     * nothing, and saying "something went wrong" would leave them to discover
     * that themselves. `release_failed` says it outright.
     *
     * Rejected alternatives: a single UPDATE moving the old row's week is atomic
     * but only covers the case where the target week is empty, and two write
     * paths for one action is the worse trade. A definer RPC would be atomic
     * outright, but 0014's own notes already refused a `submit_pick` function —
     * it duplicates canPick into SQL and adds a round trip at the kickoff spike.
     */
    if (releasable && booked) {
      const { error: releaseError } = await supabase
        .from("picks")
        .delete()
        .eq("group_id", input.groupId)
        .eq("user_id", user.id)
        .eq("season_type", seasonType)
        .eq("week", booked.week);
      if (releaseError) {
        console.error("[submitPick] release failed", { week: booked.week, error: releaseError });
        return { ok: false, error: "team_already_used" };
      }
    }

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
      // A release already went through, so the member is now short a pick with
      // nothing to show for it. Say that, rather than letting them read
      // "something went wrong" and assume nothing changed.
      if (releasable) {
        console.error("[submitPick] upsert failed after release", {
          released: booked?.week,
          week,
          error,
        });
        return { ok: false, error: "release_failed" };
      }
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
    return { ok: true, data: { releasedWeek: releasable && booked ? booked.week : null } };
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
export async function joinGroup(
  code: string,
): Promise<ActionResult<{ groupId: string; groupName: string }>> {
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
    // The name comes back for free — join_by_invite returns the whole groups row
    // — and it is what lets the banner say "You've joined Bighorn Sheep" instead
    // of "Joined." Nothing leaks: you are a member of it by the time you read it.
    return { ok: true, data: { groupId: data.id, groupName: data.name } };
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
      const reason = rpcErrorCode(
        error,
        ["not_authenticated", "not_admin", "member_not_found"],
        "buy_in_update_failed",
      );
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
      const reason = rpcErrorCode(
        error,
        ["not_authenticated", "not_admin", "bad_amount", "group_not_found"],
        "buy_in_update_failed",
      );
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
      const reason = rpcErrorCode(
        error,
        ["not_authenticated", "not_admin", "name_required", "name_too_long", "group_not_found"],
        "name_update_failed",
      );
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
      const reason = rpcErrorCode(
        error,
        [
          "not_authenticated",
          "not_admin",
          "settings_locked",
          "bad_elimination_type",
          "bad_tie_rule",
          "group_not_found",
        ],
        "rules_update_failed",
      );
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
 *
 * Refuses to move at all once the season starts (`preseason_closed`). Practice
 * ends at the first Week 1 kickoff and never comes back, so there is no Week 11
 * in which this could be switched back on — the RPC enforces that, and the UI
 * disables the switch to match.
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
      const reason = rpcErrorCode(
        error,
        ["not_authenticated", "not_admin", "preseason_closed", "member_not_found"],
        "preseason_update_failed",
      );
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
 * Remove a player from a league, along with their picks. Admin only.
 *
 * The counterpart to `joinGroup`, and the only destructive control an admin has.
 * Everything that makes it safe is in the RPC (0013) rather than here: the
 * entry-still-open window, the refusal to remove an admin or yourself, and the
 * pick cleanup that stops a re-invited player finding their old teams spent.
 * A Server Action gated only in the UI is not gated.
 *
 * `not_admin` is in `known` and therefore tested BEFORE `rpcErrorCode` reaches
 * its bare-42501 branch — both raise 42501, and the one that means "grants were
 * never replayed" must not swallow the one that means "you aren't an admin".
 */
export async function removeMember(input: {
  groupId: string;
  userId: string;
}): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { error } = await supabase.rpc("remove_member", {
      p_group_id: input.groupId,
      p_user_id: input.userId,
    });
    if (error) {
      const reason = rpcErrorCode(
        error,
        [
          "not_authenticated",
          "not_admin",
          "cannot_remove_self",
          "group_not_found",
          "entry_closed",
          "cannot_remove_admin",
          "member_not_found",
        ],
        "remove_failed",
      );
      console.error("[removeMember] rpc failed", error);
      return { ok: false, error: reason };
    }

    // The roster and the board both lose a row; the account page counts members.
    revalidatePath("/app");
    revalidatePath("/app/standings");
    revalidatePath("/app/account");
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
      const reason = rpcErrorCode(
        error,
        ["not_authenticated", "not_admin"],
        "feed_status_unavailable",
      );
      console.error("[getFeedStatus] rpc failed", error);
      return { ok: false, error: reason };
    }

    return { ok: true, data };
  });
}

/**
 * Run the scorer NOW, on an admin's say-so, and hand back the fresh status.
 *
 * The Data Feed tab used to say outright that it could only read the last run.
 * That is a reasonable thing for a panel to admit and a poor thing for it to be:
 * the scorer is the league's heartbeat, and an admin watching a game with stale
 * standings had no move but to wait out the five-minute cron.
 *
 * In-process, not an HTTP call to the scheduled function. Whether a Netlify
 * scheduled function's endpoint answers a request in production is a platform
 * detail, and a button built on a guess about it is how the previous
 * "Enter a result manually" control came to sit there permanently disabled.
 * `runScorePoll` is the same body the cron runs, so the two cannot drift.
 *
 * Three things about the order below are deliberate:
 *
 *   1. `feed_status_for_admin` is called FIRST and does double duty. It raises
 *      `not_admin` in Postgres, so authorisation is enforced by the same definer
 *      function the read path already uses — no new RPC, no new SQL, and no
 *      second place for the admin check to rot. Its payload is also what the
 *      cooldown reads.
 *   2. The cooldown is checked BEFORE the service client is built, so a leaned-on
 *      button never reaches the provider at all.
 *   3. The status is re-read AFTER the poll, and its payload is what comes back.
 *      Returning the snapshot taken before the run would print "checked 5
 *      minutes ago" immediately after a successful check.
 *
 * A failing poll still resolves `ok`. `runScorePoll` records every verdict to
 * `feed_status` before returning, so the re-read carries what the run actually
 * hit — which the panel renders as "the score feed is failing" plus the stage
 * and the provider's message. That is strictly more use than a toast saying
 * something went wrong, and it is the reason the funnel writes from inside the
 * poll rather than from its callers.
 */
export async function runFeedCheck(input: { groupId: string }): Promise<ActionResult<unknown>> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const { data: before, error: readError } = await supabase.rpc("feed_status_for_admin", {
      p_group_id: input.groupId,
    });
    if (readError) {
      const reason = rpcErrorCode(
        readError,
        ["not_authenticated", "not_admin"],
        "feed_status_unavailable",
      );
      console.error("[runFeedCheck] status read failed", readError);
      return { ok: false, error: reason };
    }

    if (feedCheckedRecently(mapFeedStatus(before), FEED_MANUAL_COOLDOWN_MS)) {
      return { ok: false, error: "poll_too_soon" };
    }

    // Null when SUPABASE_SERVICE_ROLE_KEY isn't readable from this runtime. The
    // service role is not optional: record_feed_sync is granted to service_role
    // alone (0011), and the poll writes games and group_members past RLS.
    const service = serviceClient();
    if (!service) {
      console.error("[runFeedCheck] no service-role key in this runtime");
      return { ok: false, error: "feed_poll_unavailable" };
    }

    const season = Number(process.env.NFL_SEASON ?? new Date().getUTCFullYear());
    const outcome = await runScorePoll(service, { season, now: new Date() });
    if (outcome.httpStatus !== 200) {
      // Not returned to the caller — the verdict is already in feed_status and
      // the re-read below carries it. This is for the function log.
      console.error("[runFeedCheck] poll finished badly", outcome.httpStatus, outcome.body);
    }

    const { data: after, error: afterError } = await supabase.rpc("feed_status_for_admin", {
      p_group_id: input.groupId,
    });
    if (afterError) {
      console.error("[runFeedCheck] status re-read failed", afterError);
      return { ok: false, error: "poll_failed" };
    }

    // A poll locks picks at kickoff and can eliminate people, so the boards move.
    revalidatePath("/app");
    revalidatePath("/app/standings");
    return { ok: true, data: after };
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

/* ────────────────────────────────────────────────────────────────────────────
 * Reminder emails
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Everything both reminder actions need to know about the league and the clock.
 *
 * Split out because `sendReminders` must derive the week the SAME way
 * `getReminderStatus` displayed it — an action that took the week from its
 * caller would let a stale tab (or a hand-rolled POST) name a week that is
 * over, which consumes that week's row in 0015's unique index and silently
 * forecloses the real reminder.
 */
async function reminderContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
) {
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();
  if (groupError || !group) return null;

  // Regular season only, and never a mixed season_type list: preseason week 3
  // and regular week 3 are indistinguishable to the week resolvers.
  const { data: gameRows } = await supabase
    .from("games")
    .select("*")
    .eq("season", group.season)
    .eq("season_type", "regular");

  const games = (gameRows ?? []).map(rowToGame);
  const now = new Date();
  const phase = seasonPhase(new Date(group.entry_closes_at), now);
  const currentWeek = resolveCurrentWeek({ phase, now, games, finalWeek: FINAL_WEEK });
  const week = reminderWeek(games, now, currentWeek);
  const window = week === null ? null : weekPickWindow(games, week, now);

  return { group, games, now, week, window };
}

/**
 * Who still needs a reminder, for the drawer's Emails tab.
 *
 * Admin-gated in Postgres by `reminder_status_for_admin` (0015), which returns
 * names and reasons and deliberately NOT addresses — see that migration's
 * header. The week is derived here rather than by the browser, so the panel and
 * the send cannot disagree about which week is being talked about.
 */
export async function getReminderStatus(input: {
  groupId: string;
}): Promise<ActionResult<unknown>> {
  return attempt(async () => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const ctx = await reminderContext(supabase, input.groupId);
    if (!ctx) return { ok: false, error: "group_not_found" };

    const { data, error } = await supabase.rpc("reminder_status_for_admin", {
      p_group_id: input.groupId,
      p_season: ctx.group.season,
      p_season_type: "regular",
      p_week: ctx.week,
    });
    if (error) {
      const reason = rpcErrorCode(
        error,
        ["not_authenticated", "not_admin"],
        "reminder_status_unavailable",
      );
      console.error("[getReminderStatus] rpc failed", error);
      return { ok: false, error: reason };
    }

    return { ok: true, data: { status: data, window: ctx.window } };
  });
}

/**
 * Send one kind of reminder to the admin's ticked selection.
 *
 * The ordering below is `runFeedCheck`'s, deliberately and for its reasons:
 *
 *   1. Authorise through the EXISTING definer read. `reminder_status_for_admin`
 *      raises `not_admin` in Postgres, so there is no new RPC and no second
 *      place for the admin check to rot. Its payload is also what the cooldown
 *      reads.
 *   2. The cooldown is checked BEFORE the service client is built, so a
 *      leaned-on button never reaches the provider at all.
 *   3. The status is re-read AFTER the send, and that payload is what comes
 *      back. Returning the pre-send snapshot would show the people who were
 *      just emailed as still outstanding.
 *
 * `userIds` NARROWS and can never widen: `runReminderSend` intersects it with
 * what `reminder_due` says. That is what makes per-recipient tickboxes safe on
 * an endpoint anyone can POST to — and the reason no address ever reaches the
 * browser, so there is nothing here to substitute.
 *
 * Unlike `runFeedCheck`, a provider failure resolves `ok: false`. There is no
 * status row recording a failed run for the panel to explain, so the code has
 * to carry the news.
 */
export async function sendReminders(input: {
  groupId: string;
  kind: ReminderKind;
  userIds?: string[];
}): Promise<ActionResult<unknown>> {
  return attempt(async () => {
    if (input.kind !== "pick" && input.kind !== "buy_in") {
      return { ok: false, error: "bad_reminder_kind" };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not_authenticated" };

    const ctx = await reminderContext(supabase, input.groupId);
    if (!ctx) return { ok: false, error: "group_not_found" };

    const { data: before, error: readError } = await supabase.rpc("reminder_status_for_admin", {
      p_group_id: input.groupId,
      p_season: ctx.group.season,
      p_season_type: "regular",
      p_week: ctx.week,
    });
    if (readError) {
      const reason = rpcErrorCode(
        readError,
        ["not_authenticated", "not_admin"],
        "reminder_status_unavailable",
      );
      console.error("[sendReminders] status read failed", readError);
      return { ok: false, error: reason };
    }

    const snapshot = mapReminderStatus(before);
    if (reminderSentRecently(snapshot, input.kind, REMINDER_MANUAL_COOLDOWN_MS)) {
      return { ok: false, error: "reminder_too_soon" };
    }

    // Picks close at the week's last kickoff, because that is the instant a
    // missing pick becomes a loss. Money admin never closes, matching
    // set_group_buy_in, which has no lock check at all.
    if (input.kind === "pick") {
      if (ctx.week === null) return { ok: false, error: "reminder_week_closed" };
      if (ctx.window && !ctx.window.open) return { ok: false, error: "reminder_week_closed" };
    }

    /*
     * The app URL is resolved HERE, from the server's own environment, and a
     * blank one refuses the send outright.
     *
     * NEXT_PUBLIC_APP_URL is deliberately blank outside production, so this
     * makes reminders a production-only action — which is a feature: you cannot
     * mail the league from a deploy preview. Falling back to a hardcoded origin
     * would repeat a bug this repo has already shipped, and taking it from the
     * browser would let a hand-rolled POST put any link it liked into
     * league-branded mail from a verified domain. A wrong URL in a redirect is
     * recoverable; the same URL in twelve inboxes is not.
     */
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      console.error("[sendReminders] NEXT_PUBLIC_APP_URL is blank in this runtime");
      return { ok: false, error: "reminder_url_unconfigured" };
    }

    if (!getMailer()) return { ok: false, error: "reminder_mail_unconfigured" };

    // reminder_due and record_reminder_send are granted to service_role alone,
    // and the former reads auth.users. The anon-key client cannot do either.
    const service = serviceClient();
    if (!service) {
      console.error("[sendReminders] no service-role key in this runtime");
      return { ok: false, error: "reminder_send_unavailable" };
    }

    const outcome = await runReminderSend(service, {
      groupId: input.groupId,
      kind: input.kind,
      season: ctx.group.season,
      week: input.kind === "pick" ? ctx.week : null,
      userIds: input.userIds ?? [],
      leagueName: ctx.group.name,
      buyInCents: ctx.group.buy_in_cents ?? 0,
      deadlineIso: ctx.window?.lastKickoffIso ?? null,
      partiallyStarted: ctx.window?.partiallyStarted ?? false,
      appUrl: appUrl.replace(/\/$/, ""),
      now: ctx.now,
    });

    if (outcome.httpStatus >= 500) {
      console.error("[sendReminders] send failed", outcome.httpStatus, outcome.body);
      return { ok: false, error: "reminder_send_failed" };
    }

    const { data: after, error: afterError } = await supabase.rpc("reminder_status_for_admin", {
      p_group_id: input.groupId,
      p_season: ctx.group.season,
      p_season_type: "regular",
      p_week: ctx.week,
    });
    if (afterError) {
      console.error("[sendReminders] status re-read failed", afterError);
      return { ok: false, error: "reminder_status_unavailable" };
    }

    // Only the account page: this writes reminder_sends, which no page reads,
    // so unlike a poll it cannot move the standings or the picks boards.
    revalidatePath("/app/account");
    return {
      ok: true,
      data: { status: after, window: ctx.window, sent: outcome.body.sent ?? 0 },
    };
  });
}
