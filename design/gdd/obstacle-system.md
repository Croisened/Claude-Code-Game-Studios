# Obstacle System

> **Status**: Approved
> **Author**: Nathanial Ryan + Claude Code
> **Last Updated**: 2026-03-27
> **Implements Pillar**: The City Hunts You, Two-Week Discipline

## Overview

The Obstacle System spawns, moves, and destroys the threats that make the runner a
survival game. It maintains a small pool of reusable obstacle objects, places them
in valid lane positions ahead of the robot, moves them at `currentSpeed` toward the
robot each tick, and returns them to the pool when they scroll past. Each obstacle
type has a defined hitbox, spawn pattern, and visual profile stored in an Obstacle
Type Registry. The system listens to Game State Manager events to start/stop
spawning and registers Rapier colliders on each active obstacle so that the Runner
System's collision callback fires automatically on contact. Without this system, the
runner has no threat, no tension, and no reason to react — the core loop does not
exist.

## Player Fantasy

Obstacles are the city acting. A surveillance drone swoops across the lane just as
the robot commits to a path — the city anticipated the move. A crash barrier
materializes at the last moment — the infrastructure is being weaponized. The player
never thinks "a spawn timer fired"; they think "the city is getting faster and
smarter." The satisfaction is surviving what feels unavoidable: the dodge that
requires reading two obstacles at once, the split-second choice between jumping the
barrier or sliding under the drone in the same lane. Each obstacle type teaches the
player a new hazard vocabulary, and the rising density of those hazards is what
transforms the run from a jog into a chase.

## Detailed Design

### Core Rules

1. The system pre-allocates a fixed pool of 6 obstacle objects at startup: 3 Barriers
   + 3 Drones. All begin inactive. The pool never grows or shrinks at runtime.
2. Obstacle types and their properties are defined in the **Obstacle Type Registry**
   (see sub-section below). No type-specific logic lives outside the Registry.
3. During `Running` state, a spawn timer counts up by `delta` each tick. When
   `spawnTimer ≥ spawnInterval`:
   - Reset `spawnTimer = 0`
   - Pick a random type from the Registry (uniform distribution)
   - Pick a random lane from `{LANE_LEFT, LANE_CENTER, LANE_RIGHT}`
   - Apply minimum gap check: if any active obstacle is within `minObstacleGap` units
     of the spawn Z position (i.e., `abs(active.position.z − (−spawnDistance)) <
     minObstacleGap`), skip this spawn
   - Retrieve one inactive instance of that type from the pool; if none available,
     skip and log a warning
   - Set position: X = chosen lane, Y = type's `centerY`, Z = `−spawnDistance`
   - Enable the Rapier **kinematic body**; assign `OBSTACLE_GROUP` collision filter.
     Each obstacle uses a kinematic (not dynamic) Rapier body — position is set via
     `rapierBody.setNextKinematicTranslation()` each tick, not via direct Three.js
     position write. This prevents Rapier's physics simulation from overriding the
     scripted Z movement.
   - Mark obstacle as active
