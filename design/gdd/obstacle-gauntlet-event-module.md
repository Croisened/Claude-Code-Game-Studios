# Obstacle Gauntlet Event Module — Game Design Document

> **Status**: Approved
> **Created**: 2026-05-04
> **Last Updated**: 2026-05-04
> **Sprint Task**: S7-04 + S7-06
> **Tier**: M
> **System Index**: design/gdd/systems-index.md

---

## 1. Overview

The **Obstacle Gauntlet Event Module** is the third concrete
`EventModule` implementation. It drives a single race down a linear
trap-laden course (`type === 'obstacle-gauntlet'`, Arena-03). The
course is divided into three trap stages by emergent geometry — pits,
hammer corridor, crumbling bridge — followed by an open run-out to
the finish line. Doubter-driven `stat.caution` is the favoured trait,
counter to all three trap types.

The module owns four things:

1. **Per-tick forward motion.** `+X` velocity derived from `stat.speed`,
   modulated by `stat.caution` (slow), `stat.chaos` (jitter), and a
   hammer-aware lookahead slowdown (Doubters time their pass).
2. **Pit-fall rolls.** Per-tick fall probability inside any pit zone,
   reduced by caution. Eliminates with `pit_fall`.
3. **Hammer-strike collisions.** Pure tick-arithmetic — a hammer is
   "down" during a configured phase window; robots inside the
   hammer's `killRadius` while down get hit. Eliminates with
   `hammer_strike`.
4. **Bridge-crumble eliminations.** A crumble line spawns at the
   bridge's start the moment the first active robot enters and
   advances forward at `crumbleSpeedMps`. Robots whose `pose.x` is
   below the crumble line and still on the bridge get eliminated
   with `bridge_fell`.

What the module deliberately does **not** own:

- Tick cadence, RNG instantiation, pose-frame snapshots, timeline
  event ordering — engine job (Sim Engine Core GDD).
- Trap geometry validation — the arena loader (extended in S7-04)
  enforces that gauntlet arenas carry a well-formed `gauntletConfig`.
- Trait → stat math — pre-derived at roster load time.
- Render-side concerns (pit visual band, swinging hammer mesh,
  crumbling bridge planks) — owned by
  `arena-visuals/gauntlet-traps.ts`. The visuals derive their state
  from the same sim tick the sim does, so browser and harness agree
  on what the world looks like.

The implementation in
[`src/sim/obstacle-gauntlet.ts`](../../src/sim/obstacle-gauntlet.ts)
is ~280 LOC. M-tier reflects the design surface (three trap types
with distinct mechanics + caution-aware slowdown + bridge-crumble
state).

---

## 2. Player Fantasy

The Gauntlet is the **survivor's** event. Where Sprint Race rewards
"fast and forward" and Maze Race rewards "smart and adaptive,"
Obstacle Gauntlet rewards "careful and lucky":

> **"Watch your step. Time your sprint. Don't be on the bridge when it
> goes."**

The viewer scans the field for who's hesitating at the right moments.
A robot pausing before a hammer pillar is *good* — they're timing it.
A robot blasting past unimpeded is taking a risk. Some risks pay off;
most don't.

Doubter is the favoured trait per
[game-concept.md §3](./game-concept.md). The module makes that legible
in three places:

- **Pit zones** — per-tick fall probability scales `(1 - caution *
  cautionPitSafety)`. Caution-1 robots fall ~7% over the zone;
  caution-0 robots fall ~52%.
- **Hammer corridor** — caution drives the lookahead-slowdown
  multiplier. Caution ≥ ~0.55 robots brake to a full stop and wait
  for the hammer to clear; caution < 0.55 robots brake but keep
  moving (and many die).
- **Bridge** — caution doesn't directly help here. The bridge is
  the FINAL filter: even high-caution robots can lose if their speed
  is too low relative to the crumble (low Full Send) — they get
  caught by the advancing crumble line. The favoured-trait pattern
  emerges from the COMPOSITE: Doubter robots survive pits + hammers,
  but they need *some* speed to outrun the crumble.

