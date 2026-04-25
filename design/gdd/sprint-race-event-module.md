# Sprint Race Event Module — Game Design Document

> **Status**: Approved
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S5-05
> **Tier**: M
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The **Sprint Race Event Module** is the first concrete implementation of the
`EventModule` interface defined by the Sim Engine Core (S5-04). It drives a
single sprint race from start grid to winner on any arena whose `type ===
'sprint-race'`.

The module owns three things:

1. **Per-tick robot motion.** Forward-only velocity along +X, derived from
   `stat.speed` and modulated by `stat.caution` (slowdown) and `stat.chaos`
   (per-tick jitter). Lane (z) is fixed at the start position; no lane
   changes in v1.
2. **Gate-crossing bookkeeping.** As robots cross each gate's X coordinate,
   they're enrolled in that gate's crossing list (id-tiebroken). When a
   gate's crossing list reaches `cullToCount`, the gate closes.
3. **Cull semantics.** Closing a non-final gate eliminates every active
   robot still behind it (`reason: '<gate>_closed'`). The final gate emits
   `finish` events for crossers (place assigned by the engine) and
   eliminates the rest with `reason: 'race_over'`.

What the module deliberately does **not** own:

- Tick cadence, RNG instantiation, pose-frame snapshots, timeline event
  ordering — that's the engine's job (S5-04).
- Arena geometry validation — the arena loader (S5-03) enforces that
  `gates[]` is well-formed (≥ 2 gates, strictly decreasing `cullToCount`,
  monotonic `x`, finish at `arena.length`).
- Trait → stat math — pre-derived at roster load time (S5-02).
- Render-side concerns (lane visualization, camera framing, animation
  state transitions) — Sprint 6+.

The implementation in `src/sim/sprint-race.ts` is ~140 LOC. M-tier reflects
the design surface (motion model + cull semantics + edge cases) being
larger than a loader but smaller than the engine itself.

---

## 2. Player Fantasy

The Sprint Race is the **legible** event. It's the first thing a new
spectator sees, and the rules need to be obvious in the first ten seconds:

> **"Run forward. Don't be last. Three checkpoints. Last one through wins."**

Three culls, decreasing field sizes, a clear finish line. The spectator can
predict the structure without being told it. Tension comes from knowing
*how many seats are left at the next gate* — 28 from 85 is brutal; 10 from
28 is tighter; 1 from 10 is a sprint to the line.

The traits-to-behavior mapping is intuitive in this event: high Full Send
robots blast off the line and lead the field. High Doubter robots hesitate
and get caught at the cull. High Degen robots are unpredictable —
sometimes they sprint past the leader, sometimes they fade. The event
favors Full Send (per game-concept.md §1), and the math should make that
visible to a watcher who's never seen the trait sheet.

Determinism is the substrate (Sim Engine GDD §2). The Sprint Race's
contribution to that promise is **reproducible cull moments**: "robot 47
got eliminated at gate A on tick 1,237" should be the same fact for every
spectator watching the same seed.

---

## 3. Detailed Rules

### Motion rules

- **R1.** Each tick, every active robot is iterated in id-ascending order
  for the motion phase. The motion update is:
  ```
  cautionFactor = 1 - stat.caution * cautionScale
  jitter        = 1 + (rng() * 2 - 1) * stat.chaos * chaosScale
  velocity      = baseSpeedMps * stat.speed * cautionFactor * jitter
  pose.x       += velocity * dtSeconds
  ```
  See §4 for variable definitions and ranges.
- **R2.** `rng()` is called **exactly once per active robot per tick** for
  the chaos jitter. Inactive robots do not consume the RNG. This pins
  determinism: the RNG state advances by `activeCount(tick)` per tick.
- **R3.** Robots only move forward. There is no negative-X motion in v1
  even with extreme jitter — the chaos bound `stat.chaos * chaosScale ≤
  0.5` (with `stat.chaos ≤ 1` and `chaosScale ≤ 0.5`, jitter ≥ 0.5) keeps
  velocity non-negative as long as `stat.speed > 0` (which is guaranteed
  by `traitToStat.speed.base = 0.5`).
