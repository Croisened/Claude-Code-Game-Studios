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

      /**
       * Boids-style lateral separation. Each tick every active robot is
       * pushed along world Z (perpendicular to motion) away from active
       * neighbors that fall inside `separationRadius`. Force magnitude
       * falls off linearly from `separationForceMps` at distance 0 to
       * 0 at the radius.
       *
       * Range guidance: radius 1.0–3.0 (units), force 2–10 (m/s).
       * Larger radius spreads the pack; larger force separates faster.
       *
       * Determinism: the rule reads pose state in id-ascending order —
       * the same order the engine iterates motion in — so output is
       * byte-identical for a fixed seed. No `rng()` calls are made
       * inside the separation rule.
       */
      separationRadius: 1.6,
      separationForceMps: 6.0,
      /**
       * |Δz| threshold below which two robots are treated as "in the
       * same lane" for separation purposes. The radial push goes to
       * zero as `dz / dist → 0`, so coincident-lane robots would phase
       * through each other; this threshold triggers a deterministic
       * id-based tiebreak (smaller id pushes toward +Z, larger toward
       * -Z) that nudges them onto different sides within a few ticks.
       */
      separationCoincidentLaneEps: 0.05,
      /**
       * Lateral safety margin from the arena's z-bounds (`±width/2`).
       * Prevents the separation push from launching robots over the
       * edge of the visible arena.
       */
      lateralBoundMargin: 0.5,
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

    /**
     * Uniform scale applied to every cloned robot instance at assembly
     * time. The GLB is authored at unit scale; sim positions and arena
     * geometry are unaffected (scale is purely visual). Range 0.5–4.
     */
    robotScale: 2,

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
     * Follow-Leader mode parameters (S6-03 spike). The camera sits AHEAD
     * of the leader (along +X) and looks BACK at a point trailing the
     * leader, tilted back so the field is visible behind. As the leader
     * advances, both the camera and the lookAt translate by the same
     * dx, holding the framing constant.
     */
    follow: {
      /** Camera offset ahead of leader along +X. Positive = camera leads. */
      aheadOffsetX: 10,
      /** Camera height above ground plane. */
      offsetY: 18,
      /** Camera offset along world +Z (the spectator side of the arena). */
      offsetZ: 16,
      /**
       * lookAt offset ahead of leader along +X. Negative = lookAt sits
       * behind the leader. Smaller magnitude (closer to 0) keeps the
       * leader near frame center; larger magnitude tilts the framing
       * deeper into the trailing field at the cost of pushing the
       * leader toward the foreground edge. -6 is the sweet spot at
       * `arena-01.json::startGrid.rowSpacing = 6` — leader sits ~12°
       * off-center while the field still reads behind.
       */
      lookAtAheadX: -6,
      /** lookAt height above ground plane. */
      lookAtY: 0.5,
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