Determinism is the substrate. Same seed → same gauntlet → same
finishing order, in browser and harness.

---

## 3. Detailed Rules

### Construction & state

- **R1.** `createObstacleGauntletModule()` returns an `EventModule`.
  No options — the gauntlet is fully data-driven from the arena's
  `gauntletConfig`.
- **R2.** Per-event state (lazily initialised on first `init` /
  `tick`):
  - `bridgeEnteredTick: number | null` — tick of the FIRST active
    robot crossing into the bridge (`pose.x ≥ bridge.xStart`).
    Drives crumble-line advancement.
  - `finished: boolean` — set true once a robot crosses the finish
    line. Same role as in maze-race v1 (no grace window for gauntlet).

### Initial pose layout (`init`)

- **R3.** `init` returns one `RobotPose` per roster entry, placed via
  the engine's `buildStartPoses` helper from `arena.startGrid`.
  Sprint-race-style row-major fill across lanes × rows.
- **R4.** All robots spawn `active = true` with `yaw = 0` (facing +X).
  No staging-area flair like the maze; the gauntlet is a sprint-style
  start.

### Per-tick motion (`advanceMotion`)

- **R5.** Robots iterate id-ascending. Inactive robots skip every
  phase, including RNG consumption.
- **R6.** Speed = `baseSpeedMps * stat.speed * cautionFactor * jitter
  * hammerSlowdown`, where:
  - `cautionFactor = 1 - stat.caution * cautionScale`
  - `jitter = 1 + (rng() * 2 - 1) * stat.chaos * chaosScale`
  - `hammerSlowdown = max(0, 1 - stat.caution * cautionHammerSlowdown)`
    if any hammer ahead within `hammerLookaheadM` is **currently
    down** at `ctx.tick`. Otherwise `1.0`.
- **R7.** `rng()` is called **exactly once per active robot per tick**
  for chaos jitter. Pit-fall rolls (R10) call `rng()` **conditionally
  once more**, only for robots currently inside a pit zone. Iteration
  order is id-ascending so the bounded-but-conditional sequence is
  deterministic.
- **R8.** Robots only move forward (`pose.x += speed * dt`). The
  hammer-aware slowdown can drive speed to 0 but never negative. yaw
  is fixed at 0.
- **R9.** Lateral separation: Boids-style 2D push along z, identical
  in shape to sprint-race. id-ascending iteration; coincident-pair
  id-tiebreak; clamp to `±width/2 - lateralBoundMargin`.

### Pit-fall rolls

- **R10.** For every active robot whose `pose.x ∈ [pit.xStart,
  pit.xEnd]` for ANY pit zone, consume one additional `rng()` draw:
  - `pFall = pitFallRatePerTick * (1 - stat.caution * cautionPitSafety)`
  - If `u < pFall` → eliminated `pit_fall` this tick.
- **R11.** Pit zones are full-width (no per-lane geometry in v1).
  Robots can't "step around" pits; the only counter is caution.
- **R12.** A robot can only be eliminated once per tick. If they're
  in a pit AND a hammer is down at their position, the pit roll
  fires first (Phase B precedes Phase C); the hammer phase skips
  already-eliminated robots.

### Hammer-strike eliminations

- **R13.** For each hammer in `gauntletConfig.hammers`:
  - Determine if the hammer is **down** at the current tick:
    `phase = ((tick % cycleTicks) + cycleTicks) % cycleTicks`,
    hammer is down iff `phase ∈ [downStartTick, downEndTick)`.
  - If down: any active robot with `|pose.x - hammer.x| <
    killRadius` is eliminated `hammer_strike`.
- **R14.** Hammer phase derives **purely** from the sim tick — no
  rng. The renderer reads the same predicate to drive visual hammer
  rotation, so visual and sim agree on hammer position every frame.
