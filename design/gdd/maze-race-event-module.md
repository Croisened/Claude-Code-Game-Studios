# Maze Race Event Module — Game Design Document

> **Status**: Approved
> **Created**: 2026-05-04
> **Last Updated**: 2026-05-04
> **Sprint Task**: S7-01 (closes Sprint 6 retro AI #7 — module shipped unplanned in S6 without a GDD); S7-02 extends with variance levers
> **Tier**: M
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The **Maze Race Event Module** is the second concrete `EventModule`
implementation. It drives a single race through a procedurally
generated maze from staging-area entrance queues to a single finish
cell. The arena type is `'maze-race'` (Arena-02).

The module owns three things:

1. **Per-tick cell-to-cell motion.** Each active robot steers toward
   the world center of its current target cell at a speed derived from
   `stat.speed`, `stat.caution`, and a per-tick chaos jitter. On
   arrival within `cellArrivalRadius`, the robot snaps to the cell
   center and advances to the next cell along the BFS shortest path
   to the finish — modulated by a wrong-turn probability driven by
   `stat.pathfinding` (Cipher-derived).
2. **Boids-style 2D separation.** Each tick, every active robot is
   pushed radially away from active neighbors inside
   `separationRadius`. The push is followed by a wall-corridor clamp
   so robots cannot phase through maze walls.
3. **Finish detection + race-over cull.** The first robot to enter
   the finish cell triggers the race end. All other active robots
   are eliminated with `reason: 'race_over'` in the same tick.

What the module deliberately does **not** own:

- Maze layout generation. The host (the App shell) generates a
  `MazeLayout` via `generateMazeLayout({ config, seed })` from
  [`src/sim/maze.ts`](../../src/sim/maze.ts) and passes it in as
  construction input. This lets the renderer + camera read the same
  layout the sim is steering across.
- Tick cadence, RNG instantiation, pose-frame snapshots, timeline
  event ordering — that's the engine's job (Sim Engine Core GDD).
- Arena geometry validation — the arena loader (S5-03) enforces that
  `arena.type === 'maze-race'` arenas carry a valid `mazeConfig`.
- Trait → stat math — pre-derived at roster load time (S5-02).
- Render-side concerns (wall meshes, finish-tree visual, camera
  framing) — owned by `arena-visuals/maze-walls.ts` and the App
  shell's `buildArenaSetup()`.

The implementation in [`src/sim/maze-race.ts`](../../src/sim/maze-race.ts)
is ~440 LOC. M-tier reflects the design surface — pathfinding rule +
multi-axis motion + wall clamp + staging area — being larger than the
sprint race's forward-velocity model.

---

## 2. Player Fantasy

The Maze Race is the **navigational** event. Where Sprint Race
rewards "fast and forward," Maze Run rewards "smart and adaptive":

> **"Don't get lost. Don't get stuck. Find the tree."**

The viewer's eye scans the overhead grid for clusters and spread.
Robots that take wrong turns linger; robots that pick correctly thread
through the corridors. The single finish cell — visualised as the
orange tree — is the unambiguous goal: any robot that gets close to
it has a chance.

Cipher is the favoured trait per [game-concept.md §2](./game-concept.md).
The math should make that legible to a watcher: high-Cipher robots
take optimal turns and don't backtrack; low-Cipher robots make ~12
junction mistakes per typical race, eating ~16 seconds in detours.
This is **deliberately enough to wipe out a max-speed advantage** — a
max-Full-Send / min-Cipher robot should not reliably win against a
balanced field.

Determinism is the substrate (Sim Engine GDD §2). The Maze Race's
contribution: same seed → same maze → same finish order. A spectator
who replays the same seed sees the same robot win the same race.

---

## 3. Detailed Rules

### Construction & state

- **R1.** `createMazeRaceModule({ layout })` returns an `EventModule`.
  The `layout` is a `MazeLayout` produced by `generateMazeLayout` —
  same seed + same `MazeConfig` → byte-identical layout.
- **R2.** Per-event state (lazily initialised on first `init` /
  `tick`):
  - `targetCellId[]` — current target cell per robot.
  - `prevCellId[]` — cell the robot just left (-1 = none yet, e.g. on
    spawn from staging). Used by the wrong-turn rule to exclude
    immediate backtracks from mistake candidates, preventing 1-cell
    oscillation at junctions.
  - `finished` — flips true once the first robot crosses into the
    finish cell.

### Initial pose layout (`init`)

- **R3.** `init` returns one `RobotPose` per roster entry. Robots
  spawn in **staging areas outside** the maze, queued in front of
  one of the layout's `entrances[]`.
- **R4.** Roster ids are shuffled by a single Fisher–Yates pass over
  `rng`, then distributed round-robin across entrances. Two effects:
  - Re-racing with a different seed reshuffles entrance assignments.
  - Round-robin avoids id-clustering at any one entrance.
- **R5.** Within an entrance queue, slots fill front-to-back across
  3 lanes:
  - `slot = counts[entranceIdx]++`
  - `depthRow = floor(slot / 3)`, `lane = (slot % 3) - 1` (gives `{-1, 0, +1}`)
  - World position = entrance cell + outward normal × depth + tangent × lateral
- **R6.** Robots face **into** the maze on spawn (motion vector =
  `-normal`). Yaw convention: `yaw = atan2(-mz, mx)`, so for motion
  `(-nx, -nz)`: `yaw = atan2(nz, -nx)`.
- **R7.** Each robot's first target cell is its entrance cell —
  written into `targetCellId[id]` during `init`. The arrival logic
  takes over from the next tick.

### Per-tick motion (`advanceMotion`)

- **R8.** Robots iterate id-ascending. Inactive robots skip every
  phase, including RNG consumption.
- **R9.** Speed = `baseSpeedMps * stat.speed * cautionFactor * jitter`,
  where:
  - `cautionFactor = 1 - stat.caution * cautionScale`
  - `jitter = 1 + (rng() * 2 - 1) * stat.chaos * chaosScale`
- **R10.** `rng()` is called **exactly once per active robot per
  tick** for the chaos jitter. The arrival/wrong-turn rule (R12)
  consumes a second `rng()` draw **only on the tick when arrival
  occurs**. This is a bounded ≤2 draws per active robot per tick —
  documented exception to the strict 1-per-robot contract from the
  Sim Engine GDD §3, justified by the fact that arrival is rare
  (~1 per ~70 ticks at default speeds).
- **R11.** Arrival check: if the robot is within
  `cellArrivalRadius` of `targetCellId`'s world center, snap pose
  to the cell center (eliminates float drift) and either:
  - End motion this tick if `targetCellId === finishCellId` (the
    robot has finished; `processFinish` handles the event emission).
  - Otherwise call `pickNextCell(...)` to choose the next target
    and update `prevCellId`.
- **R12.** `pickNextCell` rule:
  - Optimal direction = `nextOnPath[arrivedCellId]` (BFS shortest
    path to finish).
  - Enumerate **mistake candidates** = open neighbors that are not
    optimal AND not `prevCellId`. (Excluding `prevCellId` prevents
    backtrack oscillation.)
  - If no mistake candidates exist (corridor / dead-end), always take
    optimal.
  - Otherwise roll one `rng()`. With probability
    `pMistake = (1 - stat.pathfinding) * mistakeMaxRate`, take a random
    mistake candidate. Otherwise take optimal.
  - The `rng()` draw doubles as the candidate index source — remap
    `[0, pMistake)` to `[0, candidates.length)`. Saves a draw and
    keeps the determinism contract clean.
- **R13.** Steering: after target resolution, compute world delta
  `(dx, dz) = targetCenter - pose`. Step length = `min(speed * dt,
  distToTarget)`. Move along the unit `(dx, dz)`.
- **R14.** Boids-style 2D separation push:
  - For every other active robot within `separationRadius`,
    accumulate a radial push proportional to `(1 - dist/radius) *
    separationForceMps`.
  - Coincident robots (`dist < separationCoincidentEps`) get a
    deterministic id-based tiebreak: smaller id pushes +X, larger
    pushes -X.
  - Push is integrated into pose `(x, z)` over `dt` along with the
    primary motion step.
- **R14a.** **Forward-block awareness.** In the same neighbor scan
  as the separation push, check whether each active neighbor sits
  in the robot's motion direction:
  - Decompose the pose-to-neighbor vector into a forward component
    (along `(nx, nz)`) and a lateral component.
  - If the forward component is in `(0, forwardBlockDist)` AND the
    lateral component is within `forwardBlockLateralRadius`, the
    neighbor is "blocking."
  - The robot's forward step is scaled by
    `min(blockFactor) = forwardComponent / forwardBlockDist`
    across all blocking neighbors. At touching distance the step
    goes to zero (full stop); at the far edge of `forwardBlockDist`
    the step is unchanged.
  - Effect: robots queue through corridors instead of piling into
    each other. The separation push still pushes them apart
    laterally; this rule adds the missing "wait for the lane to
    clear" behaviour.
  - Determinism: pose state is read in id-ascending order matching
    the engine iteration. No `rng()` consumed.
- **R15.** Wall-corridor clamp: after motion + push, look up the
  cell the robot is in (`worldToCellId`) and clamp pose to within
  `(cellSize/2 - wallMargin)` of the cell center along any axis with
  a wall. Robots staged outside the grid (cell id `null`) skip this
  clamp — they have free movement until they cross into the
  entrance.
- **R16.** Yaw follows the **steering** direction, not the
  post-push movement direction:
  `pose.yaw = atan2(-nz, nx)` where `(nx, nz)` is the unit vector
  from pose to target center. A robot being shoved sideways by
  separation still appears to face forward toward its target —
  matches viewer expectation that the robot "looks where it's going."

### Finish detection (`processFinish`)

- **R17.** Iterate id-ascending. The first active robot within
  `cellArrivalRadius` of the finish cell center wins. Id-ascending
  iteration provides the deterministic tiebreak.
- **R18.** On finish, `state.finished = true`. Every other still-active
  robot is eliminated this tick with `reason: 'race_over'`.
- **R19.** No further finishers are emitted in subsequent ticks —
  the race is single-winner.

### Termination (`isDone`)

- **R20.** Returns `true` only once every robot is inactive. With
  Lever 2 (R21–R22) the race can stay "open" for multiple ticks
  after the first finisher arrives, so we cannot short-circuit on
  `state.finishTick !== null` — doing so would let the engine skip
  the cull tick and leave actives alive forever.

### Sprint 7 variance levers (S7-02)

- **R21. Lever 2 — finish-cell grace window.** State adds
  `finishTick: number | null`. The first arrival sets `finishTick =
  ctx.tick` and emits a `finish` event for the arriving robot.
  Subsequent ticks continue to scan all active robots inside the
  finish-cell arrival radius and emit `finish` events for each, in
  id-ascending order — they receive places 2, 3, etc. (engine
  numbering). The race-over cull does NOT fire until
  `ctx.tick >= state.finishTick + finishGraceTicks`. At that point,
  every still-active robot is eliminated with `reason: 'race_over'`,
  except those that finished THIS tick (excluded to prevent emitting
  both `finish` and `elimination` for the same robot).
- **R22. Grace-window tie-break.** Within a single tick, multiple
  finishers are emitted in id-ascending order. The engine assigns
  places by emission order, so smaller-id co-finishers get smaller
  place numbers. `winnerId` is `finishOrder[0]` per the engine
  contract — the first finisher overall, with ties broken by id.
- **R23. Lever 3 — chaos feint at junctions.** `pickNextCell`
  partitions the single per-arrival `rng()` draw `u ∈ [0, 1)` into
  three regions:
  - `[0, pMistake)` → pathfinding mistake (Cipher-driven, existing).
  - `[pMistake, pMistake + pFeint)` → chaos feint (Degen-driven, new).
  - `[pMistake + pFeint, 1)` → optimal direction.

  `pFeint = stat.chaos * chaosFeintScale`. Capped at `pMistake +
  pFeint ≤ 1`. The feint and mistake regions both pick a candidate
  via the same `idx = floor(u / pOff * candidates.length)` remap, so
  no extra `rng()` draw is consumed.
- **R24. Lever 5 — wrong-turn recovery bonus.** State adds
  `recoveryTicks[]: number`. Decremented (floor 0) once per active
  robot per tick, regardless of whether an arrival fires. While
  `recoveryTicks[id] > 0`, that robot's effective `pMistake` is
  multiplied by `(1 - recoveryBonusFactor)`. The instant a robot
  picks a non-optimal candidate (mistake OR feint), the counter is
  RESET (not added to) to `recoveryBonusTicks`. Recovery does NOT
  modulate `pFeint` — chaos feints are degen-driven impulsiveness,
  not navigation mistakes.
- **R25. Determinism.** All three levers preserve the
  per-arrival/per-tick rng() draw budget exactly. Lever 2 reads only
  `ctx.tick` and `state.finishTick`. Lever 3 partitions the existing
  `u`. Lever 5 mutates per-robot integer counters with no rng.
  `Math.random` remains forbidden; `tools/sim/run-event.ts` produces
  byte-identical output for the same `(seed, arena)` pair.

---

## 4. Formulas

### Motion

```
cautionFactor = 1 - stat.caution * cautionScale       # ∈ (0.5, 1.0]
jitter        = 1 + (rng()*2 - 1) * stat.chaos * chaosScale  # ∈ [1 - chaos*scale, 1 + chaos*scale]
speed         = baseSpeedMps * stat.speed * cautionFactor * jitter
step          = min(speed * dtSeconds, distToTarget)
nx, nz        = (targetCenter - pose) / distToTarget
pose.x       += nx * step + pushX * dtSeconds
pose.z       += nz * step + pushZ * dtSeconds
pose.yaw      = atan2(-nz, nx)
```

### Wrong-turn rule (with Levers 3 + 5)

```
recoveryFactor = recoveryTicks[id] > 0 ? (1 - recoveryBonusFactor) : 1
pMistake       = (1 - stat.pathfinding) * mistakeMaxRate * recoveryFactor   # Cipher-driven, Lever 5 dampened
pFeint         = stat.chaos * chaosFeintScale                               # Degen-driven, Lever 3
pOff           = min(1, pMistake + pFeint)

u = rng()
if u >= pOff or candidates.empty:
    nextCell    = nextOnPath[arrivedCellId]
    tookMistake = false
else:
    idx         = floor((u / pOff) * candidates.length)
    nextCell    = candidates[idx]
    tookMistake = true   # arms the recovery window: recoveryTicks[id] = recoveryBonusTicks
```

Variable ranges:

- `stat.pathfinding ∈ [0.3, 1.0]` (Cipher-driven).
- `stat.chaos ∈ [0, 1]` (Degen-driven).
- With defaults `mistakeMaxRate = 0.6`, `chaosFeintScale = 0.15`,
  `recoveryBonusFactor = 0.5`:
  - Per-junction `pMistake` (no recovery): `[0, 0.42]`.
  - Per-junction `pMistake` (during recovery): `[0, 0.21]`.
  - Per-junction `pFeint`: `[0, 0.15]`.
  - Combined `pOff` ceiling: `0.57` for max-Degen + min-Cipher.

### Finish + grace window (Lever 2)

```
arrivalSq = cellArrivalRadius²

# In every tick, scan id-ascending:
for id in actives:
    if (finishCell - pose).sq <= arrivalSq:
        finishes.push(id)
        if state.finishTick is null: state.finishTick = ctx.tick

# Cull condition (after the finish-scan):
if state.finishTick is not null and ctx.tick >= state.finishTick + finishGraceTicks:
    for id in actives \ finishesThisTick:
        eliminations.push({id, 'race_over'})
```

### Separation push

```
for j in actives \ {id}:
    d         = pose - other
    distSq    = d·d
    if distSq >= separationRadius²: skip
    if distSq < separationCoincidentEps²:
        pushX += (id < j ? +1 : -1) * separationForceMps
        continue
    dist     = sqrt(distSq)
    falloff  = 1 - dist / separationRadius
    pushX   += (d.x / dist) * separationForceMps * falloff
    pushZ   += (d.z / dist) * separationForceMps * falloff
```

### Wall clamp

```
cell = worldToCellId(pose)
half = cellSize/2 - wallMargin
if cell.wallMask & N: pose.z = max(pose.z, cell.z - half)
if cell.wallMask & S: pose.z = min(pose.z, cell.z + half)
if cell.wallMask & W: pose.x = max(pose.x, cell.x - half)
if cell.wallMask & E: pose.x = min(pose.x, cell.x + half)
```

### Variable ranges (defaults at S6 close)

| Symbol | `CONFIG.sim.mazeRace` | Value | Range | Effect |
|--------|-----------------------|-------|-------|--------|
| `baseSpeedMps` | yes | 4.5 | 1–10 | Race pace. Lower than sprint because robots steer along grid axes. |
| `cautionScale` | yes | 0.2 | 0–0.5 | How much Doubter slows a robot. |
| `chaosScale` | yes | 0.15 | 0–0.5 | Per-tick jitter amplitude scaled by Degen. |
| `cellArrivalRadius` | yes | 0.6 | 0.4–0.8 | Smaller = sharper corners. |
| `separationRadius` | yes | 1.8 | 1.0–2.5 | Boids push range; tuned to match `robotScale = 2` visual diameter. |
| `separationForceMps` | yes | 7.0 | 2–10 | Push magnitude at zero distance. |
| `separationCoincidentEps` | yes | 0.05 | 0–0.1 | Coincident-pair threshold. |
| `forwardBlockDist` | yes | 2.4 | 1–5 | Forward distance at which a blocking neighbor begins to slow the robot. |
| `forwardBlockLateralRadius` | yes | 1.0 | 0.5–2 | Lateral lane half-width for forward-block detection. |
| `wallMargin` | yes | 0.6 | 0.4–0.8 | Corridor clearance from wall. |
| `mistakeMaxRate` | yes | 0.6 | 0.3–0.7 | Cap on per-junction wrong-turn rate. |
| `finishGraceTicks` | yes | 4 | 0–60 | **Lever 2.** Ticks after first finish during which co-finishers are still emitted. |
| `chaosFeintScale` | yes | 0.15 | 0–0.3 | **Lever 3.** Per-unit-chaos additional non-optimal probability per junction. |
| `recoveryBonusTicks` | yes | 6 | 0–60 | **Lever 5.** Window in ticks where pMistake is dampened after a wrong turn. |
| `recoveryBonusFactor` | yes | 0.5 | 0–1 | **Lever 5.** Multiplier reduction on pMistake during recovery (1 − factor). |

---

## 5. Edge Cases

| Case | Behaviour |
|------|-----------|
| Robot spawns outside the grid (staging area) | First arrival check uses entrance cell as initial target. Wall clamp's `worldToCellId` returns `null` for out-of-grid positions → clamp skipped. Free motion until robot enters its entrance. |
| Junction with no mistake candidates (corridor / dead-end / 2-way junction with prev = the only alternative) | `pMistake` roll still consumes one `rng()` draw (preserves draw count per arrival), but the optimal direction is taken regardless. |
| Two robots within `separationCoincidentEps` distance | Deterministic id-based tiebreak — smaller id pushes +X, larger -X. They separate within ~1–2 ticks. |
| Two robots arrive at the finish cell on the same tick | Id-ascending iteration in `processFinish` — smaller id wins. The other is eliminated with `race_over` along with the rest of the field. |
| Robot reaches `targetCellId === finishCellId` mid-motion | Arrival snap fires; `processFinish` emits the finish event same tick. Motion phase early-returns to avoid double-processing. |
| `nextOnPath[arrivedCellId] === -1` (theoretical disconnected cell) | `pickNextCell` returns `-1`; motion early-returns; robot stops moving but stays active. The event would never end via finish — `isDone` would still return `false` until eliminations zero out the field. The maze generator's BFS guarantees this case doesn't happen for valid layouts. |
| Empty roster | `init` returns `[]`. `tick` is a no-op. `isDone` returns `true` immediately (no actives). |
| `dtSeconds = 0` | Motion is a no-op. Arrival can still fire if a robot was already at the threshold. |
| Robot's `prev` is the only non-optimal neighbor | Mistake candidates = `[]`. Always take optimal. Prevents 1-cell oscillation. |
| All robots eliminated before any reach the finish | `state.finished` stays `false`; `isDone` returns `true` because no actives remain. Engine emits `simEnd` with `winnerId = -1` (engine GDD edge case). |

---

## 6. Dependencies

### Inbound

- **[Sim Engine Core](sim-engine-core.md)** — implements
  `EventModule` interface; engine drives `init` / `tick` / `isDone`.
- **[Maze Generator](../../src/sim/maze.ts)** (no GDD; small
  utility) — `generateMazeLayout`, `cellIdWorldPos`,
  `worldToCellId`, `entranceOuterDir`. The `MazeLayout` is the
  module's primary input.
- **[Robot Roster Loader](robot-roster-loader.md)** — `stat.speed`,
  `stat.caution`, `stat.chaos`, `stat.pathfinding` are pre-derived.
- **[Trait → Stat Derivation](trait-to-stat-derivation.md)** —
  `stat.pathfinding` is the Cipher-driven knob this module reads
  for the wrong-turn rule.
- **[Arena Loader](arena-loader.md)** — supplies `arena.type ===
  'maze-race'` and `arena.mazeConfig`. The host generates the
  layout; the loader ensures the schema is well-formed.
- **[Config Module](config-module.md)** — `CONFIG.sim.mazeRace.*`.

### Outbound

- **[Sim Driver](sim-driver.md)** — consumes the resulting
  `SimResult` for browser playback.
- **[Camera System](camera-system.md)** — uses `MazeLayout`
  externally for camera framing (overhead static for Arena-02);
  does not read this module directly.
- **[Sim ↔ Renderer Bridge](../../src/sim/sim-renderer-bridge.ts)**
  — writes per-instance pose from the sim's pose stream.

### Forbidden dependencies

- **No DOM, no Three.js, no `requestAnimationFrame`** — strict
  Three.js-agnostic discipline.
- **No `Math.random`** — uses `ctx.rng` exclusively (which the
  engine seeds from the `runSim` seed).
- **No reads of real-time clock** (`Date.now`, `performance.now`).

---

## 7. Tuning Knobs

All knobs live under `CONFIG.sim.mazeRace`. See §4 for default
values + ranges. Tuning rationale below for the non-obvious ones:

- **`mistakeMaxRate = 0.6`** — chosen so low-Cipher robots
  (~21% per-junction mistake rate) accumulate ~12 detours over a
  typical race (~30 junctions on a shortest path), equating to
  roughly 16s of detour time. This was tuned to be **enough to
  wipe out a max-speed advantage** so Cipher is a meaningful
  counter to Full Send.
- **`baseSpeedMps = 4.5`** — lower than sprint-race (6.0)
  intentionally. Maze motion is multi-axial with frequent corner
  turns; an apples-to-apples baseline reads slower without
  feeling sluggish.
- **`separationForceMps = 5.0`** — slightly weaker than sprint
  (6.0) because the maze's tighter corridors amplify any push.
- **`wallMargin = 0.6`** — at default `robotScale = 2`, this
  leaves ~2.8 m of passable corridor between walls (cellSize 4 -
  2 × wallMargin = 2.8). Wider feels too easy; narrower causes
  visible friction with walls.

### Sprint 7 lever tuning (S7-02)

- **`finishGraceTicks = 4`** — chosen tight (~67 ms at 60 Hz). The
  entrance-staged 10-corner field is inherently spread across
  seconds; co-finishers only happen when 2+ robots from the same
  finish-corridor are in lockstep. The default catches genuine
  photo-finishes without diluting the "single winner" feel. Bump
  toward 30+ for a more "many-finisher" feel; v1 keeps it lean.
- **`chaosFeintScale = 0.15`** — at chaos = 1.0, Lever 3 adds
  ~15% per-junction feint rate on top of `pMistake`. Combined with
  max `pMistake` (0.42), the worst-case per-junction non-optimal
  rate is 0.57. This was tuned so high-Degen / max-Cipher robots
  still navigate well most of the time but occasionally feint —
  preserving Cipher's value as a counter while adding overtaking
  unpredictability.
- **`recoveryBonusTicks = 6`** + **`recoveryBonusFactor = 0.5`** —
  6 ticks = 100 ms at 60 Hz. The window is arming-only-on-mistake,
  so it only fires when the robot has just gone off-path. Halving
  `pMistake` for the next 100 ms lets the robot recover without
  immediately stumbling into another mistake; long enough to clear
  one or two cells.

---

## 8. Acceptance Criteria

> **Note**: maze-race shipped without a test suite in Sprint 6
> (caught in this GDD's reverse-doc). [`src/sim/maze-race.test.ts`](../../src/sim/maze-race.test.ts)
> (S7-02) covers the determinism, lifecycle, and lever criteria
> mechanically. Per-AC mapping is in the test file's `describe`
> blocks; the original criteria (AC-1 through AC-17) are still
> partly playtest-verified (motion smoothness, yaw correctness,
> wall-clamp visual) — the suite asserts the macroscopic
> invariants (no leakage, deterministic finish order, no Math.random)
> rather than per-rule behaviour.

### Determinism

- [ ] **AC-1.** Same `seed` + same `MazeConfig` → same `MazeLayout`.
- [ ] **AC-2.** Two `runSim` invocations with the same `seed` and
  arena produce byte-identical `SimResult`s.
- [ ] **AC-3.** `Math.random` is never called by the module
  (Vitest spy).
- [ ] **AC-4.** Two robots at identical world position produce
  deterministic id-tiebreak push directions.

### Motion

- [ ] **AC-5.** Robot speed is monotonic in `stat.speed` (higher
  speed → lower finish tick on a fixed seed, all else equal).
- [ ] **AC-6.** Caution slows a robot; chaos jitters its speed
  per-tick; both pre-derived from traits.
- [ ] **AC-7.** Wall-corridor clamp prevents pose from leaving
  the cell across a walled boundary.
- [ ] **AC-8.** Yaw points along steering direction, not
  post-push movement direction.

### Wrong-turn rule

- [ ] **AC-9.** A robot with `stat.pathfinding = 1.0` never
  takes a non-optimal neighbor at any junction.
- [ ] **AC-10.** A robot with `stat.pathfinding = 0.3` takes
  non-optimal neighbors with probability ≈
  `0.7 * mistakeMaxRate` per junction (statistical, large N).
- [ ] **AC-11.** `prevCellId` is never selected as a mistake
  candidate (no 1-cell oscillation).

### Finish

- [ ] **AC-12.** First robot within `cellArrivalRadius` of the
  finish cell wins; id-ascending tiebreak on same-tick arrivals.
- [ ] **AC-13.** All other active robots are eliminated with
  `race_over` on the same tick.
- [ ] **AC-14.** `eliminations.length + finishes.length ===
  active count at race-over tick`.
- [ ] **AC-15.** No further events emitted after `state.finished
  === true`.

### Lifecycle

- [ ] **AC-16.** Module is single-use — calling factory twice
  with the same `layout` yields independent instances.
- [ ] **AC-17.** `isDone` returns `true` only once all robots are
  inactive (so the engine continues to invoke `tick` during the
  grace window).

### Sprint 7 levers (S7-02)

- [ ] **AC-18.** **Lever 2 mechanism** — with
  `finishGraceTicks = 10000`, every active robot reaches the finish
  cell and emits a `finish` event; no `race_over` eliminations are
  emitted.
- [ ] **AC-19.** **Lever 2 places** — co-finishers receive places
  2, 3, … in id-ascending intra-tick order; `winnerId` is the
  first-place finisher (lowest tick, then lowest id).
- [ ] **AC-20.** **Lever 2 default** — with default
  `finishGraceTicks = 4`, the typical race produces a single
  finisher (sanity check that the default isn't accidentally
  generous).
- [ ] **AC-21.** **Lever 3** — at `chaos = 0`, max-Cipher robots
  always take optimal at junctions (no feint). At `chaos = 1`,
  max-Cipher robots still occasionally take non-optimal — observable
  via aggregate finish-tick comparison (chaos = 1 field finishes
  measurably slower than chaos = 0 field, all else equal).
- [ ] **AC-22.** **Lever 5** — with default
  `recoveryBonusFactor = 0.5`, low-Cipher fields finish at least as
  fast as with `recoveryBonusFactor = 0` (no recovery), aggregate
  across multiple seeds.
- [ ] **AC-23.** **Lever determinism** — the rng draw budget per
  active robot per tick remains:
  - 1 draw for chaos jitter (always).
  - 1 draw for arrival/junction selection (only when arrival fires).
  No additional rng calls were added by the levers. Determinism
  preserved across browser + harness for any seed.

---

## Implementation Notes

- File: [`src/sim/maze-race.ts`](../../src/sim/maze-race.ts)
  (~480 LOC after S7-02 levers).
- Companion utilities: [`src/sim/maze.ts`](../../src/sim/maze.ts)
  (recursive-backtracker generator + BFS shortest-path) — small
  enough to live without its own GDD.
- Test coverage: [`src/sim/maze-race.test.ts`](../../src/sim/maze-race.test.ts)
  (13 tests covering determinism, all three Sprint 7 levers, and
  the no-leakage invariant).
- Module shipped unplanned in Sprint 6 (`a340919` — "Arena-02 maze:
  grove visuals, shoulder cam, navigation traits") without a GDD.
  This file is the reverse-doc per Sprint 6 retro AI #7. S7-02
  added Levers 2 / 3 / 5 (R21–R25) at the same time.
