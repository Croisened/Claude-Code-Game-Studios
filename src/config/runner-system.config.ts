/**
 * Runner System — tuning configuration
 * GDD: design/gdd/runner-system.md § Tuning Knobs
 */

export interface RunnerSystemConfig {
  /** Run-start speed (units/s). Range: 4–12. */
  initialScrollSpeed: number;
  /** Speed increase per second (units/s²). 0 = constant speed. Range: 0–2. */
  mvpSpeedRampRate: number;
  /** Speed cap (units/s). Range: 15–40. */
  maxSpeed: number;
  /** Upward impulse magnitude on jump. Range: 6–18. */
  jumpForce: number;
  /** Simulated downward gravity (units/s²). Range: 15–40. */
  gravity: number;
  /** Robot floor Y position. */
  groundY: number;
  /** Landing detection tolerance (units). Range: 0.01–0.2. */
  landingEpsilon: number;
  /** Duration of slide before auto-stand (ms). Range: 300–1200. */
  slideDuration: number;
}

export const RUNNER_SYSTEM_CONFIG: RunnerSystemConfig = {
  initialScrollSpeed: 8,
  mvpSpeedRampRate:   0.5,
  maxSpeed:           25,
  jumpForce:          12,
  gravity:            30,
  groundY:            0,
  landingEpsilon:     0.05,
  slideDuration:      600,
};