4. Every tick during `Running` state, each active obstacle moves toward the robot:
   `obstacle.position.z += RS.currentSpeed × delta`
   (`RS.currentSpeed` is read directly from Runner System's exposed property.)
5. When `obstacle.position.z > recycleThreshold`, the obstacle is deactivated:
   Rapier body disabled, position reset to safe off-screen Z, returned to pool.
6. On `→ Dead`: halt spawn timer; halt position updates; leave active obstacles frozen
   in place (visible behind the dead robot).
7. On `→ ScoreScreen` or `→ MainMenu`: deactivate all active obstacles; return all to
   pool; reset `spawnTimer = 0`.
8. On `→ Running` (restart from any state): deactivate all obstacles; return all to
   pool; reset `spawnTimer = 0`; resume spawn timer and movement.

### Obstacle Type Registry

| Type | Hitbox W×H×D | Center Y | Blocks Standing (0–1.8) | Blocks Crouched (0–0.9) | Clears Jump (base ≥ 2.7) | Required Response |
|------|-------------|---------|------------------------|------------------------|--------------------------|------------------|
| Barrier | 0.8 × 1.0 × 0.8 | 0.5 | ✅ (0–1.0 overlaps 0–1.8) | ✅ (0–1.0 overlaps 0–0.9) | ✅ (robot base ≥ 2.7 > barrier top 1.0) | JUMP or LANE CHANGE |
| Drone | 0.8 × 0.5 × 0.8 | 1.25 | ✅ (1.0–1.5 overlaps 0–1.8) | ❌ (drone bottom 1.0 > crouched top 0.9 — no overlap; slide clears it) | Irrelevant (lane change is simpler) | SLIDE or LANE CHANGE |

> Drone clearance: crouched robot top = 0.9 units; drone bottom = 1.0 units. No overlap. Slide clears it.
> For v1, add more types here without changing any other system logic.

### Object Pool

- **Allocation**: 3 Barrier objects + 3 Drone objects created once at startup, never
  garbage-collected during a session.
- **Acquisition**: on spawn, take the first inactive instance of the requested type.
  If all instances of that type are active, skip the spawn and log:
  `"Obstacle pool exhausted: [Barrier|Drone]"`.
- **Release**: on recycle, set `active = false`, disable Rapier body, reset `position.z`
  to a safe off-screen value. The instance is immediately available for the next spawn.
- Back-to-back spawns of the same type consume multiple pool slots. At default settings,
  max 2–3 obstacles are active simultaneously — well within the pool capacity.

### States and Transitions

The Obstacle System has no internal state machine. All behavior is GSM-driven.

| GSM Transition | Obstacle System Action |
|----------------|------------------------|
| `→ Running` (from any) | Deactivate all obstacles; return all to pool; reset `spawnTimer = 0`; begin ticking spawn timer and obstacle movement |
| `→ Dead` | Halt spawn timer; halt obstacle position updates; leave obstacles frozen at current positions |
| `→ ScoreScreen` | Deactivate all obstacles; return all to pool; reset `spawnTimer = 0` |
| `→ MainMenu` | Deactivate all obstacles; return all to pool; reset `spawnTimer = 0` |
| `→ Loading`, `→ Leaderboard` | No action |

### Interactions with Other Systems

| System | Direction | Interface |
|--------|-----------|-----------|
| Game State Manager | OS listens | Subscribes to `stateChanged(from, to)`; drives all spawn/freeze/reset behavior per table above |
| Runner System | OS reads | Reads `RS.currentSpeed` every tick for obstacle Z movement |
| Environment Renderer | OS reads | Reads `LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT` at init for valid spawn X positions |
| Rapier (via enable3d) | OS drives | Enables/disables Rapier body per obstacle; assigns `OBSTACLE_GROUP` collision filter; Runner System's `onCollisionEnter` fires automatically on robot-obstacle contact |
| Difficulty Curve | OS receives | Difficulty Curve calls `OS.setSpawnInterval(newInterval)` in v1 to tighten spawn rate |

## Formulas

**Obstacle Z movement (every tick, all active obstacles):**
```
obstacle.position.z += RS.currentSpeed × delta
```

**Recycle check (every tick, all active obstacles):**
```
if obstacle.position.z > recycleThreshold:
    deactivate(obstacle)
```

**Spawn timer:**
```
spawnTimer += delta
if spawnTimer >= spawnInterval:
    spawnTimer = 0
    trySpawn()
```

**Minimum gap check (at spawn time):**
```
for each activeObstacle:
    if abs(activeObstacle.position.z − (−spawnDistance)) < minObstacleGap:
        skip spawn, return
```

**Reaction time (informational — not enforced in code):**
```
reactionTime = spawnDistance / RS.currentSpeed

At initialScrollSpeed (8 units/s):   30 / 8  = 3.75 seconds
At maxSpeed         (25 units/s):    30 / 25 = 1.20 seconds
```

**Variable table:**

| Variable | Description | Default |
|----------|-------------|---------|
| `spawnInterval` | Seconds between spawn attempts | 2.0 |
| `spawnDistance` | Z distance ahead of robot where obstacles are placed | 30 units |
| `recycleThreshold` | Z distance past robot triggering recycle | 5 units |
| `minObstacleGap` | Minimum Z distance between new spawn and any active obstacle | 8 units |
| `poolSize` | Pre-allocated instances per obstacle type | 3 each |
| `RS.currentSpeed` | Current scroll speed (read from Runner System) | 8–25 units/s |

**Hitbox clearance verification (at defaults):**
```
Barrier top    = 0.5 + 0.5   = 1.0 units
Robot jump base at peak       ≈ 2.7 units
Clearance: 2.7 − 1.0 = 1.7 units  ✅  Comfortable jump margin

Drone bottom   = 1.25 − 0.25 = 1.0 units
Crouched robot top            = 0.9 units
Clearance: 1.0 − 0.9 = 0.1 units  ⚠  Intentionally tight
```

> Drone clearance is intentionally tight (0.1 units) — slide must be committed, not
> accidental. If Rapier reports false positives at frame boundaries, add a −0.05 unit
> negative margin to the drone collider height or raise drone `centerY` to 1.3.
> Verify empirically during implementation.

## Edge Cases

| Scenario | Expected Behavior | Rationale |
|----------|------------------|-----------|
| Spawn timer fires but pool of requested type is exhausted | Skip spawn; log warning; reset timer normally | Run continues; missing one obstacle is acceptable |
| Two obstacles in same lane spawned in rapid succession | Minimum gap check prevents if within `minObstacleGap` of each other | Unnavigable blocking is a design concern, not a crash |
| Same lane spawned 3+ consecutive times (bad random streak) | No special prevention at MVP — random is random | Adding "no-repeat lane" logic is a v1 tuning option; adjust `minObstacleGap` if frustration is observed |
| Robot mid-jump when a Drone spawns in current lane | No special handling — robot above drone clears it. Intended. | Drone only blocks standing/crouched robot |
| `RS.currentSpeed` reads 0 | Obstacles don't move; remain at spawn Z | Valid transient state; movement resumes next tick |
| `→ Dead` fires while an obstacle is mid-recycle frame | If obstacle crossed `recycleThreshold` on the same frame as Dead, it may recycle; both outcomes acceptable | Dead robot already passed the obstacle |
| Obstacle recycled on the exact frame of collision | Rapier collision callback fires before update loop recycle check; `collisionDetected` fires normally | Physics callbacks precede the update tick |
| `OS.setSpawnInterval(0)` or negative value | Clamp to `minSpawnInterval = 0.3s`; log warning | Zero/negative interval would flood the pool and fire endless warnings |
| Obstacle Z is exactly equal to `recycleThreshold` | Strict `>` check; equal values are not recycled; obstacle recycles on the next tick | Avoids one-frame boundary flicker |

## Dependencies

| System | Direction | Nature | Hard/Soft |
|--------|-----------|--------|-----------|
| Game State Manager | Upstream | OS subscribes to `stateChanged`; drives all spawn/freeze/reset behavior | **Hard** — without GSM, OS has no trigger to start or stop |
| Runner System | Upstream | OS reads `RS.currentSpeed` each tick for obstacle Z movement | **Hard** — without speed, obstacles are static while the world scrolls |
| Environment Renderer | Upstream | OS reads `LANE_LEFT`, `LANE_CENTER`, `LANE_RIGHT` at init | **Hard** — without lane constants, OS cannot place obstacles in valid X positions |
| Runner System (collision) | Downstream via Rapier | OS assigns `OBSTACLE_GROUP` filter; Rapier fires Runner System's callback automatically on contact | **Hard** — without collision group, Runner System cannot distinguish obstacles from ground; `collisionDetected` never fires |
| Difficulty Curve | Downstream | Difficulty Curve calls `OS.setSpawnInterval(newInterval)` in v1 | **Soft** — OS operates at constant `spawnInterval` without Difficulty Curve |

**Bidirectional consistency:**
- Runner System GDD: "Obstacle System registers Rapier colliders; OS must NOT emit `collisionDetected` directly." ✅
- Runner System GDD: "Provisional: obstacles assigned `OBSTACLE_GROUP`." ✅ Resolved here.
- Environment Renderer GDD: "LANE constants are read-only; no system other than ER may modify them." ✅
- GSM GDD: "Obstacle System: begin spawning `→ Running`; freeze `→ Dead`; despawn `→ MainMenu/ScoreScreen`." ✅

**Provisional contracts** (Difficulty Curve not yet designed):
- Difficulty Curve must call `OS.setSpawnInterval(interval)` only. It must NOT manipulate obstacle positions or call `RS.setSpeed()` directly.
- `minSpawnInterval = 0.3s` is the absolute floor; Difficulty Curve must not push below this.

## Tuning Knobs

| Knob | Default | Safe Range | Effect | Breaks If… |
|------|---------|------------|--------|------------|
| `spawnInterval` | 2.0s | 0.3 – 5.0s | Time between spawn attempts; lower = denser | < 0.3: pool exhausts before recycle; > 5.0: game trivially easy |
| `spawnDistance` | 30 units | 15 – 60 | How far ahead obstacles appear | < 15: reaction time < 0.6s at maxSpeed (unfair); > 60: obstacles barely visible during slow phase |
| `recycleThreshold` | 5 units | 1 – 15 | Distance past robot before recycle | < 1: may recycle same frame as collision; > 15: unnecessary lingering objects |
| `minObstacleGap` | 8 units | 3 – 20 | Minimum Z gap between consecutive spawns | < 3: back-to-back obstacles in adjacent lanes can become unnavigable; > 20: never close together, loses tension |
| `poolSize` | 3 per type | 2 – 6 | Pre-allocated instances per type | < 2: pool exhausted at moderate spawn rates; > 6: unnecessary allocation |
| Drone `centerY` | 1.25 | 1.1 – 1.5 | Drone hitbox elevation (affects slide clearance) | < 1.1: crouched robot clips drone (clearance < 0.05); > 1.5: drone unrealistically high |
| Barrier hitbox H | 1.0 | 0.7 – 1.5 | Barrier height (affects jump clearance) | > 1.5: jump may not clear; < 0.7: visually unconvincing |
| `minSpawnInterval` | 0.3s | — | Hard floor for `setSpawnInterval()` calls | Removing guard: pool exhaustion and log flood at Difficulty Curve extremes |

**Interaction notes:**
- `spawnInterval` + `spawnDistance` together determine density. Reduce both to increase pressure without changing individual reaction time.
- `minObstacleGap` + `spawnInterval` interact — a very short interval with a large gap causes silent skip-heavy runs.
- Drone `centerY` and Runner System `crouchedCollider` height interact — if crouched height changes, re-verify drone clearance.

All knobs defined in `OBSTACLE_SYSTEM_CONFIG`. Obstacle Type Registry values in `OBSTACLE_TYPE_REGISTRY`. No magic numbers in code.

## Visual/Audio Requirements

[To be designed — v1 art pass]

## UI Requirements

None. Obstacle System produces no UI elements.

## Acceptance Criteria

- [ ] 6 obstacle objects (3 Barrier + 3 Drone) are pre-allocated and inactive at scene startup
- [ ] No obstacle objects are allocated or garbage-collected during a run
- [ ] First obstacle spawns after `spawnInterval` seconds from `→ Running` transition
- [ ] Each spawned obstacle appears at Z = −30 units from the robot (spawnDistance)
- [ ] Each spawned obstacle is placed at one of the three valid lane X positions (−3, 0, +3)
- [ ] Obstacles move toward the robot at `RS.currentSpeed` units/second each tick
- [ ] An obstacle reaching Z > 5 (recycleThreshold) is deactivated and returned to the pool within the same tick
- [ ] Barrier hitbox occupies Y = 0–1.0; standing robot (0–1.8) collides; jumping robot (base ≥ 2.7) clears it
- [ ] Drone hitbox occupies Y = 1.0–1.5; standing robot (0–1.8) collides; crouched robot (0–0.9) clears it
- [ ] Rapier collision between robot and any obstacle triggers Runner System's `collisionDetected` event
- [ ] Rapier collision between robot and ground plane does NOT trigger `collisionDetected` (OBSTACLE_GROUP filter verified)
- [ ] On `→ Dead`, all active obstacles freeze immediately; no further Z updates occur
- [ ] On restart (`→ Running`), all obstacles are inactive, pool is full, `spawnTimer = 0`
- [ ] `OS.setSpawnInterval(0)` clamps to `minSpawnInterval` (0.3s) and logs a console warning
- [ ] No two consecutive spawns are closer than `minObstacleGap` (8 units) at Z = −spawnDistance
- [ ] Pool exhaustion (all 3 of a type active) logs a warning and skips the spawn gracefully — no crash
- [ ] Obstacle System runs without measurable frame budget impact at 60fps alongside all other MVP systems
- [ ] All tuning knobs defined in `OBSTACLE_SYSTEM_CONFIG` and `OBSTACLE_TYPE_REGISTRY`; no magic numbers in source code

## Open Questions

| Question | Owner | Target Resolution | Resolution |
|----------|-------|------------------|------------|
| What are the v1 obstacle types beyond Barrier and Drone? (Game concept mentions drones, barriers, collapsing structures, neon signage) | Designer | v1 design sprint | Unresolved — minimum 3–5 types; each should require a distinct player response (e.g., 2-lane barrier forces lane change) |
| Does the Drone's 0.1-unit clearance produce false-positive Rapier collisions in practice? | Developer | Implementation spike | **Partially resolved** — prototype playtesting confirmed the tight clearance feels like a satisfying committed slide, not unfair. Keep `centerY=1.25`. If Rapier produces false positives, raise to 1.3. |
| Should obstacle type selection use weighted probability rather than uniform random? (e.g., Barriers more common at low speed; Drones introduced after N meters) | Designer | Difficulty Curve GDD | Deferred to v1 — uniform distribution is sufficient for MVP prototype testing |
| Should MVP obstacles use distinct debug colors (e.g., magenta boxes) to aid playtesting, replaced in v1 art pass? | Developer | MVP build decision | Recommended: yes — helps distinguish obstacles from environment geometry during development |