- **R4.** Yaw is fixed at 0 for the entire run (sim convention: 0 = facing
  +X). v1 has no rotation; the test suite asserts this invariant.
- **R4a.** Lane (z) shifts each tick by a Boids-style separation push.
  Each active robot accumulates a lateral force from every other active
  robot inside `CONFIG.sim.sprintRace.separationRadius`, with magnitude
  ramping linearly from `separationForceMps` at zero distance to 0 at
  the radius. Same-lane catchups (where `|Δz| < separationCoincidentLaneEps`)
  use a deterministic id-tiebreak push (lower id pushes toward +Z, higher
  toward -Z). The pushed z is clamped to `±(arena.width / 2 - lateralBoundMargin)`
  so robots cannot leave the visible arena. The lateral push is z-only —
  X is reserved for forward motion (R3).
- **R5.** y is fixed at 0. The arena is a flat plane in v1.
- **R5a.** Starting slots are seed-permuted, not id-mapped. `init`
  builds a Fisher-Yates permutation `slotForId[i]` via
  `shuffledStartSlots(ctx.rng, ctx.roster.length)` (Arena Loader
  helper) and passes it to `buildStartPoses`. Robot identity (id,
  traits, skin) is preserved; only the (x, z) the robot starts at is
  shuffled. This is the primary source of race-to-race outcome
  variance in v1 — back-row draws have to run further, which can
  unseat the structural-speed favorite when combined with the arena's
  `rowSpacing = 6.0` stagger (24 m max delta vs. ~7.7 m structural
  lead for the top robot). Determinism preserved: the shuffle uses
  the same seeded `ctx.rng` and consumes exactly `roster.length - 1`
  rng draws at init.

### Gate-crossing rules

- **R6.** Gates are processed in `arena.gates` array order each tick (which
  is `x`-ascending per the arena loader contract).
- **R7.** A robot crosses gate `g` when, after the motion phase of some
  tick, it satisfies all three:
  - `pose.active === true`
  - `gatesCrossed[id] === g` (it crossed the prior gate but not this one)
  - `pose.x >= gate.x`
- **R8.** Within a tick, crossers for gate `g` are enrolled in id-ascending
  order. If multiple robots cross simultaneously and the gate's remaining
  capacity is smaller than the crosser count, the lowest-id robots get the
  remaining slots. Higher-id robots whose `pose.x ≥ gate.x` but who didn't
  fit are **not** enrolled — they remain `gatesCrossed[id] === g` and are
  eliminated when the gate closes (R10).
- **R9.** A robot can only cross gates in order. `gatesCrossed[id]` is
  incremented from 0 → 1 → 2 → ... → gates.length, never skipping.

### Closure rules

- **R10.** When `gateCrossings[g].length >= gate.cullToCount`,
  `gateClosed[g]` is set to `true` in the same tick the threshold is
  reached. All active robots with `gatesCrossed[id] === g` (still behind
  or at the closing gate without enrollment) are added to that tick's
  `eliminations` list. Reason format:
  - Non-final gate: `'<gate.name>_closed'` (e.g., `'gate_a_closed'`).
  - Final gate: `'race_over'`.
- **R11.** When the final gate closes, every robot in
  `gateCrossings[finalGateIndex]` is also pushed onto that tick's
  `finishes` list (in enrollment order). The engine assigns `place`
  1-indexed in `finishOrder` order (Sim Engine GDD R13). With v1 arena
  schedules (final `cullToCount = 1`), this is always exactly one robot.
- **R12.** The same tick can both close the final gate AND eliminate
  robots behind it. Eliminations and finishes within the same tick share
  the tick number (Sim Engine GDD R12 permits this).

### Termination rules

- **R13.** `isDone` returns `true` once `finalGateClosed === true`. The
  engine sees this on the next tick and exits the loop with
  `simEnd.reason = 'eventDone'`.
- **R14.** `isDone` also returns `true` if every robot is inactive (no
  `pose.active === true` in the array). This is a defensive fallback for
  malformed arenas where the final gate might never close (e.g., an arena
  whose final gate is unreachable). On well-formed v1 arenas it is
  unreachable.

### Module instance rules

