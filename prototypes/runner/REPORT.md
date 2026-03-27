## Prototype Report: Runner Core Loop

### Hypothesis

A 3-lane endless runner with instant lane snap, physics jump arc (peak ≈3.6 units,
air time ≈1.2s), timed 600ms slide, and two obstacle types (Barrier jump / Drone slide)
will produce satisfying near-miss dodges at speeds from 8 to 25 units/second.

### Approach

Built in ~1 day. Single-file Three.js prototype (no Rapier, no enable3d, no abstraction).
Shortcuts taken: manual jump arc math instead of Rapier, AABB collision instead of
physics callbacks, box geometry for all meshes, raw keydown events, hardcoded values.

### Result

> **[FILL IN AFTER PLAYTESTING]**
>
> Replace this section with specific observations:
> - Did instant lane snap feel snappy or jarring?
> - Did the jump arc feel natural? Too low? Too floaty?
> - Did the drone slide clearance (0.1 unit gap) feel satisfying or frustrating?
> - Did the speed ramp create tension, or did it ramp too fast/slow?
> - How many runs before the controls felt intuitive?

### Metrics

> **[FILL IN AFTER PLAYTESTING]**

| Metric | Value |
|--------|-------|
| Runs to first 100m | ___ |
| Furthest distance reached | ___ m |
| Most common death cause | Barrier / Drone / Speed shock |
| Dominant dodge strategy | Lane change / Jump / Slide |
| Frame time (browser DevTools) | ___ ms avg |
| Lane snap feel | Precise / Jarring / Too slow |
| Jump arc feel | Natural / Floaty / Too short |
| Drone slide feel | Satisfying commitment / Accidentally tight / Too easy |
| Speed at which tension peaks | ___ u/s |
| Obstacle density at max speed | Manageable / Overwhelming |

### Recommendation: [PROCEED / PIVOT / KILL]

> **[FILL IN AFTER PLAYTESTING]**

**Predicted PROCEED** — the GDD mechanics are derived from genre-validated defaults
(lane snap for precision, physics arc for readable timing, 0.1-unit drone clearance
for committed slide feel). The main unknowns are the camera lag feel and the drone
slide timing, both of which are tunable without design changes.

### If Proceeding (expected path)

Required changes for production implementation:

1. **Replace manual jump arc with Rapier physics** — apply `jumpForce` impulse to
   `ExtendedObject3D` rigid body; let Rapier gravity bring it down; detect landing
   via `position.y ≤ groundY + epsilon` each frame.
2. **Replace AABB collision with Rapier OBSTACLE_GROUP filter** — obstacle colliders
   get `OBSTACLE_GROUP` flag; Rapier callback fires `collisionDetected` event once
   per run via `collisionFired` debounce flag.
3. **Replace direct position.x writes with Rapier `setTranslation()`** — prototype
   writes to `robotGroup.position.x` directly; production must go through the Rapier
   body API so enable3d sync doesn't override it.
4. **Replace raw keydown with Input System** — extract to `InputSystem` class with
   `enable()` / `disable()` and key-repeat suppression.
5. **Integrate with Game State Manager** — Runner System activates on `→ Running`,
   halts on `→ Dead`, resets on `→ MainMenu`.
6. **Drive ER scroll speed** — production calls `ER.setScrollSpeed(currentSpeed)`
   each tick instead of moving obstacle Z directly.
7. **Extract all hardcoded values** into `RUNNER_SYSTEM_CONFIG` and `OBSTACLE_SYSTEM_CONFIG`.

### Lessons Learned

> **[FILL IN AFTER PLAYTESTING]**

Known design risks to watch in production:
- **Drone slide clearance**: 0.1-unit gap (crouched top 0.9 vs drone bottom 1.0) may
  feel unfair on first encounter. If playtesting confirms frustration, raise drone
  centerY to 1.3 (bottom = 1.05, gap = 0.15). See Obstacle System GDD open question.
- **Camera lag vs snap feel**: `X_LERP_FACTOR = 8` means 375ms to 95% convergence.
  If lane snap feels disconnected from input, the camera (not the snap) is the cause —
  try `X_LERP_FACTOR = 12`.
- **Spawn interval at max speed**: At 25 u/s with `SPAWN_INTERVAL = 2.0s`, player sees
  a new obstacle every 50 units of world scroll. If density feels sparse at max speed,
  the Difficulty Curve (v1 system) will lower `spawnInterval` dynamically.
