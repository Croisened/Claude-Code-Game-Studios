/**
 * Milestone System — configuration
 * GDD: design/gdd/distance-milestone-badges.md § Tuning Knobs
 */

export interface MilestoneDefinition {
  /** Distance threshold in meters to unlock this tier. */
  threshold: number;
  /** Display name shown on the death screen. */
  name: string;
}

export interface MilestoneSystemConfig {
  /** Ordered list of milestone tiers (ascending threshold). */
  milestones: MilestoneDefinition[];
  /** Distance interval (meters) at which lightning VFX fires. */
  lightningInterval: number;
  /** Number of lightning bolts per trigger (one per lane). */
  lightningBoltCount: number;
  /** Milliseconds between each bolt firing (stagger). */
  lightningStaggerMs: number;
  /** Total fade duration (ms) for each bolt after it fires. */
  lightningDurationMs: number;
  /** localStorage key prefix for milestone persistence. */
  storageKeyPrefix: string;
  /** localStorage key for guest (no skin ID) players. */
  guestStorageKey: string;
  /** Supabase REST table name for milestone persistence. */
  supabaseTable: string;
}

export const MILESTONE_SYSTEM_CONFIG: MilestoneSystemConfig = {
  milestones: [
    { threshold: 500,  name: 'Outer Grid' },
    { threshold: 1000, name: 'Industrial Corridor' },
    { threshold: 2500, name: 'Neon Quarter' },
    { threshold: 5000, name: 'The Core' },
  ],
  lightningInterval:   1000,
  lightningBoltCount:  3,
  lightningStaggerMs:  100,
  lightningDurationMs: 400,
  storageKeyPrefix:    'neon_fugitive_milestone_',
  guestStorageKey:     'neon_fugitive_milestone_guest',
  supabaseTable:       'milestones',
};
