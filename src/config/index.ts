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

    /**
     * Maze Race event tunables consumed by `createMazeRaceModule`
     * (`src/sim/maze-race.ts`). v1 starting values are calibrated for
     * arena-02 (21x21 grid × 4 m cells = 84 m square) so a typical
     * shortest path of ~25 cells finishes in 25–40 seconds at 60 Hz.
     */
    mazeRace: {
      /**
       * Course-velocity baseline in m/s. Lower than sprint-race because
       * robots steer along grid axes (with frequent direction changes
       * at corners), so an apples-to-apples baseline reads slower.
       * Range 1–10.
       */
      baseSpeedMps: 4.5,

      /** Multiplier on velocity from caution. Range 0–0.5. */
      cautionScale: 0.2,

      /** Per-tick velocity jitter amplitude scaled by chaos. Range 0–0.5. */
      chaosScale: 0.15,

      /**
       * Distance below which a robot is "at" its current target cell and
       * advances to the next cell on its shortest path. Smaller = sharper
       * corners (robots overshoot less); larger = smoother but cuts
       * corners visually. 0.4–0.8 reads natural at cellSize=4 m.
       */
      cellArrivalRadius: 0.6,

      /**
       * Boids-style 2D separation push. Each tick every active robot is
       * pushed radially away from active neighbors inside `separationRadius`.
       * Force magnitude falls off linearly from `separationForceMps` at
       * distance 0 to 0 at the radius. Mirrors sprint-race's separation
       * rule but operates in both X and Z (maze motion is multi-axial).
       *
       * Determinism: pose state is read in id-ascending order, matching
       * the engine's iteration. No `rng()` calls are made.
       */
      separationRadius: 1.4,
      separationForceMps: 5.0,
      /**
       * |dist| below which two robots are treated as coincident. Their
       * radial push goes to zero as `dist → 0`, so coincident robots
       * would phase through each other; this threshold triggers a
       * deterministic id-based tiebreak (smaller id pushes +X, larger
       * pushes -X) that nudges them onto different sides within a few
       * ticks.
       */
      separationCoincidentEps: 0.05,

      /**
       * Margin from each cell's wall when clamping the post-separation
       * position. Effective corridor half-width = `cellSize/2 - wallMargin`.
       * Larger margin → wider visual gap between robots and walls but
       * narrower passable corridor. 0.55–0.7 reads natural at the
       * default `robotScale = 2`.
       */
      wallMargin: 0.6,

      /**
       * Cap on per-junction wrong-turn probability. At a junction with
       * an alternative to the optimal direction, robot rolls
       * `pMistake = (1 - stat.pathfinding) * mistakeMaxRate` and takes
       * a wrong turn if the roll passes. `pathfinding` is Cipher-driven
       * (range ~0.3–1.0), so the realized mistake rate spans
       * `[0, 0.7 × mistakeMaxRate]`.
       *
       * Tuning: the maze has ~30 true junctions on a typical shortest
       * path; max-Full-Send robots run ~40% faster than the field. To
       * make Cipher a meaningful counter to raw speed, low-Cipher
       * robots need to lose enough time to backtracking that pure-speed
       * builds can't run away. Empirically, `mistakeMaxRate = 0.6`
       * gives low-Cipher (~21%) ≈12 wrong turns over a typical race —
       * roughly 16s of detours, enough to wipe out the speed advantage
       * of a max-Full-Send / min-Cipher build. High-Cipher (Cipher 90+)
       * stays under 4% per junction, ~1 mistake per race. Range 0–0.7.
       */
      mistakeMaxRate: 0.6,

      /**
       * **Lever 2 (S7-02)** — finish-cell grace window in ticks. After
       * the first robot enters the finish cell, the race stays "open"
       * for this many ticks; any other robot that reaches the finish
       * within the window is also emitted as a `finish` event (place
       * 2, 3, …) instead of being culled with `race_over`. Creates
       * photo-finish drama when a leading robot is barely ahead.
       *
       * 4 ticks = 67ms at 60Hz tickRate. At default speed 4.5 m/s with
       * 60Hz, robots cover ~30cm/tick — so trailing robots within
       * ~1.2m of the finish at the moment of first arrival can still
       * co-finish. Range 0–10. Set to 0 to disable.
       */
      finishGraceTicks: 4,

      /**
       * **Lever 3 (S7-02)** — chaos-driven feint at junctions. On top
       * of the pathfinding-driven `pMistake`, a chaos-weighted slice
       * `pFeint = stat.chaos * chaosFeintScale` of the [0, 1) roll
       * also picks a non-optimal candidate. Effective per-junction
       * non-optimal rate becomes `pMistake + pFeint` (capped at 1).
       *
       * Effect: high-Degen robots second-guess at junctions even when
       * their Cipher would otherwise have them taking optimal. Adds
       * unpredictability without eliminating Cipher's value — a
       * max-Degen / max-Cipher robot still navigates well most of the
       * time. Range 0–0.3. Default 0.15: at chaos=1 adds ~15%
       * per-junction feint rate.
       */
      chaosFeintScale: 0.15,

      /**
       * **Lever 5 (S7-02)** — wrong-turn recovery bonus duration in
       * ticks. After a robot takes a non-optimal candidate, this many
       * subsequent ticks have `pMistake` reduced (see
       * `recoveryBonusFactor`). Models "I just messed up, I'd better
       * focus" — makes mistakes survivable without removing them.
       * Range 0–60. Default 6: a few junction-encounters' worth.
       */
      recoveryBonusTicks: 6,

      /**
       * **Lever 5 (S7-02)** — multiplicative reduction on `pMistake`
       * during the recovery window. `pMistake_effective = pMistake *
       * (1 - recoveryBonusFactor)`. Range 0–1. Default 0.5: halves
       * the per-junction mistake rate during recovery.
       *
       * Determinism note: recovery is per-robot state mutated only
       * during pickNextCell — no rng() calls beyond the existing one;
       * output is byte-identical for a fixed seed.
       */
      recoveryBonusFactor: 0.5,
    },

    /**
     * Obstacle Gauntlet event tunables consumed by
     * `createObstacleGauntletModule` (`src/sim/obstacle-gauntlet.ts`).
     * v1 starting values are calibrated for arena-03 (240 m linear
     * course with three trap stages: pits → hammers → bridge → finish).
     * Doubter-driven `stat.caution` is the favoured trait — it
     * counters fall probability in pit zones AND drives hammer
     * timing-aware slowdown.
     */
    gauntletRace: {
      /** Course-velocity baseline in m/s. Same scale as sprint-race. */
      baseSpeedMps: 6,

      /** Multiplier on velocity from caution. Range 0–0.5. */
      cautionScale: 0.2,

      /** Per-tick velocity jitter amplitude scaled by chaos. Range 0–0.5. */
      chaosScale: 0.15,

      /**
       * Per-tick fall probability while inside a pit zone. Multiplied
       * by `(1 - caution * cautionPitSafety)`. With default
       * `pitFallRatePerTick = 0.004` and `cautionPitSafety = 0.95`,
       * caution = 0.5 (median Doubter) robots fall at ~0.21%/tick.
       * Over an 18m pit zone at 6 m/s (~180 ticks), that's
       * cumulative ~31% fall rate — leaves ~58 survivors.
       *
       * Caution = 0 (no Doubter) → ~0.4%/tick, ~52% cumulative.
       * Caution = 1 (max Doubter) → ~0.02%/tick, ~3.6% cumulative.
       *
       * Tuning target per game-concept §3: Stage 1 cull thins the
       * field; not all of it. Combined with hammer + bridge stages
       * the cumulative survival rate at finish is ~10-15%.
       */
      pitFallRatePerTick: 0.0012,

      /** Per-unit-caution reduction in pit fall probability. Range 0.5–1. */
      cautionPitSafety: 0.95,

      /**
       * Hammer-aware slowdown lookahead distance in metres. At each
       * tick, every active robot scans for hammers within this
       * distance ahead and predicts the hammer's phase at arrival
       * time. If the hammer would be DOWN at arrival, the robot's
       * speed is multiplied by `(1 - caution * cautionHammerSlowdown)`
       * — high-caution robots slow to wait for the hammer to clear.
       *
       * Range 5–30 metres. Larger = robots react earlier to far
       * hammers; smaller = closer-to-trap braking. 12 m is roughly
       * 2 seconds at the default speed.
       */
      hammerLookaheadM: 12,

      /**
       * Per-unit-caution slowdown applied when a hammer ahead is
       * currently down. `factor = max(0, 1 - caution *
       * cautionHammerSlowdown)`. With default 1.8: caution ~ 0.55
       * gives factor 0 (full stop). Lower-caution robots brake but
       * keep moving — they need to luck out on hammer phase.
       *
       * The default is calibrated against the actual roster's Doubter
       * distribution (mean ~17/100, so caution ~ 0.17 average): most
       * robots brake but don't fully stop, taking their chances.
       * Robots with Doubter ≥ ~50 brake to 0 and reliably time their
       * pass.
       *
       * Range 0–3. Higher = more robots fully stop; lower = none do.
       */
      cautionHammerSlowdown: 1.8,

      /**
       * Boids-style 2D separation — same shape as sprint-race, slightly
       * lighter because gauntlet corridors are wider and we want robots
       * to occasionally bunch (to make hammer-cluster eliminations more
       * dramatic).
       */
      separationRadius: 1.4,
      separationForceMps: 4.5,
      separationCoincidentEps: 0.05,

      /**
       * Lateral safety margin from the arena's z-bounds (`±width/2`).
       * Same as sprint-race — keeps robots inside the visible arena.
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
    /** URL for Arena-02 (`maze-race`). Loaded when the route is `#peek-maze`. */
    mazeArenaPath: '/assets/data/arenas/arena-02.json',
    /** URL for Arena-03 (`obstacle-gauntlet`). Loaded when the route is `#peek-gauntlet`. */
    gauntletArenaPath: '/assets/data/arenas/arena-03.json',
  },

  camera: {
    /**
     * Follow-Leader mode parameters (S6-03 spike). The camera sits AHEAD
     * of the leader (along +X) and looks BACK at a point trailing the
     * leader, tilted back so the field is visible behind. As the leader
     * advances, both the camera and the lookAt translate by the same
     * dx, holding the framing constant.
     */
    /**
     * Maze-race overhead framing. Maze paths aren't monotonic in any
     * world axis, so "ahead of leader" loses meaning — the camera sits
     * directly above the leader with a slight back-tilt so the maze
     * walls + finish beacon stay visible around the leader's silhouette.
     */
    mazeFollow: {
      aheadOffsetX: 0,
      offsetY: 55,
      offsetZ: 22,
      lookAtAheadX: 0,
      lookAtY: 0.5,
      // Slower than sprint's 4.0 because the high-overhead view
      // amplifies any lateral target movement (small world delta →
      // larger screen delta). 2.5 keeps the camera responsive enough
      // to track corner turns while smoothing high-frequency wobble
      // when the leader id rotates within the hysteresis band.
      lerpRatePerSecond: 2.5,
    },
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
