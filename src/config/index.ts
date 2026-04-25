/**
 * Robo Rhapsody Sim — Config Module.
 *
 * Single source of truth for every tunable value in the project. See
 * design/gdd/config-module.md for the full contract.
 *
 * Rules of engagement:
 * - Always import as `import { CONFIG } from '@/config'` — never destructure
 *   at import time.
 * - Mutating `CONFIG` is a TypeScript error and a code-review violation.
 * - Values that change at runtime are state, not config.
 */

export const CONFIG = {
  sim: {
    /** Hz. Internal sim tick rate. Higher = smoother, more CPU. Range 30–120. */
    tickRateHz: 60,

    /** Default RNG seed for ad-hoc dev runs. Production sims pass an explicit seed. */
    defaultSeed: 1,

    /**
     * Trait → Stat coefficients consumed by `deriveStats` (`src/sim/trait-to-stat.ts`).
     * See design/gdd/trait-to-stat-derivation.md §4 (formulas) and §7 (knob ranges).
     * v1 starting values lifted from design/gdd/game-concept.md §Trait-to-Behavior
     * Mapping; tuning happens during Sprint 6+ when behavior is observable.
     */
    traitToStat: {
      speed: {
        base: 0.5,
        fullSendCoeff: 0.8,
      },
      acceleration: {
        base: 0.4,
        fullSendCoeff: 1.0,
        doubterCoeff: 0.3,
      },
      handling: {
        base: 0.5,
        cipherCoeff: 0.5,
        fullSendCoeff: 0.2,
      },
      pathfinding: {
        base: 0.3,
        cipherCoeff: 0.7,
      },
      caution: {
        doubterCoeff: 1.0,
      },
      chaos: {
        degenCoeff: 1.0,
      },
      grace: {
        altruistCoeff: 1.0,
      },
    },
  },

  renderer: {
    /**
     * Total robot instances rendered each event. Spec calls for 85; lower
     * as performance fallback. Range 10–85.
     */
    robotCount: 85,

    /** Path to the rigged robot GLB (geometry + run clip source). */
    robotGlbPath: 'assets/art/characters/robot/robot_run.glb',

    /** Path to the idle-clip GLB. Clip-only; geometry comes from `robotGlbPath`. */
    idleGlbPath: 'assets/art/characters/robot/robot_idle.glb',

    /** Path to the death-clip GLB. Clip-only; geometry comes from `robotGlbPath`. */
    deathGlbPath: 'assets/art/characters/robot/robot_death.glb',

    /** Filename pattern for per-robot skin textures; `{id}` substitutes 0–84. */
    skinTexturePathPattern: 'assets/art/characters/robot/skins/{id}.png',

    /**
     * When true, skip skeleton updates for robots outside the camera frustum.
     * Performance fallback if 85-instance rendering can't sustain 60fps.
     */
    frustumCullSkeletons: false,

    /** Target render frame rate, used for diagnostics. */
    targetFps: 60,
  },

  animation: {
    /** Seconds. Crossfade duration between animation states. Range 0.05–1.0. */
    crossfadeSeconds: 0.2,

    /** State played by default for living robots in motion. */
    defaultState: 'run',

    /** Animation states recognised in v1. */
    validStates: ['run', 'idle', 'death'],
  },

  arena: {
    // Subsystem reserved — populated in Sprint 5 with Arena Loader.
  },

  camera: {
    // Subsystem reserved — populated in Sprint 6 with Camera System.
  },

  build: {
    /** Built-time trait JSON, generated from design/data/robots-traits.csv. */
    traitsJsonPath: '/traits.json',
  },
} as const;

export type Config = typeof CONFIG;