- **R15.** `createSprintRaceModule()` returns a **single-use** module.
  Internal state (gate crossings, closures, per-robot crossing counters)
  is captured in closure and not reset. Calling `runSim` twice with the
  same module instance produces a no-op second race (`isDone` returns
  `true` immediately because `finalGateClosed` is still set from the
  prior run).
- **R16.** Callers needing a fresh sim must call `createSprintRaceModule()`
  again.

---

## 4. Formulas

### Velocity composition

```text
velocity(id, tick) = baseSpeedMps
                   * stat.speed
                   * (1 - stat.caution * cautionScale)
                   * (1 + (rng() * 2 - 1) * stat.chaos * chaosScale)
```

**Variables:**

| Symbol | Source | Range | Notes |
|---|---|---|---|
| `baseSpeedMps` | `CONFIG.sim.sprintRace.baseSpeedMps` | 1–20 m/s | v1 default 6 |
| `stat.speed` | `RobotRosterEntry.stats.speed` | ~0.5–1.3 | from `deriveStats` |
| `stat.caution` | `RobotRosterEntry.stats.caution` | 0–1 | from `deriveStats` |
| `stat.chaos` | `RobotRosterEntry.stats.chaos` | 0–1 | from `deriveStats` |
| `cautionScale` | `CONFIG.sim.sprintRace.cautionScale` | 0–0.5 | v1 default 0.2 |
| `chaosScale` | `CONFIG.sim.sprintRace.chaosScale` | 0–0.5 | v1 default 0.15 |
| `rng()` | seeded mulberry32 | [0, 1) | once per active robot per tick |

**Effective velocity range (v1 defaults):**

- Min: `6 * 0.5 * (1 - 1*0.2) * (1 - 1*0.15)` = `6 * 0.5 * 0.8 * 0.85` = `2.04 m/s`
- Max: `6 * 1.3 * (1 - 0*0.2) * (1 + 1*0.15)` = `6 * 1.3 * 1.0 * 1.15` = `8.97 m/s`
- Median (mid-stat robot): `6 * 0.9 * (1 - 0.5*0.2) * 1.0` = `6 * 0.9 * 0.9` = `4.86 m/s`

**Position update:**

```text
pose.x_{tick+1} = pose.x_{tick} + velocity * dtSeconds
pose.z_{tick+1} = clamp(pose.z_{tick} + pushZ(id, tick) * dtSeconds,
                        -(arena.width/2 - lateralBoundMargin),
                        +(arena.width/2 - lateralBoundMargin))
```

with `dtSeconds = 1 / CONFIG.sim.tickRateHz = 1/60 ≈ 0.01667 s` (Sim Engine
GDD §4).

### Lateral separation (R4a)

```text
pushZ(id, tick) = Σ_{j ≠ id, active}  contribution(id, j)

contribution(id, j):
  dx   = pose[id].x - pose[j].x
  dz   = pose[id].z - pose[j].z
  dSq  = dx² + dz²
  if dSq >= sepR²:                          → 0
  d        = sqrt(dSq)
  falloff  = 1 - d/sepR                     // 0 at radius → 1 at zero
  if |dz| < laneEps:                        // same-lane tiebreak
      sign = (id < j) ? +1 : -1
      → sign * sepForce * falloff
  else:
      → (dz / d) * sepForce * falloff
```

**Variables:**

| Symbol | Source | Range | Notes |
|---|---|---|---|
| `sepR` | `CONFIG.sim.sprintRace.separationRadius` | 1.0–3.0 | v1 default 1.6 |
| `sepForce` | `CONFIG.sim.sprintRace.separationForceMps` | 2–10 m/s | v1 default 6.0 |
| `laneEps` | `CONFIG.sim.sprintRace.separationCoincidentLaneEps` | 0.01–0.1 | v1 default 0.05 |
| `lateralBoundMargin` | `CONFIG.sim.sprintRace.lateralBoundMargin` | 0–arena.width/2 | v1 default 0.5 |

**Determinism notes:**

- Iteration order is id-ascending for both motion and the inner neighbor
  scan. Pose state read during the inner scan may be a mix of "this tick"
  (j < id, already advanced) and "last tick" (j > id, not yet advanced)
  values, but that mixture is byte-stable across runs.
