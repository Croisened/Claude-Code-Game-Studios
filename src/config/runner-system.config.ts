/**
 * Runner System — tuning configuration
 * GDD: design/gdd/runner-system.md § Tuning Knobs
 */

export interface RunnerSystemConfig {
  /** Run-start speed (units/s). Used only before DifficultyCurve applies stage 0. Range: 4–12. */
  initialScrollSpeed: number;
  /** Speed cap (units/s). Guards against DifficultyCurve misconfiguration. Range: 15–40. */
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
  /** Standing collider height (units). */
  standingH: number;
  /** Crouched collider height when sliding (units). */
  crouchedH: number;
  /** Collider width (units). */
  colliderW: number;
  /** Collider depth (units). */
  colliderD: number;
  /** Maximum delta clamp (s). Prevents movement overshoot on frame spikes. Range: 0.05–0.2. */
  deltaClamp: number;
}

export const RUNNER_SYSTEM_CONFIG: RunnerSystemConfig = {
  initialScrollSpeed: 8,
  maxSpeed:           25,
  jumpForce:          12,
  gravity:            30,
  groundY:            0,
  landingEpsilon:     0.05,
  slideDuration:      600,
  standingH:          1.8,
  crouchedH:          0.9,
  colliderW:          1.0,
  colliderD:          0.8,
  deltaClamp:         0.1,
};