- **R15.** Hammer windows do NOT wrap around the cycle boundary in
  v1 — the loader rejects `downEndTick > cycleTicks`. Wrapping
  windows are a v1.x add if needed.
- **R16.** Multiple hammers may have overlapping kill phases. A
  robot at the boundary of two hammer kill zones could in principle
  be hit by both, but the sim emits at most one `hammer_strike` per
  robot per tick (Phase C skips already-eliminated robots).

### Bridge-crumble eliminations

- **R17.** The first time any active robot has `pose.x ≥ bridge.xStart`,
  set `state.bridgeEnteredTick = ctx.tick`. The crumble has begun.
- **R18.** Once crumble is active, compute the crumble line each tick:
  `crumbleX = bridge.xStart + crumbleSpeedMps * (ctx.tick -
  bridgeEnteredTick) / tickRateHz`.
- **R19.** Any active robot with `bridge.xStart ≤ pose.x < crumbleX`
  AND `pose.x ≤ bridge.xEnd` (still ON the bridge) is eliminated
  `bridge_fell` this tick.
- **R20.** Robots past `bridge.xEnd` are SAFE — the crumble doesn't
  pursue them off the bridge. Robots before `bridge.xStart` are
  also unaffected (they haven't reached the bridge).
- **R21.** The crumble line is **monotonic**: it never recedes. State
  doesn't track per-segment crumble; the line advances and stays.

### Finish detection

- **R22.** The first active robot whose `pose.x ≥ arena.length`
  emits a `finish` event with the engine assigning place 1.
- **R23.** Same-tick ties resolve id-ascending (the loop iterates id
  order; first hit wins).
- **R24.** On finish, every other still-active, not-yet-this-tick-
  eliminated robot is eliminated `race_over`.
- **R25.** Single-finisher race in v1. Unlike maze (Lever 2 grace
  window), gauntlet's race ends instantly on first finish. Per
  game-concept §3 ("first across or last standing wins") this is
  intended.

### "No-winner" outcomes

- **R26.** The gauntlet permits `winnerId === null` (no finisher).
  This happens when every robot is killed by a trap before reaching
  the finish line. Per game-concept §3 — "last standing" can be
  zero. The App handles `winnerId === null` by simply not rendering
  the WinnerCard / Winner Camera.

### Termination (`isDone`)

- **R27.** Returns `true` once every robot is inactive (finished
  or eliminated). Mirrors sprint-race; simpler than maze (no
  grace window).

---

## 4. Formulas

### Motion + hammer slowdown

```
cautionFactor    = 1 - stat.caution * cautionScale
jitter           = 1 + (rng()*2 - 1) * stat.chaos * chaosScale
baseSpeed        = baseSpeedMps * stat.speed * cautionFactor * jitter
hammerSlow       = max(0, 1 - stat.caution * cautionHammerSlowdown)
                   if any hammer ahead in [pose.x, pose.x + lookahead]
                   is currently down; else 1.0
speed            = baseSpeed * hammerSlow
pose.x          += speed * dt
pose.z          += pushZ * dt          # Boids separation
pose.z           = clamp(pose.z, -halfWidth + margin, halfWidth - margin)
pose.yaw         = 0
```

### Pit-fall roll (only when inside a pit zone)

```
pFall = pitFallRatePerTick * (1 - stat.caution * cautionPitSafety)
u     = rng()
if u < pFall: eliminated 'pit_fall'
```

### Hammer-down predicate

```
phase     = ((tick % cycleTicks) + cycleTicks) % cycleTicks
isDown    = phase >= downStartTick && phase < downEndTick
```

### Hammer-strike collision

```
if isDown(hammer, tick) and abs(pose.x - hammer.x) < hammer.killRadius:
    eliminated 'hammer_strike'
```

### Bridge-crumble eliminations

```
if bridgeEnteredTick is null:
    if any active robot has pose.x >= bridge.xStart:
        bridgeEnteredTick = tick

if bridgeEnteredTick is not null:
    ticksSince = tick - bridgeEnteredTick
    crumbleX   = bridge.xStart + crumbleSpeedMps * ticksSince / tickRateHz
    for each active robot:
        if pose.x < crumbleX and bridge.xStart <= pose.x <= bridge.xEnd:
            eliminated 'bridge_fell'
```

### Variable ranges (defaults at S7-04 close)

| Symbol | `CONFIG.sim.gauntletRace` | Value | Range | Effect |
|--------|---------------------------|-------|-------|--------|
| `baseSpeedMps` | yes | 6 | 1–10 | Course pace, same as sprint. |
| `cautionScale` | yes | 0.2 | 0–0.5 | How much Doubter slows base motion. |
| `chaosScale` | yes | 0.15 | 0–0.5 | Per-tick jitter amplitude scaled by Degen. |
| `pitFallRatePerTick` | yes | 0.0012 | 0–0.01 | Per-tick fall probability before caution. |
| `cautionPitSafety` | yes | 0.95 | 0.5–1 | Caution multiplier in pit-fall safety. |
| `hammerLookaheadM` | yes | 12 | 5–30 | Forward distance robots scan for hammers. |
| `cautionHammerSlowdown` | yes | 1.8 | 0–3 | Caution multiplier in hammer-aware brake. |
| `separationRadius` | yes | 1.4 | 1–2.5 | Boids push range. |
| `separationForceMps` | yes | 4.5 | 2–10 | Push magnitude at zero distance. |
| `separationCoincidentEps` | yes | 0.05 | 0–0.1 | Coincident-pair threshold. |
| `lateralBoundMargin` | yes | 0.5 | 0–2 | Distance from arena z-edge for clamp. |
| arena `crumbleSpeedMps` | per-arena | 3.0 | 1–10 | Crumble line advance rate. |

---

## 5. Edge Cases

| Case | Behaviour |
|------|-----------|
| Robot crosses pit zone in 0 ticks (impossible — but consider zero-width zone) | Loader rejects `xEnd <= xStart`. Theoretical edge; never reached. |
| Robot inside multiple overlapping pit zones | Fall roll fires once per tick (a single Phase B pass covers the robot regardless of how many zones contain it). |
| Hammer with `cycleTicks = 1` | Loader requires `cycleTicks >= 1`. With cycle=1 and downEndTick=1, hammer is always down. Robots within killRadius of it die instantly. Valid edge — used as a "dead zone." |
| Hammer with `downStartTick = downEndTick` | Loader rejects (`downStartTick >= downEndTick`). |
| Bridge entered the same tick as a robot eliminated by a hammer | The pit/hammer eliminations process BEFORE the bridge-detection; the freshly-eliminated robot doesn't count for bridge entry. The next active robot to cross triggers it. |
| Bridge entered AND finish reached in same tick | Engine processes Phase E (finish) AFTER Phase D (bridge crumble). If a robot reaches the finish line same tick as bridge entry, finish wins — the crumble is on its first tick (crumbleX = bridge.xStart) and only catches robots already behind that line. |
| `bridgeEnteredTick` set but bridge subsequently has no actives | Crumble continues advancing each tick, catching up to and past `bridge.xEnd`. After that point no further `bridge_fell` events emit (the predicate `pose.x < crumbleX AND ≤ xEnd` fails for robots past xEnd). |
| Empty roster | `init` returns `[]`; `tick` is a no-op; `isDone` returns true. Engine immediately ends sim. |
| `dtSeconds = 0` | Motion is no-op; pit/hammer/bridge phases still evaluate against current positions. Theoretical — engine always passes a non-zero dt. |
| All robots eliminated before finish | `isDone` returns true (no actives); `winnerId` resolves to `null` per the engine's `finishOrder.length > 0 ? finishOrder[0] : null`. App handles gracefully (no WinnerCard, no Winner Camera). |
| Robot starts already past `bridge.xStart` (impossible per arena layout, but defensive) | If true at construction (e.g., a hostile arena puts startGrid past bridge), `bridgeEnteredTick` would set immediately on tick 0. Crumble starts moving. Loader can't currently catch this — relies on arena authors. |

---

## 6. Dependencies

### Inbound

- **[Sim Engine Core](sim-engine-core.md)** — implements
  `EventModule`; engine drives `init` / `tick` / `isDone`.
- **[Robot Roster Loader](robot-roster-loader.md)** — `stat.speed`,
  `stat.caution`, `stat.chaos` are pre-derived.
- **[Trait → Stat Derivation](trait-to-stat-derivation.md)** —
  Doubter → caution is the favoured trait coupling for this event.
- **[Arena Loader](arena-loader.md)** — supplies `arena.type ===
  'obstacle-gauntlet'` and `arena.gauntletConfig` (PitZone[],
  HammerSpec[], BridgeSpec). The loader validates trap ordering
  (pits → hammers → bridge → finish) and per-trap shape.
- **[Config Module](config-module.md)** — `CONFIG.sim.gauntletRace.*`.

### Outbound

- **[Sim Driver](sim-driver.md)** — consumes the resulting
  `SimResult` for browser playback.
- **[Camera System](camera-system.md)** — gauntlet uses
  Follow-Leader along +X (sprint-race default). No bespoke gauntlet
  camera mode in v1.
- **[Sim ↔ Renderer Bridge](../../src/sim/sim-renderer-bridge.ts)**
  — writes per-instance pose from the sim's pose stream.
- **`src/arena-visuals/gauntlet-traps.ts`** — reads the arena's
  trap config for visual layout AND reads the sim tick each frame
  for hammer rotation + bridge crumble. Sim-authoritative.

### Forbidden dependencies

- **No DOM, no Three.js** — Three.js-agnostic discipline.
- **No `Math.random`** — uses `ctx.rng` exclusively.
- **No real-time clock reads** — `Date.now`, `performance.now`,
  `requestAnimationFrame` are all forbidden inside the module.

---

## 7. Tuning Knobs

All knobs live under `CONFIG.sim.gauntletRace`. Plus per-arena
parameters in `gauntletConfig` (pit ranges, hammer specs, bridge
spec). See §4 for default values + ranges.

### Tuning rationale

- **`pitFallRatePerTick = 0.0012`** — calibrated against the actual
  Robo Rhapsody roster's Doubter distribution (mean ~17/100). At
  median caution and 18 m × 6 m/s = ~3 s = 180-tick exposure,
  cumulative fall rate is ~17%. Caution-0 robots fall ~22%;
  caution-1 robots fall ~3.6%. Tuned so the pits filter
  meaningfully but don't wipe the field on their own — hammers and
  bridge still need to cull.
- **`cautionHammerSlowdown = 1.8`** — chosen so robots with
  caution ≥ ~0.55 (Doubter ≥ 55) brake to a full stop and reliably
  time the hammer. Lower-caution robots brake less and take their
  chances. The sharp threshold makes Doubter the favoured trait
  with a visible cliff: high-Doubter robots survive, low-Doubter
  don't.
- **`hammerLookaheadM = 12`** — ~2 seconds at full speed. Long
  enough that robots react before reaching the kill zone but short
  enough that they can't anticipate hammers further down the
  corridor.
- **`crumbleSpeedMps = 3.0`** (per-arena, in arena-03.json) — slow
  enough that even low-Full-Send robots can outrun it (their
  effective speed at base 6 × stat.speed 0.5 = 3 m/s matches the
  crumble; faster robots gain ground). Tighter than this and slow
  robots can't escape the bridge.

### Trap-layout tuning (per-arena)

Arena-03 defaults at S7-04 close:

- 1 pit zone: `[60, 78]` (18 m wide).
- 3 hammers: `x=110, 128, 146`, `cycleTicks=80`,
  `killRadius=1.0`, staggered down windows
  `[0,20], [28,48], [56,76]`.
- Bridge: `[175, 220]`, `crumbleSpeedMps=3.0`.

The down-window stagger gives clean "all-three-up" gaps in the
cycle — fast low-Doubter robots can occasionally luck through.
High-Doubter robots reliably wait it out.

---

## 8. Acceptance Criteria

Mechanically tested by
[`src/sim/obstacle-gauntlet.test.ts`](../../src/sim/obstacle-gauntlet.test.ts)
(10 tests).

### Determinism

- [ ] **AC-1.** Same `seed` + same arena → byte-identical events,
  finish order, winnerId, ticks.
- [ ] **AC-2.** No `Math.random` calls anywhere in the module
  (Vitest spy).
- [ ] **AC-3.** Two robots at identical world position produce
  deterministic id-tiebreak push directions (separation rule).

### Trap mechanics

- [ ] **AC-4.** `pit_fall` eliminations only fire when the robot's
  recorded position at the elimination tick falls inside a pit
  zone's `[xStart, xEnd]` range.
- [ ] **AC-5.** `hammer_strike` eliminations only fire when the
  robot's position at the elimination tick is within `killRadius` of
  some hammer's `x`.
- [ ] **AC-6.** `bridge_fell` eliminations only fire when the
  robot's position at the elimination tick is in `[bridge.xStart,
  bridge.xEnd]`.
- [ ] **AC-7.** Hammer-down predicate is purely a function of the
  tick — no RNG, no real-time clock.

### Caution favouring

- [ ] **AC-8.** A high-Doubter roster (uniform Doubter ≥ 80)
  produces a finisher in more seeds than a low-Doubter roster
  (uniform Doubter ≤ 5), tested across multiple seeds.
- [ ] **AC-9.** With caution = 0 (no Doubter), hammer-aware
  slowdown is `1.0` (no brake) regardless of hammer state.
- [ ] **AC-10.** With caution ≥ ~0.56 (`1 - 0.56*1.8 = 0` floor),
  the hammer-aware slowdown is `0` when a hammer ahead is down —
  full stop.

### Lifecycle

- [ ] **AC-11.** `eliminations.length + finishOrder.length ===
  rosterSize` for every seed (no robot leakage).
- [ ] **AC-12.** A robot never appears in both `finishOrder` and
  `eliminations`.
- [ ] **AC-13.** When a finisher exists, exactly one `finish`
  event is emitted with `place = 1`; the rest of the field is
  eliminated `race_over`.
- [ ] **AC-14.** When no finisher (all dead by traps), `winnerId
  === null`; this is a permitted outcome.
- [ ] **AC-15.** `isDone` returns `true` once all robots are
  inactive.

### RNG draw budget

- [ ] **AC-16.** Per active robot per tick, exactly:
  - 1 draw for chaos jitter (always).
  - 1 conditional draw for pit-fall roll (only when inside a pit
    zone).
  No additional draws.

---

## Implementation Notes

- File: [`src/sim/obstacle-gauntlet.ts`](../../src/sim/obstacle-gauntlet.ts)
  (~280 LOC).
- Tests: [`src/sim/obstacle-gauntlet.test.ts`](../../src/sim/obstacle-gauntlet.test.ts)
  (10 tests covering determinism, trap mechanics, caution favouring,
  and lifecycle invariants).
- Visuals:
  [`src/arena-visuals/gauntlet-traps.ts`](../../src/arena-visuals/gauntlet-traps.ts)
  — pit dark band, swinging-hammer mesh + arm rotation derived from
  sim tick, crumbling-bridge planks that hide as the crumble line
  advances. Sim-authoritative throughout.
- Arena: [`assets/data/arenas/arena-03.json`](../../assets/data/arenas/arena-03.json)
  — 240 m linear course with 1 pit zone, 3 hammers, 1 bridge.
- Spike-first pattern (Sprint 4–6 default): implementation + tests
  + arena JSON landed first, GDD reverse-documented from working
  code. Tuning iterated against headless harness output before any
  visuals were authored.
