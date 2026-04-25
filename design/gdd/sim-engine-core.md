# Sim Engine Core — Game Design Document

> **Status**: Approved
> **Created**: 2026-04-24
> **Last Updated**: 2026-04-24
> **Sprint Task**: S5-04
> **Tier**: L
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The **Sim Engine Core** is the fixed-timestep tick loop that drives every event
in Robo Rhapsody Sim. It owns four things and only four things:

1. **Determinism** — a single seeded RNG (`createRng` from S5-02 of the
   foundation tier) routed to the active event module; no other entropy source
   is permitted inside the engine.
2. **Tick cadence** — a fixed `dtSeconds = 1 / CONFIG.sim.tickRateHz`. No
   real-time clock, no variable timestep, no frame-skip logic.
3. **Active-robot bookkeeping** — an in-memory `RobotPose[]` indexed by id,
   with `active` flags toggled when the event module reports eliminations or
   finishes.
4. **Timeline shape** — the structured `TimelineEvent[]` and `PoseFrame[]`
   outputs that Sprint 6 will consume to drive the renderer.

The engine is **event-type-agnostic**. It does not know what a "gate" is, what a
"cull stage" is, or how robots decide to move. Those concerns belong to an
`EventModule` (S5-05 implements the first such module: `Sprint Race Event
Module`). The engine asks the module to `init` poses, calls `tick` once per
tick, and asks `isDone` to determine when to stop.

The engine is **rendering-agnostic**. It runs identically in Node and in the
browser. There are no Three.js, DOM, or `requestAnimationFrame` dependencies.
The headless sim harness (S5-06) consumes the engine's output to produce
JSON; the renderer (Sprint 6+) will consume the same output to drive
animation.

The L-tier designation reflects **breadth** — a wide rule surface, multiple
output shapes, and a strict determinism contract — not implementation size. The
implementation in `src/sim/engine.ts` is ~205 LOC.

---

## 2. Player Fantasy

The Sim Engine is internal infrastructure. There is no direct player surface.
The fantasy this system protects is indirect but central to the project's
identity:

> **"The same race, the same way, every time."**

Robo Rhapsody Sim is a passive-watch event simulator. Players don't input.
They watch outcomes unfold and (in v1.x+) discuss, share, and dispute them.
For that loop to work, every player who watches "Sprint Race seed 42 on
arena-01" must see the **identical race** — same finishing order, same
eliminations at the same ticks, same robots taking the same paths.

Determinism is the load-bearing player-facing promise. If the engine ever
diverges run-to-run, the entire spectator/community layer collapses: nobody
can argue about who deserved to win because nobody saw the same race. The
engine's job is to make that impossible by construction.

This is why the engine is so tightly scoped. Every concession (a clock read,
a `Math.random`, a `Map` iteration in insertion order) would silently break
the fantasy with no visible symptom until someone, somewhere, ran the same
seed and saw a different winner.

---

## 3. Detailed Rules

### Determinism rules

- **R1.** Exactly one RNG instance per sim, created via `createRng(opts.seed)`
  at the top of `runSim`. It is passed to the event module via
  `EventModule.init({rng})` and `TickContext.rng`. The engine itself never
  calls `rng()` — it only forwards the reference.
- **R2.** No other entropy source is allowed inside `src/sim/engine.ts`:
  no `Math.random`, no `Date.now()`, no `performance.now()`, no `crypto.*`,
  no environment reads. The engine test suite includes a `vi.spyOn(Math,
  'random')` assertion that fails the build if this is ever violated.
- **R3.** Active poses are iterated by **id-ascending** order anywhere the
  engine snapshots or processes them. The roster contract from S5-02
  guarantees `roster[i].id === i`, so a plain `for (let i = 0; i < poses.length;
  i++)` loop is the canonical iteration. **Never** iterate a `Map`, `Set`, or
  `Object.keys()` in determinism-relevant code paths.
- **R4.** Elimination and finish lists from `TickResult` are processed in the
  order the event module returned them. The engine does **not** sort, dedupe,
  or reorder them. Determinism of those collections is the module's
  responsibility.

### Timestep rules