- `pushZ` uses no `rng()` calls — separation is a pure function of pose
  state. The single rng call per active robot per tick (R2) is for
  velocity jitter only.

### Race duration estimate

For arena-01 (length 240 m) at the median velocity 4.86 m/s:

```text
expectedTicks = arena.length / (medianVelocity * dtSeconds)
              = 240 / (4.86 * (1/60))
              = 240 / 0.081
              ≈ 2,963 ticks
              ≈ 49.4 seconds at 60 Hz
```

Empirically, seed 42 on the synthetic 85-robot test roster completes in
2,400–3,000 ticks. Well under the engine's default `maxTicks = 7,200`
safety stop (Sim Engine GDD §4).

### Cull arithmetic for arena-01

```text
roster size              = 85
gate_a closes at #28     → eliminations: 85 - 28 = 57 robots, reason 'gate_a_closed'
gate_b closes at #10     → eliminations: 28 - 10 = 18 robots, reason 'gate_b_closed'
finish closes at #1      → finishes:      1 robot,  place 1
                         → eliminations: 10 -  1 =  9 robots, reason 'race_over'
                         ───────────────────────────
total accounted for       = 57 + 18 + 1 + 9 = 85 ✓
```

This identity is asserted in the test suite.

---

## 5. Edge Cases

### Numeric / boundary

**E1. All robots cross the same gate on the same tick.** The gate enrolls
the first `cullToCount` robots in id-ascending order; the remaining
crossers are eliminated when the gate closes that same tick (R8 + R10).
They are NOT enrolled in the gate's crossings list.

**E2. A robot crosses two gates in the same tick.** The motion phase moves
the robot by at most one tick's worth of distance (~0.15 m at v1 default
speeds × 1/60 s). Adjacent gates in v1 arenas are ≥ 80 m apart, so this
is impossible in practice. If a future arena spaces gates closer than one
tick's max travel, the rule is: gates are processed in array order each
tick, so the robot increments `gatesCrossed[id]` once per gate during
that tick's loop.

**E3. Gate `cullToCount` larger than active robot count.** The gate never
reaches its threshold and never closes. The race stalls. Defensive fallback
R14 (all-inactive isDone) does not save it because robots remain active.
The engine's `maxTicks` safety stop catches this in finite time. In v1
this can't happen — the arena loader (S5-03 §3 R7) enforces strictly
decreasing `cullToCount` and a final value of 1.

**E4. Velocity computes to NaN or negative.** Not possible with v1 stat
ranges and tunable bounds (see §4 min/max). If a future tuning push
`cautionScale` above 1.0 with `stat.caution = 1`, `cautionFactor` could
go negative — that's a tuning error, not an engine bug. Guard rails:
the `cautionScale` knob is documented as bounded [0, 0.5] in §7.

**E5. Active robot has `gatesCrossed[id] > arena.gates.length`.** Cannot
happen — R9 enforces sequential gate crossings, so the maximum value is
`arena.gates.length`. A robot at that count has crossed every gate; for
non-final crossings it remains active, but the final gate's closure (R10)
inactivates everyone behind it.

### Module lifecycle

**E6. Module reused across two `runSim` calls.** State persists; the
second call sees `finalGateClosed = true` and `isDone` returns `true` on
tick 0. The second sim emits `[simStart, simEnd]` only and reports
`ticks: 0` and `winnerId: null`. Pinned by the test "reusing the same
module instance across two runs is unsupported".

**E7. `recordPoseFrames: false` in the engine options.** The module is
unaffected; gate logic depends on `pose.x` (live) not `poseFrames`
(snapshots). Tests that don't need pose history disable recording for
speed.

### Arena pathologies

**E8. Arena with `gates.length === 1` (just a finish gate).** Permitted by
the arena loader (R7 says `≥ 2 gates`, so actually NOT permitted in v1).
If a future arena loosens this, the module behaves correctly: the single
gate is the final gate, robots race directly to it, first crosser wins.

**E9. Arena with the start grid wider than expected.** Robots spawn at
their lanes (handled by `buildStartPoses` in the engine helper). The
module never reads lane/row data directly — z is read from `pose.z`
which was set at init.

