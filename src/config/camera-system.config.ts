/**
 * Camera System — tuning configuration
 * GDD: design/gdd/camera-system.md § Tuning Knobs
 */

export interface CameraSystemConfig {
  /** Field of view in degrees. Range: 60–90. */
  fov: number;
  /** Camera X lerp speed per second. Higher = snappier. Range: 2–20. */
  xLerpFactor: number;
  /** Fixed Z position (behind robot at Z=0). Range: 5–15. */
  zOffset: number;
  /** Fixed Y position (above ground). Range: 1.5–6. */
  yOffset: number;
  /** Z distance ahead of robot for the look-at target. Range: 2–10. */
  lookAheadDistance: number;
  /** Max frame delta in seconds. Prevents lerp overshoot on frame spikes. */
  deltaClamp: number;
  /** Near clipping plane. */
  near: number;
  /** Far clipping plane. */
  far: number;
}

export const CAMERA_SYSTEM_CONFIG: CameraSystemConfig = {
  fov:             75,
  xLerpFactor:     8.0,
  zOffset:         8,
  yOffset:         3,
  lookAheadDistance: 5,
  deltaClamp:      0.1,
  near:            0.1,
  far:             100,
};
