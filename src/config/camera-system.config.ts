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

  // ── Showcase mode (MainMenu + ScoreScreen) ──────────────────────────────────
  /** Z position for hero showcase — close to robot. Range: 2–6. */
  showcaseZOffset: number;
  /** Y position for hero showcase — near chest height. Range: 1–3. */
  showcaseYOffset: number;
  /** Y coordinate the showcase camera looks at (robot chest). Range: 0.5–2. */
  showcaseLookAtY: number;
  /** FOV during showcase — tighter for hero feel. Range: 50–75. */
  showcaseFov: number;
  /** Lerp speed for showcase ↔ gameplay transitions. Range: 1–6. */
  showcaseLerpFactor: number;
}

export const CAMERA_SYSTEM_CONFIG: CameraSystemConfig = {
  fov:                 75,
  xLerpFactor:         8.0,
  zOffset:             8,
  yOffset:             3,
  lookAheadDistance:   5,
  deltaClamp:          0.1,
  near:                0.1,
  far:                 100,

  showcaseZOffset:     3.5,
  showcaseYOffset:     1.8,
  showcaseLookAtY:     1.0,
  showcaseFov:         65,
  showcaseLerpFactor:  3.0,
};