**E10. Robot with `stat.speed === 0` (or near zero).** In v1 this is
impossible — `traitToStat.speed.base = 0.5` is the floor. If a future
tuning zeroes the base, that robot would never advance and would be
eliminated at gate A when it closes.

### Determinism

**E11. Two robots with byte-identical stats.** Their per-tick velocity
differs only via the rng jitter, and rng is called per id, not shared.
They diverge after tick 1. The id-ascending iteration order remains the
deterministic tiebreak when their positions are equal at a gate.

**E12. RNG state on inactive robots.** `rng()` is called only for active
robots (R2). Two seeds that produce different early eliminations will
have different rng-state alignment on subsequent ticks — which is the
desired behavior for "same seed → same race, different seeds → different
race".

---

## 6. Dependencies

### Upstream (this module reads from these)

| System | Symbols used | Notes |
|---|---|---|
| **Config Module** (`src/config/index.ts`) | `CONFIG.sim.sprintRace.{baseSpeedMps, cautionScale, chaosScale}` | Read at call time inside `advanceMotion`. |
| **Sim Engine Core** (`src/sim/engine.ts`) | `EventModule`, `TickContext`, `TickResult`, `RobotPose`, `buildStartPoses` | Implements the `EventModule` interface; uses the start-grid helper. |
| **Arena Loader** (`src/sim/arena.ts`) | `Arena`, `Gate` types | Reads `arena.gates[].x`, `arena.gates[].cullToCount`, `arena.gates[].name`. Does not read `arena.length` or `arena.startGrid` (engine helper handles those). |
| **Robot Roster Loader** (`src/sim/robot-roster.ts`) | `RobotRoster` | Reads `roster[id].stats.{speed, caution, chaos}` per tick; other stats unused in v1 sprint. |
| **Trait → Stat Derivation** (`src/sim/trait-to-stat.ts`) | `SimStats` type (transitively via roster) | Module never invokes `deriveStats` directly. |
| **Seedable PRNG** (`src/sim/rng.ts`) | `() => number` (transitively via `TickContext.rng`) | Module never instantiates an RNG; only calls the one passed in. |

### Downstream (these depend on this module)

| System | Sprint | How it consumes the module |
|---|---|---|
| **Headless Sim Harness** (`tools/sim/run-event.ts`) | S5-06 | Calls `createSprintRaceModule()` once per sim, passes it to `runSim`, serializes the result. |
| **85-Instance Renderer** | Sprint 6+ | Indirect — consumes the engine's `SimResult` populated by this module. |
| **Animation State Switcher** | Sprint 6+ | Indirect — reacts to `pose.active` transitions emitted by this module's eliminations. |

### Cross-references

The Sim Engine Core GDD §6 lists this module as its first downstream
consumer. The Arena Loader GDD §6 lists this module as the consumer of
the gate sequence.

---

## 7. Tuning Knobs

### Tuning surfaces (live in `CONFIG.sim.sprintRace`)

| Knob | Path | Default | Range | Effect |
|---|---|---|---|---|
| Base speed | `baseSpeedMps` | 6 | 1–20 | Linear scalar on every robot's velocity. Doubling halves race time; halving doubles it. Use this to tune the playback duration globally. |
| Caution slowdown | `cautionScale` | 0.2 | 0–0.5 | Maximum velocity penalty for `stat.caution = 1` robots. At default, a fully cautious robot is 20% slower; at 0, caution has no effect. **Hard ceiling at 0.5** — values above that risk negative velocity at extreme stat combinations (E4). |
| Chaos jitter | `chaosScale` | 0.15 | 0–0.5 | Per-tick velocity variance amplitude. At default, a fully chaotic robot's per-tick velocity ranges ±15% around its mean. Higher values produce more visible "lurching" motion; lower values make the race more predictable. |

### Per-call (no overrides)

The module currently has no `SprintRaceOptions` parameter. Future
extensions (e.g., custom AI behaviors per arena, lane-change rules) would
be added there.

### Tuning recipes

