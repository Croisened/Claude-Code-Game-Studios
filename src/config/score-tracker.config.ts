/**
 * Score & Distance Tracker — tuning configuration
 * GDD: design/gdd/score-and-distance-tracker.md § Tuning Knobs
 */

export interface ScoreTrackerConfig {
  /**
   * Maximum deltaTime applied to distance formula (seconds).
   * Prevents phantom distance on tab-return spikes. Range: 0.016–0.1.
   */
  deltaClamp: number;
}

export const SCORE_TRACKER_CONFIG: ScoreTrackerConfig = {
  deltaClamp: 0.05,
};
