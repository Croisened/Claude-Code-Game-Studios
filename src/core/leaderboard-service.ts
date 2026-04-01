/**
 * Leaderboard Service
 *
 * Submits scores to and fetches top scores from Supabase via the REST API.
 * No Supabase JS SDK — plain fetch() only.
 *
 * submitScore() — fire-and-forget; call on → Dead.
 * fetchTop10()  — returns top N rows ordered by score DESC; call on ScoreScreen.
 *
 * GDD: design/gdd/leaderboard.md
 */

import { LEADERBOARD_CONFIG, type LeaderboardConfig } from '../config/leaderboard.config';

export interface LeaderboardEntry {
  player_id: string;
  score:     number;
}

// ── LeaderboardService ────────────────────────────────────────────────────────

export class LeaderboardService {
  constructor(private readonly _config: LeaderboardConfig = LEADERBOARD_CONFIG) {}

  /**
   * Submit a score to the leaderboard. Fire-and-forget — errors are logged and
   * swallowed so a network failure never disrupts the game flow.
   * Skips submission if score is 0.
   *
   * @param playerId - NFT skin ID or 'Guest'
   * @param score    - meters (integer)
   *
   * @example
   * leaderboardService.submitScore('42', 1500);
   */
  submitScore(playerId: string, score: number): void {
    if (score <= 0) return;

    const { supabaseUrl, supabaseAnonKey } = this._config;
    const url = `${supabaseUrl}/rest/v1/scores`;

    fetch(url, {
      method:  'POST',
      headers: this._headers(),
      body:    JSON.stringify({ player_id: playerId, score }),
    }).catch((err) => {
      console.error('[LeaderboardService] submitScore failed:', err);
    });
  }

  /**
   * Fetch the top N scores ordered by score descending.
   * Rejects on network error or non-2xx response — callers should catch.
   *
   * @example
   * const entries = await leaderboardService.fetchTop10();
   */
  async fetchTop10(): Promise<LeaderboardEntry[]> {
    const { supabaseUrl, supabaseAnonKey, topN } = this._config;
    const url = `${supabaseUrl}/rest/v1/scores?select=player_id,score&order=score.desc&limit=${topN}`;

    const res = await fetch(url, { headers: this._headers() });

    if (!res.ok) {
      throw new Error(`[LeaderboardService] fetch failed: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<LeaderboardEntry[]>;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _headers(): Record<string, string> {
    const { supabaseAnonKey } = this._config;
    return {
      'apikey':        supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Content-Type':  'application/json',
    };
  }
}
