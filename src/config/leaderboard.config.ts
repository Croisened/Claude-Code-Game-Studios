/**
 * Leaderboard System — configuration
 * GDD: design/gdd/leaderboard.md § Tuning Knobs
 */

export interface LeaderboardConfig {
  /** Supabase project URL. Sourced from VITE_SUPABASE_URL. */
  supabaseUrl: string;
  /** Supabase anon/public key. Sourced from VITE_SUPABASE_ANON_KEY. */
  supabaseAnonKey: string;
  /** Number of top scores to fetch and display. */
  topN: number;
  /** Max characters to display for a player ID in the table. */
  playerIdMaxDisplay: number;
}

export const LEADERBOARD_CONFIG: LeaderboardConfig = {
  supabaseUrl:        import.meta.env['VITE_SUPABASE_URL']      as string ?? '',
  supabaseAnonKey:    import.meta.env['VITE_SUPABASE_ANON_KEY'] as string ?? '',
  topN:               20,
  playerIdMaxDisplay: 20,
};