| Goal | Adjust |
|---|---|
| Shorter race playback | Raise `baseSpeedMps` (e.g., to 8 m/s → ~37 s on arena-01). |
| More dramatic culls (fewer ties at gates) | Raise `chaosScale` toward 0.3. |
| More predictable winner (favor stat.speed) | Lower `chaosScale` toward 0.05. |
| Caution-heavy robots feel meaningfully slower | Raise `cautionScale` toward 0.3 (do not exceed 0.5). |
| Caution stat is irrelevant in this event | Set `cautionScale = 0` (and consider removing `stat.caution` from sprint behavior in the GDD). |

### Stats not consumed in v1 sprint

`stat.acceleration`, `stat.handling`, `stat.pathfinding`, `stat.grace` are
defined by the trait→stat derivation but unused by this module in v1. They
are reserved for:
- `acceleration` — start-grid ramp-up (post-spike polish).
- `handling` / `pathfinding` — Maze Run event (future).
- `grace` — second-chance / post-cull recovery mechanic (future).

This is documented here so the silence is intentional, not a missing wire.

---

## 8. Acceptance Criteria

Each AC maps to an automated test in `src/sim/sprint-race.test.ts`. The
suite runs in Node (`npx vitest run src/sim/sprint-race.test.ts`).

### End-to-end

- **AC1.** A run on arena-01 with 85 synthetic robots completes and
  produces exactly one winner (`finishOrder.length === 1`,
  `winnerId !== null`, `simEnd.reason === 'eventDone'`).
  *(Test: "runs to completion and produces exactly one winner".)*
- **AC2.** Total elimination + finish count equals roster size (85).
  *(Test: "three-stage cull totals match the arena schedule".)*
- **AC3.** Cull breakdown matches the arena schedule: 57 `gate_a_closed`,
  18 `gate_b_closed`, 9 `race_over`, 1 finish.
  *(Test: same as AC2.)*
- **AC4.** Race completes well under the engine's 7,200-tick safety
  stop (asserted < 4,000 ticks).
  *(Test: "completes in well under the 7,200-tick safety stop".)*

### Determinism

- **AC5.** Two `runSim` calls with the same seed produce byte-identical
  events, finish orders, and winner ids.
  *(Test: "produces byte-identical events across two runs with the same
  seed".)*
- **AC6.** Different seeds produce different outcomes (pose frames or
  finish results must differ).
  *(Test: "produces different outcomes for different seeds".)*

### Gate semantics

- **AC7.** Eliminations within a single cull (e.g., all `gate_a_closed`)
  share a single tick number.
  *(Test: "elimination ticks are non-decreasing across the gate sequence",
  per-reason same-tick assertion.)*
- **AC8.** Cull events fire in gate order: `gate_a` tick < `gate_b` tick
  < `race_over` tick.
  *(Test: same as AC7, monotonicity assertion.)*
- **AC9.** The winner is never among the first cull batch (gate_a victims).
  *(Test: "the winner is always among the first robots through gate_a".)*

### Algorithm correctness on a smaller arena

- **AC10.** A 10-robot field with `cullToCount` = [5, 3, 1] produces 5
  `gate_a_closed`, 2 `gate_b_closed`, 2 `race_over`, 1 finish.
  *(Test: "5/3/1 cull schedule on a 10-robot field accounts for every
  robot".)*

### Motion invariants

- **AC11.** No robot's x ever decreases between consecutive pose frames
  while active.
  *(Test: "robots only move forward (+X); position is monotonic
  non-decreasing".)*
- **AC12.** No robot's z (lane) changes during the run.
  *(Test: "lane (z) is constant across the run (no lane changes in v1)".)*

### Module instance lifecycle

- **AC13.** Reusing a module instance across two `runSim` calls produces
  a zero-tick second sim (documented single-use contract).
  *(Test: "reusing the same module instance across two runs is
  unsupported".)*

### Cross-cutting

- **AC14.** `tsc --noEmit` passes after the module lands.
- **AC15.** The full test suite passes (164 tests at S5-05 close, no
  regressions).

---

## Implementation Reference

- `src/sim/sprint-race.ts` — implementation (~140 LOC).
- `src/sim/sprint-race.test.ts` — test suite (11 tests).
- This document was reverse-documented from the spike per the Sprint 5
  pattern (S5-04 set the precedent).
