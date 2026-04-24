/**
 * Difficulty Curve — tuning configuration
 *
 * Defines distance-driven stages that control run speed and obstacle spawn
 * interval. Each stage activates when the player passes its distance threshold.
 * Stages must be sorted by distanceM ascending.
 *
 * GDD: design/gdd/difficulty-curve.md § Tuning Knobs
 */

export interface DifficultyCurveStage {
  /** Distance (metres) at which this stage activates. */
  distanceM: number;
  /** Forward speed (units/s) applied to RunnerSystem. */
  speed: number;
  /** Obstacle spawn interval (seconds) applied to ObstacleSystem. */
  spawnInterval: number;
}

export interface DifficultyCurveConfig {
  /** Ordered list of difficulty stages. Must start at distanceM: 0. */
  stages: ReadonlyArray<DifficultyCurveStage>;
}

export const DIFFICULTY_CURVE_CONFIG: DifficultyCurveConfig = {
  stages: [
    { distanceM:    0, speed:  8, spawnInterval: 2.0 },
    { distanceM:  100, speed: 10, spawnInterval: 1.8 },
    { distanceM:  250, speed: 13, spawnInterval: 1.5 },
    { distanceM:  500, speed: 17, spawnInterval: 1.2 },
    { distanceM:  800, speed: 21, spawnInterval: 0.9 },
    { distanceM: 1200, speed: 25, spawnInterval: 0.6 },
  ],
};