- **R5.** `dtSeconds` is fixed to `1 / CONFIG.sim.tickRateHz` for the entire
  duration of `runSim`. It is computed once and passed to every `TickContext`.
  Changing `CONFIG.sim.tickRateHz` between runs changes `dtSeconds`; changing
  it during a run is undefined behavior (config is a const-asserted object,
  so it can't happen at runtime anyway).
- **R6.** The tick counter starts at `0` and increments by exactly `1` after
  each successful module `tick()` call.
- **R7.** `isDone` is checked **before** each `tick()` call, including before
  tick 0. If `isDone` returns `true` on tick 0, the loop exits without ever
  calling `tick`, the timeline contains only `simStart` and `simEnd`, and
  `poseFrames` is empty.

### Pose ownership rules

- **R8.** The engine is the **sole allocator** of the `RobotPose[]` array. It
  delegates initial population to `EventModule.init`, which is expected to
  return one pose per roster entry, indexed by id. (`buildStartPoses` is the
  default helper modules use.)
- **R9.** During each tick, the event module **mutates `ctx.poses` in place**.
  This matches the project's "sim is the single legitimate writer of pose"
  invariant (technical-preferences.md, Forbidden Patterns). The engine does
  not clone the array between ticks — pose-frame snapshots are the
  immutable record of past state.
- **R10.** When the event module reports an elimination or finish for a robot,
  the engine sets that robot's `active = false` after the tick body runs.
  Subsequent ticks see the updated flag. The module is expected to skip
  inactive robots in its own iteration.

### Timeline rules

- **R11.** The first event in `events` is always `{type: 'simStart', tick: 0}`,
  and the last is always `{type: 'simEnd'}`. These bookend the timeline
  unconditionally — even if the event module finishes on tick 0 or the
  engine hits `maxTicks` without any robot finishing.
- **R12.** All event `tick` numbers are monotonic non-decreasing across the
  timeline. Eliminations, finishes, and the closing `simEnd` may share a
  tick; the engine emits them in the order they occurred within that tick
  (eliminations before finishes, both before the engine increments the tick
  counter).
- **R13.** Finish places are **1-indexed and consecutive**. The first robot to
  finish gets place 1, the second gets place 2, etc. `finishOrder.length`
  after pushing equals the new place. Ties within a single tick are broken
  by the order the module returned them in `TickResult.finishes`.
- **R14.** `simEnd.winnerId` equals `finishOrder[0]` if any robot finished;
  otherwise `null`. This applies even if the sim hit `maxTicks`. A
  `winnerId` of `null` means "no robot finished within the time limit".
- **R15.** `simEnd.reason` is `'eventDone'` when the loop exited because
  `isDone` returned `true`, or `'maxTicks'` when the loop exited because the
  tick counter reached `maxTicks`.

### Pose-frame rules

- **R16.** When `recordPoseFrames === true` (the default), the engine appends
  one `PoseFrame` per tick after the module's `tick()` returns and the engine
  has applied elimination/finish updates. `poseFrames.length === ticks`.
- **R17.** `PoseFrame.tick` matches the tick it captures (frame at index `i`
  has `tick === i` for a sim that runs to completion without skipping ticks).
- **R18.** `PoseFrame.data` is a `Float32Array` of length `roster.length *
  POSE_STRIDE`. The five floats per robot are `[active, x, y, z, yaw]`,
  indexed by `id * POSE_STRIDE`. `active` is exactly `1.0` or `0.0`.
  `Float32` is chosen so the renderer can pass these arrays directly to GPU
  buffers in Sprint 6+ without re-typing.
- **R19.** Setting `recordPoseFrames === false` makes `poseFrames` an empty
  array. Tests that don't need pose history use this to keep output small.

### Safety rules

- **R20.** The engine enforces a `maxTicks` upper bound on the loop. A module
  whose `isDone` never returns `true` will not hang the engine — it will hit
  `maxTicks` and exit cleanly with `simEnd.reason = 'maxTicks'`. The default
  is `CONFIG.sim.tickRateHz * 120` (two minutes of sim time).

---

## 4. Formulas

### Fixed timestep

```text
dtSeconds = 1 / CONFIG.sim.tickRateHz
```

At the v1 default of 60 Hz, `dtSeconds = 1/60 ≈ 0.01666666...`. JavaScript
floats represent this exactly to ~17 digits; identical multiplication chains
across runs produce identical results bit-for-bit on V8.

### Default safety stop

```text
defaultMaxTicks = CONFIG.sim.tickRateHz × DEFAULT_MAX_TICKS_SECONDS
                = 60 × 120
                = 7,200 ticks
```

`DEFAULT_MAX_TICKS_SECONDS = 120` is a module-level constant in `engine.ts`
(see §7 — non-tuning constant).

### Pose-frame indexing

```text
POSE_STRIDE = 5

base(id)          = id * POSE_STRIDE
data[base]        = active        (1.0 or 0.0)
data[base + 1]    = x             (meters)
data[base + 2]    = y             (meters)
data[base + 3]    = z             (meters)
data[base + 4]    = yaw           (radians)
```

Total floats per frame: `roster.length × POSE_STRIDE`. For the v1 roster
(85 robots): 425 floats = 1,700 bytes per `Float32Array` frame.

### Place assignment

After the engine processes a finish for `robotId`:

```text
finishOrder.push(robotId)
place = finishOrder.length
event = {type: 'finish', tick, robotId, place}
```

Places are therefore 1-indexed. `place === 1` is the winner.

### Winner determination

```text
winnerId = finishOrder.length > 0
         ? finishOrder[0]
         : null
```

The first robot to finish wins. If the loop exits via `maxTicks` without any
finish, `winnerId === null`.

---

## 5. Edge Cases

### Empty / degenerate input

- **Roster of length 0.** The engine does not validate; it allocates
  `RobotPose[0]`, calls `init` (which returns `[]`), enters the loop, asks
  `isDone` (which is the module's call), and either runs to `maxTicks` or
  exits if the module returns `true` immediately. `winnerId` is `null` in
  either case. Behavior is defined; usefulness is the caller's problem.
- **`maxTicks: 0`.** The loop body never executes. `simStart` is emitted at
  tick 0, the loop checks `tick < 0 = false`, falls through, and emits
  `simEnd` with `reason: 'maxTicks'` and `winnerId: null`. `poseFrames` is
  empty.
- **`isDone` returns `true` on tick 0.** Loop exits before the first
  `tick()` call. Timeline is exactly `[simStart, simEnd]`. `poseFrames` is
  empty. `simEnd.reason = 'eventDone'`.

### Module behavior

- **Event module returns no `eliminations` and no `finishes`.** Both fields are
  optional in `TickResult`; the engine uses `if (result.eliminations)` /
  `if (result.finishes)` guards. A module returning `{}` is valid and
  represents "nothing of note happened this tick".
- **Module reports an elimination for an already-inactive robot.** The engine
  emits the timeline event regardless (modules are trusted), but the
  `if (pose.active)` guard ensures `active = false` is idempotent.
- **Module reports a finish for an already-inactive robot.** Same as
  elimination: the timeline event is emitted, the active flag is already
  `false` (no-op), and the robot is appended to `finishOrder` — which means
  a buggy module could double-finish a robot. The engine does not police
  this; that's the module's invariant to maintain.
- **Module mutates `ctx.poses[id].id` or other readonly fields.** TypeScript
  flags it at compile time (`id` is `readonly`). At runtime, the engine
  doesn't re-read `id`; it iterates by index. A pathological mutation might
  desynchronize pose-frame indexing but won't crash the engine.

### Same-tick collisions

- **Finish + elimination of the same robot in the same tick.** The engine
  processes eliminations first, then finishes (in the order returned by the
  module). Both events are emitted; the robot ends up inactive (idempotent),
  appears in `finishOrder`, and gets a `place`. The robot's pose frame at
  that tick has `active = 0`.
- **Two finishes in the same tick.** Both are emitted with the same tick
  number; places are 1-indexed by order of return. R12 (monotonic ticks)
  permits same-tick events.
- **Elimination of every active robot in one tick.** All eliminations are
  emitted, the engine snapshots the pose frame (all `active = 0`), then
  asks `isDone` on the next iteration. A well-formed module returns `true`
  here; a buggy module that doesn't will cause the loop to continue with
  zero actives until `maxTicks`.

### Numeric edge cases

- **Module writes `NaN` or `Infinity` to a pose coordinate.** The engine does
  not validate. The pose frame records the value as-is. Determinism is
  preserved (NaN propagation is deterministic in JS), but downstream
  consumers (renderer, harness JSON output) may misbehave. Validation is the
  module's concern; the engine is GIGO at the contract boundary, matching
  S5-01's posture.
- **Float drift across platforms.** Not a concern for v1: dev and CI both run
  on V8. If the project ever ships a non-V8 runtime (rare for Three.js
  projects), the determinism test will surface drift before it reaches
  players.

### Configuration edge cases

- **`CONFIG.sim.tickRateHz` set to a non-integer (e.g., `59.94`).** The engine
  computes `dtSeconds = 1 / 59.94` and uses it as-is. Determinism holds
  (same hz → same dt → same product chain). The default is `60` and there
  is no current motivation to change it; this is documented behavior, not a
  recommended configuration.
- **`recordPoseFrames` undefined.** The `?? true` default ensures `poseFrames`
  is recorded unless explicitly disabled.

---

## 6. Dependencies

### Upstream (engine reads from these)

| System | Symbol(s) used | Notes |
|---|---|---|
| **Config Module** (`src/config/index.ts`) | `CONFIG.sim.tickRateHz` | Read once at the top of `runSim` to compute `dtSeconds` and the default `maxTicks`. |
| **Seedable PRNG** (`src/sim/rng.ts`) | `createRng` | Single instance per sim; passed to module via `init` and `TickContext`. |
| **Trait → Stat Derivation** (`src/sim/trait-to-stat.ts`) | `RobotTraits`, `SimStats` types | Reachable via `RobotRosterEntry`; engine never invokes `deriveStats` itself (the roster pre-derives at load time per S5-02). |
| **Robot Roster Loader** (`src/sim/robot-roster.ts`) | `RobotRoster`, `RobotRosterEntry` | The roster's id-sorted invariant (`roster[i].id === i`) is load-bearing for engine determinism — see R3. |
| **Arena Loader** (`src/sim/arena.ts`) | `Arena`, `getStartPosition` | `getStartPosition` is used by the `buildStartPoses` helper. Engine does not read `arena.gates` directly — that's the event module's job. |

### Downstream (these depend on the engine)

| System | Sprint | How it uses the engine |
|---|---|---|
| **Sprint Race Event Module** | S5-05 | Implements `EventModule`. Owns gate logic, three-stage cull, AI per-tick decisions, lane changes. Drives `runSim` for the `'sprint-race'` arena type. |
| **Headless Sim Harness** | S5-06 | `tools/sim/run-event.ts` — calls `runSim`, serializes `SimResult` to JSON. The artifact Sprint 6 consumes. |
| **85-Instance Renderer** | Sprint 6+ | Consumes `PoseFrame[]` to drive per-tick robot transforms in Three.js. The `Float32Array` layout is chosen so frames can be uploaded to GPU buffers without copying. |
| **Animation State Switcher** | Sprint 6+ | Reads `pose.active` flag transitions to trigger `run` ↔ `idle` ↔ `death` clip crossfades. |

---

## 7. Tuning Knobs

### Tuning surfaces (live in `CONFIG`)

| Knob | Path | Default | Range | Effect |
|---|---|---|---|---|
| Tick rate | `CONFIG.sim.tickRateHz` | `60` Hz | 30–120 | Lower = coarser sim, more drift potential per tick; higher = more CPU per second of sim time. Determinism holds at any value. |
| Default seed | `CONFIG.sim.defaultSeed` | `1` | any int32 | Used by ad-hoc dev scripts that don't pass a seed. Production sims always pass an explicit seed. The engine itself reads `opts.seed`, not this default. |

### Per-call overrides (passed via `SimOptions`)

| Option | Default | Effect |
|---|---|---|
| `seed` | required | Seeds the single rng for this sim run. |
| `maxTicks` | `tickRateHz × 120` (= 7,200 at 60 Hz) | Hard upper bound on the tick loop. |
| `recordPoseFrames` | `true` | Whether to snapshot per-tick poses. Set `false` for tests / debug runs that only need the timeline. |

### Module-level constants (NOT tuning surfaces)

These live in `engine.ts` as `const` declarations and intentionally do **not**
live in `CONFIG`. They are implementation details of the engine's contract,
not values the design wants to vary.

| Constant | Value | Why it's not in CONFIG |
|---|---|---|
| `DEFAULT_MAX_TICKS_SECONDS` | `120` | The two-minute safety stop is an engine invariant, not a tuning value. Per-event time limits belong on the event module (e.g., a Sprint Race might cap at 60 s). Callers can override via `SimOptions.maxTicks`. |
| `POSE_STRIDE` | `5` | Hard-coded in the `[active, x, y, z, yaw]` contract. Changing it changes the public API of `PoseFrame`; consumers (renderer, harness) parse `data` against this exact stride. |

This matches the technical-preferences.md guidance: "Implementation-detail
constants that are NOT tuning surfaces live in module scope as named
constants and are documented in their owning GDD §7."

---

## 8. Acceptance Criteria

Each AC maps to an automated test in `src/sim/engine.test.ts`. The full
suite runs in Node via `npx vitest run src/sim/engine.test.ts` and is part
of the project's pre-commit gate.

### Determinism

- **AC1.** Two `runSim` calls with the same `seed`, `roster`, `arena`, and
  `eventModule` produce byte-identical `JSON.stringify(events)` and
  identical pose-frame hashes. *(Test: "produces byte-identical events and
  pose frames for the same seed".)*
- **AC2.** Two `runSim` calls with different seeds produce different
  outcomes (events or pose frames must differ). *(Test: "produces different
  finish orders for different seeds".)*
- **AC3.** The engine never calls `Math.random` during a sim run, verified
  via `vi.spyOn`. *(Test: "does not call Math.random anywhere in the
  engine".)*

### Termination

- **AC4.** When `eventModule.isDone` returns `true`, the loop exits and
  `simEnd.reason === 'eventDone'`. *(Test: "terminates via eventModule.isDone
  and emits simEnd with reason 'eventDone'".)*
- **AC5.** When `isDone` never returns `true`, the loop exits at `maxTicks`
  with `simEnd.reason === 'maxTicks'` and `winnerId === null`. *(Test: "hits
  maxTicks safety stop when isDone never returns true".)*

### Timeline ordering

- **AC6.** The first event is `simStart` at tick 0; the last event is
  `simEnd`. *(Test: "first event is simStart at tick 0; last event is
  simEnd".)*
- **AC7.** All event `tick` numbers are monotonic non-decreasing.
  *(Test: "all event tick numbers are monotonic non-decreasing".)*
- **AC8.** Finish events have 1-indexed, consecutive `place` values, and
  `finishOrder` mirrors finish-event order. *(Test: "finish places are
  1-indexed and consecutive".)*

### Pose frames

- **AC9.** With `recordPoseFrames: true`, exactly one `PoseFrame` is
  recorded per tick, and frame indices match tick numbers. *(Test: "records
  one pose frame per tick when recordPoseFrames is true".)*
- **AC10.** With `recordPoseFrames: false`, `poseFrames` is empty.
  *(Test: "skips pose-frame recording when recordPoseFrames is false".)*
- **AC11.** Pose-frame data is laid out as `[active, x, y, z, yaw]` per id
  with `POSE_STRIDE = 5`. *(Test: "lays out pose data as [active, x, y, z,
  yaw] per id".)*

### Elimination semantics

- **AC12.** Elimination events carry the correct `robotId` and `reason`
  forwarded from the module. *(Test: "emits elimination events with correct
  robotId and reason".)*
- **AC13.** A robot eliminated by the module is marked `active = 0` in the
  same tick's pose frame. *(Test: "a robot eliminated by the module is
  marked inactive in subsequent pose frames".)*

### Helper

- **AC14.** `buildStartPoses` produces one active, y=0, yaw=0 pose per
  roster entry, with `id === index`. *(Test: "places each robot at its
  arena start grid slot, all active".)*

### Cross-cutting (sprint-level)

- **AC15.** `tsc --noEmit` passes with zero errors after the engine lands.
- **AC16.** The full test suite (currently 153 tests) passes after the
  engine lands — no regressions.

---

## Implementation Reference

- `src/sim/engine.ts` — implementation (~205 LOC).
- `src/sim/engine.test.ts` — test suite (14 tests, ~280 LOC).
- This document was reverse-documented from the spike per the Sprint 5 plan
  (risks §103, "spike-first option available — write a Node harness against
  a stub trait→stat before the GDD is fully approved, mirroring the S4-04
  pattern that worked well").
