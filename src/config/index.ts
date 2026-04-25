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
    /**
     * Sprint Race event tunables consumed by `createSprintRaceModule`
     * (`src/sim/sprint-race.ts`). See design/gdd/sprint-race-event-module.md
     * §7 for ranges and tuning rationale. v1 starting values are calibrated
     * for arena-01 (240 m course) to produce a ~40–50 s race at 60 Hz.
     */
    sprintRace: {
      /**
       * Course-velocity baseline in m/s. Multiplied by `stat.speed`
       * (range ~0.5–1.3) and per-tick modifiers. Range 1–20.
       */
      baseSpeedMps: 6,

      /**
       * Multiplier on velocity from caution. Effective slowdown is
       * `stat.caution * cautionScale`, capped by `stat.caution ≤ 1`.
       * Range 0–0.5.
       */
      cautionScale: 0.2,

      /**
       * Per-tick velocity jitter amplitude scaled by chaos. Effective jitter
       * is `±stat.chaos * chaosScale`. Range 0–0.5.
       */
      chaosScale: 0.15,
    },

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
    /**
     * Default URL for the Arena Loader's `arenaSource` (S5-03). Switch
     * this to point at a different `arena-NN.json` for arena rotation.
     * See design/gdd/arena-loader.md §7.
     */
    defaultArenaPath: '/assets/data/arenas/arena-01.json',
  },

  camera: {
    /**
     * Follow-Leader mode parameters (S6-03 spike). The camera tracks the
     * highest-X active robot, keeping a fixed offset and lookAt height
     * derived from the Sprint 4 placeholder camera — same view, just
     * sliding along the arena.
     */
    follow: {
      /** Camera height above ground plane. */
      offsetY: 14,
      /** Camera offset along world +Z (the spectator side of the arena). */
      offsetZ: 28,
      /** lookAt height above ground plane. */
      lookAtY: 1,
      /**
       * Position-tracking smoothing rate, in 1/seconds. Higher = snappier,
       * lower = floatier. The leader's X position is dt-independent
       * exponentially smoothed: alpha = 1 - exp(-rate * dt).
       */
      lerpRatePerSecond: 4.0,
    },
  },

  build: {
    /** Built-time trait JSON, generated from design/data/robots-traits.csv. */
    traitsJsonPath: '/traits.json',
  },
} as const;

export type Config = typeof CONFIG;
