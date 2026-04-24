/**
 * Robot Name Service
 *
 * Fetches the robot_names table from Supabase once at startup and caches
 * all 85 entries in a Map<id, name>. Provides synchronous name lookups
 * after loading completes.
 *
 * Usage:
 *   const svc = new RobotNameService();
 *   await svc.load(); // or fire-and-forget: svc.load().catch(...)
 *   svc.getName(84); // → 'Robo Rhapsody Mascot'
 */

import { LEADERBOARD_CONFIG, type LeaderboardConfig } from '../config/leaderboard.config';

interface RobotNameRow {
  id:   number;
  name: string;
}

export class RobotNameService {
  private readonly _names: Map<number, string> = new Map();

  constructor(private readonly _config: LeaderboardConfig = LEADERBOARD_CONFIG) {}

  /**
   * Fetch all robot names from Supabase and cache them.
   * Safe to call multiple times — subsequent calls are no-ops if already loaded.
   *
   * @example
   * await robotNameService.load();
   */
  async load(): Promise<void> {
    if (this._names.size > 0) return;

    const { supabaseUrl, supabaseAnonKey } = this._config;
    const url = `${supabaseUrl}/rest/v1/robot_names?select=id,name&order=id.asc`;

    const res = await fetch(url, {
      headers: {
        'apikey':        supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
    });

    if (!res.ok) {
      throw new Error(`[RobotNameService] Failed to load names: ${res.status} ${res.statusText}`);
    }

    const rows = await res.json() as RobotNameRow[];
    for (const row of rows) {
      this._names.set(row.id, row.name);
    }
  }

  /**
   * Look up a robot name by NFT ID.
   * Returns an empty string if names haven't loaded or the ID has no entry.
   *
   * @example
   * robotNameService.getName(84); // → 'Robo Rhapsody Mascot'
   * robotNameService.getName(999); // → ''
   */
  getName(id: number | string): string {
    const key = typeof id === 'string' ? parseInt(id, 10) : id;
    return this._names.get(key) ?? '';
  }
}
