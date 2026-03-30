/**
 * Environment Renderer — tuning configuration
 * GDD: design/gdd/environment-renderer.md § Tuning Knobs
 */

export interface EnvironmentRendererConfig {
  /** Number of chunks in the recycle pool. Range: 3–8. */
  chunkCount: number;
  /** Z-depth of each chunk in world units. Range: 10–40. */
  chunkLength: number;
  /** Distance past the robot (Z=0) before a chunk's back face triggers recycle. Range: 2–10. */
  recycleBuffer: number;
  /** Distance from center lane to each outer lane. Range: 2–5. */
  laneSpacing: number;
  /** Forward scroll speed at run start, before Difficulty Curve overrides. Range: 4–12. */
  initialScrollSpeed: number;
  /**
   * Max allowed frame delta in seconds. Prevents frame-spike teleports.
   * Range: 0.05–0.2.
   */
  deltaClamp: number;
  /** Total lane surface width (all 3 lanes). Derived: 2 × laneSpacing + laneWidth. */
  laneWidth: number;
}

export const ENVIRONMENT_RENDERER_CONFIG: EnvironmentRendererConfig = {
  chunkCount:         4,
  chunkLength:        20,
  recycleBuffer:      5,
  laneSpacing:        3,
  initialScrollSpeed: 8,
  deltaClamp:         0.1,
  laneWidth:          8,   // total surface width — wider than playfield for visual margin
};
