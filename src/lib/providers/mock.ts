import type { Game } from "../nfl/types";
import { WEEK_GAMES } from "../mock/data";
import type { NflProvider, WeekQuery } from "./types";

/**
 * Fixture-backed provider used for local dev, tests, and rendering the app with
 * no external dependency. Returns the bundled demo slate for a week, or an empty
 * array (interpreted by the UI as "schedule not yet released") for weeks with no
 * fixture.
 */
export class MockProvider implements NflProvider {
  readonly name = "mock";

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWeekGames(query: WeekQuery): Promise<Game[]> {
    return WEEK_GAMES[query.week] ?? [];
  }
}
