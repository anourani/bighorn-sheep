/*
 * On-demand schedule loader — the one-time "go fetch the season" button.
 *
 * Open this in a browser with the secret and it walks the whole NFL season
 * (preseason weeks 1-4, then regular weeks 1-18) through the ESPN provider and
 * upserts every game into Postgres. After that the scheduled scorer keeps kickoff
 * times, statuses, and scores current on its own; you only come back here if the
 * league republishes the schedule wholesale.
 *
 *   https://<site>/.netlify/functions/load-schedule?key=<CRON_SECRET>
 *
 * Optional query parameters:
 *   season=2026        which season to load (default: current UTC year)
 *   phase=pre|regular  load only one phase (default: both)
 *   weeks=1-6          restrict to a week range (or a comma list: 1,2,3)
 *   budget=8000        ms to spend fetching before stopping cleanly
 *   dry=1              fetch and report, write nothing
 *
 * A full season is 22 upstream requests, which can brush against a synchronous
 * function's execution limit. Two things make that survivable: each week's games
 * are written AS THEY ARRIVE, so a timeout still leaves real progress behind, and
 * the walk stops itself once `budget` is spent and reports exactly which weeks it
 * did not reach. Re-opening the link resumes — every write is an upsert on the
 * provider's game id, so repeating work is free. `phase` and `weeks` are there to
 * carve the job up by hand if it ever needs to be.
 *
 * NOT scheduled — no `config.schedule` — so it only ever runs when someone asks.
 * Writes use the Supabase service role, which is what makes this possible at all:
 * `games` has a SELECT policy and no INSERT policy, so browsers can read the
 * schedule and nothing but the service key can write it.
 *
 * Responds in plain text rather than JSON, because the person opening it is
 * reading it, not parsing it.
 *
 * Netlify v2 function: default export taking a Request.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/types";
import { getNflProvider } from "../../src/lib/providers";
import { checkCronSecret } from "../../src/lib/cron-auth";
import { fetchSchedule, summarize, upsertGames } from "../../src/lib/nfl/schedule";
import type { SeasonType } from "../../src/lib/nfl/types";

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export default async function handler(request: Request): Promise<Response> {
  const auth = checkCronSecret(request, process.env.CRON_SECRET);
  if (!auth.ok) return text(`${auth.reason}\n`, auth.status);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    // Loudly, not silently. A silent skip here is indistinguishable from success
    // and would leave someone waiting for a schedule that is never coming.
    return text(
      "Cannot load the schedule: SUPABASE_SERVICE_ROLE_KEY (and/or\n" +
        "NEXT_PUBLIC_SUPABASE_URL) is not set in this environment.\n\n" +
        "Set it under Site configuration -> Environment variables in Netlify, then\n" +
        "redeploy and open this link again.\n",
      503,
    );
  }

  const params = new URL(request.url).searchParams;
  const season = Number(params.get("season") ?? new Date().getUTCFullYear());
  if (!Number.isInteger(season) || season < 1990 || season > 2100) {
    return text(`"${params.get("season")}" is not a season year.\n`, 400);
  }

  const phase = params.get("phase");
  if (phase !== null && phase !== "pre" && phase !== "regular") {
    return text(`phase must be "pre" or "regular" (got "${phase}").\n`, 400);
  }
  const seasonTypes: SeasonType[] = phase ? [phase] : ["pre", "regular"];
  const dryRun = params.get("dry") === "1";

  let weeks: number[] | undefined;
  const weeksParam = params.get("weeks");
  if (weeksParam) {
    const parsed = parseWeeks(weeksParam);
    if (!parsed) return text(`Could not read weeks="${weeksParam}". Try 1-6 or 1,2,3.\n`, 400);
    weeks = parsed;
  }

  // Leave headroom under the platform's execution limit so we stop ourselves and
  // report, rather than being killed with a half-finished job and no output.
  const budgetMs = Number(params.get("budget") ?? 8000);
  if (!Number.isFinite(budgetMs) || budgetMs < 500) {
    return text(`budget must be a number of milliseconds >= 500.\n`, 400);
  }

  const startedAt = Date.now();
  const supabase =
    dryRun ? null : createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

  // Write each week as it lands. A timeout then costs only the weeks not yet
  // reached, instead of discarding the entire walk.
  let upserted = 0;
  let writeError: string | null = null;

  const result = await fetchSchedule(getNflProvider(), {
    season,
    seasonTypes,
    weeks,
    onWeek: async (outcome) => {
      if (supabase && outcome.games.length > 0 && !writeError) {
        const write = await upsertGames(supabase, outcome.games);
        upserted += write.upserted;
        if (write.error) {
          writeError = write.error;
          return false; // stop: every subsequent write would fail the same way
        }
      }
      return Date.now() - startedAt < budgetMs;
    },
  });
  const summary = summarize(result);

  const lines: string[] = [];
  lines.push(`NFL ${season} schedule load${dryRun ? " (DRY RUN — nothing written)" : ""}`);
  lines.push("=".repeat(58));
  lines.push("");

  for (const group of ["pre", "regular", "post"] as SeasonType[]) {
    const groupLines = summary.lines.filter((l) => l.seasonType === group);
    if (groupLines.length === 0) continue;
    lines.push(group === "pre" ? "Preseason" : group === "regular" ? "Regular season" : "Postseason");
    for (const line of groupLines) {
      const noun = line.games === 1 ? "game" : "games";
      lines.push(`  week ${String(line.week).padStart(2)}   ${String(line.games).padStart(3)} ${noun}`);
    }
    lines.push(`  ${"".padStart(9)}${String(summary.totals[group]).padStart(3)} total`);
    lines.push("");
  }

  if (result.games.length === 0) {
    lines.push("No games returned. Either the season has not been published yet or the");
    lines.push("upstream feed changed shape. Nothing was written.");
    if (summary.errors.length > 0) {
      lines.push("");
      for (const e of summary.errors) lines.push(`  ${e.seasonType} week ${e.week}: ${e.error}`);
    }
    return text(`${lines.join("\n")}\n`, 502);
  }

  lines.push(`First kickoff: ${summary.firstKickoff}`);
  lines.push(`Last kickoff:  ${summary.lastKickoff}`);
  lines.push("");

  if (summary.errors.length > 0) {
    lines.push(`${summary.errors.length} week(s) could not be fetched and were skipped:`);
    for (const e of summary.errors) lines.push(`  ${e.seasonType} week ${e.week}: ${e.error}`);
    lines.push("Re-open this link to retry them; loading is idempotent.");
    lines.push("");
  }

  if (summary.rejected.length > 0) {
    lines.push(`${summary.rejected.length} game(s) skipped — unrecognized team code:`);
    for (const r of summary.rejected) lines.push(`  ${r.id}: ${r.away} @ ${r.home}`);
    lines.push("");
  }

  if (dryRun) {
    lines.push(`Dry run complete in ${Date.now() - startedAt}ms. Nothing was written.`);
    lines.push("Remove &dry=1 to load these games.");
    return text(`${lines.join("\n")}\n`);
  }

  if (writeError) {
    lines.push(`FAILED. ${upserted} game(s) were written before the error:`);
    lines.push(`  ${writeError}`);
    lines.push("");
    lines.push("Loading is idempotent — fix the cause and open this link again; the");
    lines.push("games already written will simply be rewritten.");
    return text(`${lines.join("\n")}\n`, 500);
  }

  lines.push(`Loaded ${upserted} games in ${Date.now() - startedAt}ms.`);

  // Never let a bounded run look like a complete one.
  if (result.stoppedEarly && result.skipped.length > 0) {
    lines.push("");
    lines.push(`STOPPED EARLY after ${budgetMs}ms — ${result.skipped.length} week(s) not fetched:`);
    for (const s of result.skipped) lines.push(`  ${s.seasonType} week ${s.week}`);
    lines.push("");
    lines.push("Everything above IS saved. Open the link again to pick up the rest, or");
    lines.push("do it in halves with &phase=pre and &phase=regular.");
    return text(`${lines.join("\n")}\n`, 206);
  }

  lines.push("");
  lines.push("The picks screen should now show every week. Scores and any schedule");
  lines.push("changes are picked up automatically from here on by poll-scores.");
  return text(`${lines.join("\n")}\n`);
}

/** `1-6` or `1,2,3` → week numbers. Returns null on anything unparseable. */
function parseWeeks(raw: string): number[] | null {
  const range = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from < 1 || to < from || to > 30) return null;
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }

  const list = raw.split(",").map((s) => Number(s.trim()));
  if (list.length === 0 || list.some((n) => !Number.isInteger(n) || n < 1 || n > 30)) return null;
  return list;
}
