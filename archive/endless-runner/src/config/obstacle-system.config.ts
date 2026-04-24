/**
 * Obstacle System — tuning configuration and type registry
 * GDD: design/gdd/obstacle-system.md § Tuning Knobs, Obstacle Type Registry
 */

// ── Type Registry ─────────────────────────────────────────────────────────────

export interface ObstacleTypeDefinition {
  /** Display name used in pool exhaustion warnings. */
  name: string;
  /** Number of instances pre-allocated in the pool. */
  poolSize: number;
  /** Hitbox half-extents (full W×H×D). */
  hitbox: { w: number; h: number; d: number };
  /** Y position of the obstacle mesh center (= hitbox vertical midpoint). */
  centerY: number;
}

export const OBSTACLE_TYPE_REGISTRY: ReadonlyArray<ObstacleTypeDefinition> = [
  {
    name:       'Barrier',
    poolSize:   3,
    hitbox:     { w: 0.8, h: 1.0, d: 0.8 },
    centerY:    0.5,   // occupies Y 0–1.0; standing robot (0–1.8) collides; jump clears (base ≥ 2.7)
  },
  {
    name:       'Drone',
    poolSize:   3,
    hitbox:     { w: 0.8, h: 0.5, d: 0.8 },
    centerY:    1.25,  // occupies Y 1.0–1.5; standing robot collides; crouched top 0.9 < 1.0 — slide clears
  },
];

// ── System Config ─────────────────────────────────────────────────────────────

export interface ObstacleSystemConfig {
  /** Seconds between spawn attempts. Clamped to minSpawnInterval at runtime. Range: 0.3–5.0. */
  spawnInterval: number;
  /** Z distance ahead of robot where obstacles are placed. Range: 15–60. */
  spawnDistance: number;
  /** Z past robot that triggers obstacle recycle. Range: 1–15. */
  recycleThreshold: number;
  /** Minimum Z gap between a new spawn and any active obstacle. Range: 3–20. */
  minObstacleGap: number;
  /** Hard floor for setSpawnInterval() calls. */
  minSpawnInterval: number;
}

export const OBSTACLE_SYSTEM_CONFIG: ObstacleSystemConfig = {
  spawnInterval:    2.0,
  spawnDistance:    30,
  recycleThreshold: 5,
  minObstacleGap:   8,
  minSpawnInterval: 0.3,
};
